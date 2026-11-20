import { Engine } from '../audio/audio-engine.js';
import * as DB from '../projects/project-storage.js';
const $ = s => document.querySelector(s), E = new Engine(), HDR = 96;
const PAL = ['#4fd1c5', '#f6ad55', '#fc8181', '#b794f4', '#68d391', '#63b3ed', '#f687b3'];
const TYPES = { guitar: 'Guitarra', bass: 'Bajo', voice: 'Voz', audio: 'Audio' };
let P, armed = null, mode = 'stop', t0 = 0, from = 0, raf = 0, recTrack = null, recFrom = 0, pps = 60, sel = null, drag = null;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const newTrack = (type, n) => ({ id: uid(), type, name: TYPES[type] + ' ' + n, color: PAL[(n - 1) % PAL.length], vol: .8, pan: 0, mute: false, solo: false, clips: [] });
const newProject = () => ({ id: uid(), name: 'Proyecto nuevo', bpm: 100, beats: 4, tracks: [newTrack('guitar', 1)] });
const spb = () => 60 / P.bpm, snap = v => Math.max(0, Math.round(v / spb()) * spb());
const save = () => DB.saveProject(P).catch(e => alert('No se pudo guardar: ' + e.message));
const projLen = () => Math.max(0, ...P.tracks.flatMap(t => t.clips.map(c => c.start + c.dur)));
const find = id => P.tracks.find(t => t.id === id), mix = () => E.ctx && E.applyMix(P.tracks);
const selClip = () => { const t = sel && find(sel.tid), c = t && t.clips.find(x => x.id === sel.cid); return c ? { t, c } : null; };
const fmt = p => { const b = P.beats * spb(), s = p % 60; return `${Math.floor(p / b) + 1}.${Math.floor((p % b) / spb()) + 1}  ${Math.floor(p / 60)}:${s.toFixed(1).padStart(4, '0')}`; };
const showPos = p => $('#pos').textContent = fmt(p);
const placePH = (p = from) => { const e = $('#ph'); if (e) e.style.left = (HDR + p * pps) + 'px'; };

async function openProject(id) {
  P = await DB.getProject(id); const seen = new Set();
  for (const t of P.tracks) for (const c of t.clips) {
    if (seen.has(c.aud)) continue; seen.add(c.aud);
    const r = await DB.getClip(c.aud); if (r) E.addClip(c.aud, r.pcm, r.rate);
  }
  localStorage.setItem('mt-last', id); armed = P.tracks[0] && P.tracks[0].id; from = 0; sel = null; render(); await fillList();
}
async function fillList() {
  const l = await DB.listProjects();
  $('#proj').innerHTML = l.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''); $('#proj').value = P.id;
}
function wave(cv, c) {
  const d = E.pcm.get(c.aud); if (!d) return;
  const w = cv.width = Math.min(3000, Math.max(1, Math.round(c.dur * pps))), h = cv.height = 60, x = cv.getContext('2d');
  const a0 = Math.floor(c.off * d.rate), n = Math.floor(c.dur * d.rate); x.fillStyle = '#ffffffaa';
  for (let i = 0; i < w; i++) {
    const a = a0 + Math.floor(i / w * n), b = a0 + Math.floor((i + 1) / w * n), st = Math.max(1, Math.floor((b - a) / 40)); let m = 0;
    for (let k = a; k < b; k += st) m = Math.max(m, Math.abs(d.pcm[k] || 0));
    const v = m / 32768 * h / 2; x.fillRect(i, h / 2 - v, 1, Math.max(1, v * 2));
  }
}
function render() {
  $('#name').value = P.name; $('#bpm').value = P.bpm; $('#beats').value = P.beats; showPos(from);
  const bar = P.beats * spb(), bp = bar * pps, W = Math.max(projLen() + bar * 4, bar * 8) * pps;
  let h = `<div class="row rul"><div class="hd"></div><div class="lane" style="width:${W}px">`;
  for (let i = 0; i * bp < W; i++) h += `<span style="left:${i * bp}px">${i + 1}</span>`;
  h += '</div></div>' + P.tracks.map(t => `<div class="row" data-id="${t.id}"><div class="hd${armed === t.id ? ' armed' : ''}" style="border-left-color:${t.color}"><div class="nm" data-a="name">${esc(t.name)}</div><div class="bt"><button data-a="color" style="background:${t.color}"></button><button data-a="arm" ${armed === t.id ? 'class="on"' : ''}>●</button><button data-a="mute" class="${t.mute ? 'on' : ''}">M</button><button data-a="solo" class="${t.solo ? 'on' : ''}">S</button><button data-a="del">✕</button></div></div><div class="lane" style="width:${W}px;background-size:${bp}px 100%">${t.clips.map(c => `<div class="clip${sel && sel.cid === c.id ? ' sel' : ''}" data-cid="${c.id}" style="left:${c.start * pps}px;width:${Math.max(4, c.dur * pps)}px;background:${t.color}55;border-color:${t.color}"><canvas></canvas></div>`).join('')}</div></div>`).join('');
  $('#inner').style.width = (HDR + W) + 'px'; $('#inner').innerHTML = h + '<div id="ph"></div>';
  document.querySelectorAll('.clip').forEach(el => { const t = find(el.closest('.row').dataset.id); wave(el.querySelector('canvas'), t.clips.find(x => x.id === el.dataset.cid)); });
  placePH(); mix();
}
function renderMix() {
  $('#mixer').innerHTML = P.tracks.map(t => `<div class="strip" data-id="${t.id}" style="border-top-color:${t.color}"><b>${esc(t.name)}</b><label>Volumen<input type="range" data-a="vol" min="0" max="1" step=".01" value="${t.vol}"></label><label>Paneo<input type="range" data-a="pan" min="-1" max="1" step=".01" value="${t.pan}"></label><div><button data-a="mute" class="${t.mute ? 'on' : ''}">M</button> <button data-a="solo" class="${t.solo ? 'on' : ''}">S</button></div></div>`).join('');
}
function ui() { $('#play').classList.toggle('on', mode === 'play'); $('#rec').classList.toggle('on', mode === 'rec'); }
function tick() {
  const p = from + Math.max(0, E.ctx.currentTime - t0); showPos(p); placePH(p);
  const x = HDR + p * pps, tl = $('#tl'); if (x > tl.scrollLeft + tl.clientWidth - 30) tl.scrollLeft = x - HDR - 10;
  if (mode === 'play' && p > projLen() + .2) { stop(); return; }
  raf = requestAnimationFrame(tick);
}
async function refreshInputs(force) {
  const sel = $('#dev'), id = sel.value || undefined;
  if (E.stream && !force && id === E.devId) return;
  const list = await E.openInput(id);
  sel.innerHTML = list.map(d => `<option value="${d.deviceId}">${esc(d.label || 'Entrada')}</option>`).join('');
  sel.value = id && list.some(d => d.deviceId === id) ? id : (list[0] ? list[0].deviceId : ''); E.devId = sel.value || undefined;
}
const metroFrom = () => E.startMetro(t0 - from, P.bpm, Math.ceil(from / spb() - 1e-6));
async function play() {
  if (mode !== 'stop') return;
  await E.init(); t0 = E.ctx.currentTime + .1; E.beats = P.beats;
  E.play(P.tracks, t0, from); metroFrom(); mode = 'play'; tick(); ui();
}
async function rec() {
  if (mode !== 'stop') return;
  const t = find(armed); if (!t) return alert('Arma una pista con ●');
  try { await E.init(); await refreshInputs(); } catch (e) { return alert('No se pudo abrir el micrófono: ' + e.message); }
  const cnt = +$('#cnt').value * P.beats; t0 = E.ctx.currentTime + .2 + cnt * spb(); E.beats = P.beats;
  E.play(P.tracks.filter(x => x !== t), t0, from); E.startRec(t0);
  for (let i = 0; i < cnt; i++) E.click(t0 - (cnt - i) * spb(), i % P.beats === 0);
  metroFrom(); recTrack = t; recFrom = from; mode = 'rec'; tick(); ui();
}
async function stop() {
  if (mode === 'stop') return;
  const was = mode; mode = 'stop'; cancelAnimationFrame(raf); E.stopAll(); showPos(from); placePH(); ui();
  if (was !== 'rec') return;
  const r = await E.stopRec();
  if (r && r.pcm.length > r.rate * .05) {
    try {
      const aud = uid(); await DB.saveClip(aud, r.pcm, r.rate); E.addClip(aud, r.pcm, r.rate);
      const c = { id: uid(), aud, start: recFrom, off: 0, dur: r.pcm.length / r.rate };
      recTrack.clips.push(c); sel = { tid: recTrack.id, cid: c.id }; await save();
    } catch (e) { alert('No se pudo guardar la grabación: ' + e.message); }
  }
  render();
}
$('#play').onclick = play; $('#rec').onclick = rec; $('#stop').onclick = stop;
$('#met').onclick = e => { E.metroOn = !E.metroOn; e.currentTarget.classList.toggle('on', E.metroOn); };
$('#zi').onclick = () => { pps = Math.min(400, pps * 1.5); render(); };
$('#zo').onclick = () => { pps = Math.max(10, pps / 1.5); render(); };
$('#addt').onclick = () => { const ty = $('#ttype').value; P.tracks.push(newTrack(ty, P.tracks.filter(t => t.type === ty).length + 1)); render(); save(); };
$('#split').onclick = () => {
  const s = selClip(); if (!s || mode !== 'stop') return alert('Selecciona un clip y coloca la posición dentro de él (toca la regla).');
  const { t, c } = s, d = from - c.start;
  if (!(d > .01 && d < c.dur - .01)) return alert('La posición debe estar dentro del clip.');
  t.clips.push({ id: uid(), aud: c.aud, start: from, off: c.off + d, dur: c.dur - d }); c.dur = d; render(); save();
};
$('#dup').onclick = () => { const s = selClip(); if (!s || mode !== 'stop') return; const n = { ...s.c, id: uid(), start: s.c.start + s.c.dur }; s.t.clips.push(n); sel = { tid: s.t.id, cid: n.id }; render(); save(); };
$('#delc').onclick = () => {
  const s = selClip(); if (!s || mode !== 'stop' || !confirm('¿Quitar el clip? (El audio no se borra de la base de datos.)')) return;
  s.t.clips = s.t.clips.filter(x => x !== s.c); sel = null; render(); save();
};
$('#tl').addEventListener('click', e => {
  const b = e.target.closest('button,.nm'); if (!b) return;
  const t = find(b.closest('.row').dataset.id), a = b.dataset.a;
  if (mode === 'rec' && a !== 'mute' && a !== 'solo') return;
  if (a === 'arm') armed = t.id; else if (a === 'mute') t.mute = !t.mute; else if (a === 'solo') t.solo = !t.solo;
  else if (a === 'color') t.color = PAL[(PAL.indexOf(t.color) + 1) % PAL.length];
  else if (a === 'name') { const n = prompt('Nombre de la pista', t.name); if (n && n.trim()) t.name = n.trim().slice(0, 30); }
  else if (a === 'del') { if (!confirm('¿Quitar la pista del proyecto?')) return; P.tracks = P.tracks.filter(x => x !== t); if (armed === t.id) armed = P.tracks[0] && P.tracks[0].id; }
  render(); save();
});
$('#tl').addEventListener('pointerdown', e => {
  if (e.target.closest('button,.nm')) return;
  const el = e.target.closest('.clip');
  if (el) {
    const t = find(el.closest('.row').dataset.id), c = t.clips.find(x => x.id === el.dataset.cid);
    sel = { tid: t.id, cid: c.id }; document.querySelectorAll('.clip').forEach(x => x.classList.toggle('sel', x === el));
    if (mode === 'stop') { drag = { c, el, x: e.clientX, s: c.start, moved: false }; el.setPointerCapture(e.pointerId); }
    return;
  }
  if (e.target.closest('.lane') && mode === 'stop') { from = snap((e.clientX - $('#inner').getBoundingClientRect().left - HDR) / pps); placePH(); showPos(from); }
});
$('#tl').addEventListener('pointermove', e => {
  if (!drag) return; const ns = snap(drag.s + (e.clientX - drag.x) / pps);
  if (ns !== drag.c.start) { drag.c.start = ns; drag.moved = true; drag.el.style.left = ns * pps + 'px'; }
});
const endDrag = () => { if (drag && drag.moved) { save(); render(); } drag = null; };
$('#tl').addEventListener('pointerup', endDrag); $('#tl').addEventListener('pointercancel', endDrag);
$('#mixer').addEventListener('input', e => { const a = e.target.dataset.a; if (a === 'vol' || a === 'pan') { find(e.target.closest('.strip').dataset.id)[a] = +e.target.value; mix(); } });
$('#mixer').addEventListener('change', save);
$('#mixer').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const t = find(b.closest('.strip').dataset.id);
  if (b.dataset.a === 'mute') t.mute = !t.mute; else t.solo = !t.solo; renderMix(); mix(); save();
});
$('#name').onchange = e => { P.name = e.target.value.trim() || 'Proyecto'; save().then(fillList); };
$('#bpm').onchange = e => { P.bpm = Math.min(240, Math.max(40, +e.target.value || 100)); e.target.value = P.bpm; render(); save(); };
$('#beats').onchange = e => { P.beats = +e.target.value; render(); save(); };
$('#proj').onchange = e => { if (mode === 'stop') openProject(e.target.value); };
$('#newp').onclick = async () => { if (mode !== 'stop') return; P = newProject(); await save(); await openProject(P.id); };
$('#micb').onclick = async () => { try { await E.init(); await refreshInputs(true); } catch (e) { alert('Micrófono: ' + e.message); } };
$('#dev').onchange = async () => { try { await E.init(); await refreshInputs(true); } catch (e) { alert(e.message); } };
$('#mon').onchange = async e => { try { await E.init(); await refreshInputs(); E.setMonitor(e.target.checked); } catch (err) { e.target.checked = false; alert(err.message); } };
$('#monv').oninput = e => E.setMonVol(+e.target.value);
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'v-' + b.dataset.v);
  if (b.dataset.v === 'playlist') render(); if (b.dataset.v === 'mixer') renderMix();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && E.ctx && E.ctx.state !== 'running') E.ctx.resume().catch(() => {}); });
(async () => {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const l = await DB.listProjects(), last = localStorage.getItem('mt-last');
  if (!l.length) { P = newProject(); await save(); await openProject(P.id); }
  else await openProject(l.find(p => p.id === last) ? last : l[0].id);
})();
