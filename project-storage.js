// IndexedDB nueva: "musictool-daw" v1. No toca la base antigua "musictool".
const NAME = 'musictool-daw'; let db;
function open() {
  return db || (db = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('clips', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function tx(store, mode, f) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), q = f(t.objectStore(store));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
export const saveProject = p => tx('projects', 'readwrite', s => s.put({ ...p, v: 1, mod: Date.now() }));
export const getProject = id => tx('projects', 'readonly', s => s.get(id));
export const listProjects = () => tx('projects', 'readonly', s => s.getAll());
export const saveClip = (id, pcm, rate) => tx('clips', 'readwrite', s => s.put({ id, pcm: pcm.buffer, rate }));
export const getClip = id => tx('clips', 'readonly', s => s.get(id)).then(r => r && { pcm: new Int16Array(r.pcm), rate: r.rate });
