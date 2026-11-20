// Motor de audio: entrada, monitorización, grabación (AudioWorklet con fallback), reproducción y metrónomo.
export class Engine {
  constructor() {
    this.ctx = null; this.pcm = new Map(); this.buf = new Map(); this.src = []; this.nodes = new Map();
    this.metroOn = false; this.timer = null; this.wl = false; this.monVol = 0.8; this.monOn = false; this.chunks = [];
  }
  async init() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C({ latencyHint: 'interactive' });
      this.mon = this.ctx.createGain(); this.mon.gain.value = 0; this.mon.connect(this.ctx.destination);
      this.sil = this.ctx.createGain(); this.sil.gain.value = 0; this.sil.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.wl && this.ctx.audioWorklet) {
      try { await this.ctx.audioWorklet.addModule('audio/worklets/recorder-processor.js'); this.wl = true; }
      catch (e) { console.warn('AudioWorklet no disponible; se usará ScriptProcessor', e); }
    }
  }
  async openInput(deviceId) {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    if (deviceId) a.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: a });
    if (this.inp) this.inp.disconnect();
    this.inp = this.ctx.createMediaStreamSource(this.stream);
    this.inp.connect(this.mon);
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter(x => x.kind === 'audioinput');
  }
  setMonitor(on) { this.monOn = on; if (this.mon) this.mon.gain.setTargetAtTime(on ? this.monVol : 0, this.ctx.currentTime, 0.01); }
  setMonVol(v) { this.monVol = v; if (this.monOn) this.setMonitor(true); }
  addClip(id, pcm, rate) { this.pcm.set(id, { pcm, rate }); this.buf.delete(id); }
  bufferFor(id) {
    let b = this.buf.get(id);
    if (!b) {
      const { pcm, rate } = this.pcm.get(id);
      b = this.ctx.createBuffer(1, pcm.length, rate);
      const d = b.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768;
      this.buf.set(id, b);
    }
    return b;
  }
  play(tracks, t0, from = 0) {
    this.stopAll(); const c = this.ctx;
    for (const t of tracks) {
      const g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) { g.connect(p); p.connect(c.destination); } else g.connect(c.destination);
      this.nodes.set(t.id, { g, p });
      for (const cl of t.clips) {
        if (!this.pcm.has(cl.aud) || cl.start + cl.dur <= from) continue;
        const skip = Math.max(0, from - cl.start), when = t0 + Math.max(0, cl.start - from);
        const s = c.createBufferSource(); s.buffer = this.bufferFor(cl.aud); s.connect(g);
        s.start(Math.max(when, c.currentTime), (cl.off || 0) + skip, cl.dur - skip); this.src.push(s);
      }
    }
    this.applyMix(tracks);
  }
  applyMix(tracks) {
    const solo = tracks.some(t => t.solo);
    for (const t of tracks) {
      const n = this.nodes.get(t.id); if (!n) continue;
      n.g.gain.value = (t.mute || (solo && !t.solo)) ? 0 : t.vol;
      if (n.p) n.p.pan.value = t.pan;
    }
  }
  stopAll() {
    this.src.forEach(s => { try { s.stop(); } catch (e) {} });
    this.src = []; this.nodes.clear(); clearInterval(this.timer);
  }
  startMetro(anchor, bpm, n) {
    const c = this.ctx, sp = 60 / bpm; clearInterval(this.timer);
    this.timer = setInterval(() => {
      while (anchor + n * sp < c.currentTime + 0.15) {
        const t = anchor + n * sp;
        if (t >= c.currentTime - 0.01 && this.metroOn) this.click(t, n % (this.beats || 4) === 0);
        n++;
      }
    }, 25);
  }
  click(t, acc) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = acc ? 1600 : 1000;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.06);
  }
  startRec(t0) {
    const c = this.ctx; this.chunks = [];
    if (this.wl) {
      const n = new AudioWorkletNode(c, 'recorder-processor', { processorOptions: { start: Math.round(t0 * c.sampleRate) } });
      n.port.onmessage = e => { const d = e.data; if (d.end) { this.chunks.push(d.data); if (this.endRes) this.endRes(); } else this.chunks.push(d); };
      this.inp.connect(n); n.connect(this.sil); this.rec = n; return;
    }
    const n = c.createScriptProcessor(4096, 1, 1);
    n.onaudioprocess = e => { if (e.playbackTime >= t0 - 0.0001) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    this.inp.connect(n); n.connect(this.sil); this.rec = n;
  }
  async stopRec() {
    const n = this.rec; if (!n) return null;
    if (n.port) await new Promise(r => { this.endRes = r; n.port.postMessage('flush'); setTimeout(r, 500); });
    try { this.inp.disconnect(n); } catch (e) {}
    n.disconnect(); if (n.port) n.port.onmessage = null; else n.onaudioprocess = null;
    this.rec = null;
    let len = 0; this.chunks.forEach(c => len += c.length);
    const pcm = new Int16Array(len); let o = 0;
    for (const c of this.chunks) for (let i = 0; i < c.length; i++) { const s = Math.max(-1, Math.min(1, c[i])); pcm[o++] = s < 0 ? s * 32768 : s * 32767; }
    this.chunks = [];
    return { pcm, rate: this.ctx.sampleRate };
  }
}
