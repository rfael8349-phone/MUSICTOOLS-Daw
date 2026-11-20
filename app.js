import { Engine } from './audio-engine.js';
import * as DB from './project-storage.js';
const $ = s => document.querySelector(s), E = new Engine();
let P, armed = null, mode = 'stop', t0 = 0, raf = 0, recTrack = null;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const newTrack = n => ({ id: uid(), name: 'Pista ' + n, vol: .8, pan: 0, mute: false, solo: false, clips: [] });
const newProject = () => ({ id: uid(), name: 'Proyecto nuevo', bpm: 100, beats: 4, tracks: [newTrack(1)] });
const save = () => DB.saveProject(P).catch(e => alert('No se pudo guardar: ' + e.message));
const fmt = s => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
const projLen = () => Math.max(0, ...P.tracks.flatMap(t => t.clips.map(c => c.start + c.dur)));
const mix = () => E.ctx && E.applyMix(P.tracks);
const tr = el => P.tracks.find(x => x.id === el.closest('.trk').dataset.id);

async function openProject(id) {
  P = await DB.getProject(id);
  for (const t of P.tracks) for (const c of t.clips) { const r = await DB.getClip(c.id); if (r) E.addClip(c.id, r.pcm, r.rate); }
  localStorage.setItem('mt-last', id); armed = P.tracks[0] && P.tracks[0].id; render(); await fillList();
}
async function fillList() {
  const l = await DB.listProjects();
  $('#proj').innerHTML = l.map(p => `<option value="${p.id}">${p.name.replace(/[<&>"]/g, '')}</option>`).join('');
  $('#proj').value = P.id;
}
function drawWave(cv, t) {
  const w = cv.width = cv.clientWidth || 300, h = cv.height, x = cv.getContext('2d'), tot = Math.max(projLen(), 1);
  x.fillStyle = '#4fd1c5';
  for (const c of t.clips) {
    const d = E.pcm.get(c.id); if (!d) continue;
    const x0 = c.start / tot * w, cw = Math.max(1, c.dur / tot * (w - 2));
    for (let i = 0; i < cw; i++) {
      const a = Math.floor(i / cw * d.pcm.length), b = Math.max(a + 1, Math.floor((i + 1) / cw * d.pcm.length));
      let m = 0; const st = Math.max(1, Math.floor((b - a) / 50));
      for (let k = a; k < b; k += st) m = Math.max(m, Math.abs(d.pcm[k]));
      const v = m / 32768 * h / 2; x.fillRect(x0 + i, h / 2 - v, 1, Math.max(1, v * 2));
    }
  }
}
function render() {
  $('#name').value = P.name; $('#bpm').value = P.bpm;
  $('#tracks').innerHTML = P.tracks.map(t => `<div class="trk${armed === t.id ? ' armed' : ''}" data-id="${t.id}"><div class="th"><b>${t.name}</b><button data-a="arm" title="Armar para grabar">●</button><button data-a="mute" class="${t.mute ? 'on' : ''}">M</button><button data-a="solo" class="${t.solo ? 'on' : ''}">S</button><button data-a="del">✕</button></div><canvas height="48"></canvas><div class="sl"><label>Vol <input type="range" data-a="vol" min="0" max="1" step=".01" value="${t.vol}"></label><label>Pan <input type="range" data-a="pan" min="-1" max="1" step=".01" value="${t.pan}"></label></div></div>`).join('');
  document.querySelectorAll('.trk').forEach(el => drawWave(el.querySelector('canvas'), tr(el)));
}
function ui() { $('#play').classList.toggle('on', mode === 'play'); $('#rec').classList.toggle('on', mode === 'rec'); }
function tick() {
  const p = Math.max(0, E.ctx.currentTime - t0); $('#pos').textContent = fmt(p);
  if (mode === 'play' && p > projLen() + .2) { stop(); return; }
  raf = requestAnimationFrame(tick);
}
async function refreshInputs(force) {
  const sel = $('#dev'), id = sel.value || undefined;
  if (E.stream && !force && id === E.devId) return;
  const list = await E.openInput(id);
  sel.innerHTML = list.map(d => `<option value="${d.deviceId}">${d.label || 'Entrada'}</option>`).join('');
  sel.value = id && list.some(d => d.deviceId === id) ? id : (list[0] ? list[0].deviceId : '');
  E.devId = sel.value || undefined;
}
async function play() {
  if (mode !== 'stop') return;
  await E.init(); t0 = E.ctx.currentTime + .1;
  E.play(P.tracks, t0); E.startMetro(t0, P.bpm, 0); mode = 'play'; tick(); ui();
}
async function rec() {
  if (mode !== 'stop') return;
  const t = P.tracks.find(x => x.id === armed); if (!t) return alert('Arma una pista con ●');
  if (t.clips.length && !confirm('Esta pista ya tiene audio. ¿Sustituirlo en el proyecto? (La toma anterior no se borra de la base de datos.)')) return;
  try { await E.init(); await refreshInputs(); } catch (e) { return alert('No se pudo abrir el micrófono: ' + e.message); }
  const cnt = +$('#cnt').value * P.beats; t0 = E.ctx.currentTime + .2 + cnt * 60 / P.bpm;
  E.play(P.tracks.filter(x => x !== t), t0); E.startRec(t0); E.startMetro(t0, P.bpm, cnt);
  recTrack = t; mode = 'rec'; tick(); ui();
}
async function stop() {
  if (mode === 'stop') return;
  const was = mode; mode = 'stop'; cancelAnimationFrame(raf); E.stopAll(); $('#pos').textContent = fmt(0); ui();
  if (was !== 'rec') return;
  const r = await E.stopRec();
  if (r && r.pcm.length > r.rate * .05) {
    try {
      const id = uid(); await DB.saveClip(id, r.pcm, r.rate); E.addClip(id, r.pcm, r.rate);
      recTrack.clips = [{ id, start: 0, dur: r.pcm.length / r.rate }]; await save();
    } catch (e) { alert('No se pudo guardar la grabación: ' + e.message); }
  }
  render();
}
$('#play').onclick = play; $('#rec').onclick = rec; $('#stop').onclick = stop;
$('#met').onclick = e => { E.metroOn = !E.metroOn; e.currentTarget.classList.toggle('on', E.metroOn); };
$('#addt').onclick = () => { P.tracks.push(newTrack(P.tracks.length + 1)); render(); save(); };
$('#tracks').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const t = tr(b), a = b.dataset.a;
  if (mode === 'rec' && a !== 'mute' && a !== 'solo') return;
  if (a === 'arm') armed = t.id; else if (a === 'mute') t.mute = !t.mute; else if (a === 'solo') t.solo = !t.solo;
  else if (a === 'del') { if (!confirm('¿Quitar la pista del proyecto?')) return; P.tracks = P.tracks.filter(x => x !== t); if (armed === t.id) armed = P.tracks[0] && P.tracks[0].id; }
  render(); mix(); save();
});
$('#tracks').addEventListener('input', e => { const a = e.target.dataset.a; if (a === 'vol' || a === 'pan') { tr(e.target)[a] = +e.target.value; mix(); } });
$('#tracks').addEventListener('change', save);
$('#name').onchange = e => { P.name = e.target.value || 'Proyecto'; save().then(fillList); };
$('#bpm').onchange = e => { P.bpm = Math.min(240, Math.max(40, +e.target.value || 100)); e.target.value = P.bpm; save(); };
$('#proj').onchange = e => { if (mode === 'stop') openProject(e.target.value); };
$('#newp').onclick = async () => { if (mode !== 'stop') return; P = newProject(); await save(); await openProject(P.id); };
$('#micb').onclick = async () => { try { await E.init(); await refreshInputs(true); } catch (e) { alert('Micrófono: ' + e.message); } };
$('#dev').onchange = async () => { try { await E.init(); await refreshInputs(true); } catch (e) { alert(e.message); } };
$('#mon').onchange = async e => {
  try { await E.init(); await refreshInputs(); E.setMonitor(e.target.checked); } catch (err) { e.target.checked = false; alert(err.message); }
};
$('#monv').oninput = e => E.setMonVol(+e.target.value);
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'v-' + b.dataset.v);
  if (b.dataset.v === 'playlist') render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && E.ctx && E.ctx.state !== 'running') E.ctx.resume().catch(() => {}); });
(async () => {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const l = await DB.listProjects(), last = localStorage.getItem('mt-last');
  if (!l.length) { P = newProject(); await save(); await openProject(P.id); }
  else await openProject(l.find(p => p.id === last) ? last : l[0].id);
})();
