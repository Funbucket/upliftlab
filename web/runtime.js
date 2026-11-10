// One call interface, two places to run the Python engine: the browser (Pyodide worker) or the local edition server.
import {ENGINE_FILES} from './engine-files.js?v=0.24.0';

export const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const WORKER = `
let py, api;
const CODES = {check: p => [p.code], try_algorithm: p => [p.code], run_start: p => p.algorithms.map(a => a.code), run_all: p => p.algorithms.map(a => a.code)};
const say = text => self.postMessage({type: 'loading', text});
// Before running algorithm files: load every Pyodide package they import, then micropip-install what they declare (PEP 723).
async function prepare(codes) {
  try {
    for (const code of codes) {
      await py.loadPackagesFromImports(code, {messageCallback: m => { const hit = /^Loading (.+)/.exec(m); if (hit) say(hit[1]); }, errorCallback: () => {}})
        .catch(() => {});  // what fails to load shows up as a missing library in check()
    }
    const pending = JSON.parse(api.call('requirements', JSON.stringify({codes}))).result || [];
    if (pending.length) {
      say(pending.join(', '));
      await py.loadPackage('micropip', {messageCallback: () => {}});
      const list = py.toPy(codes);
      try { await api.prepare(list); } finally { list.destroy(); }
    }
  } finally { say(''); }
}
self.onmessage = async ({data}) => {
  const {id, method, payload} = data;
  try {
    if (method === '__init__') {
      self.postMessage({type: 'status', text: 'Python 런타임을 내려받고 있어요'});
      importScripts(payload.indexURL + 'pyodide.js');
      py = await loadPyodide({indexURL: payload.indexURL});
      self.postMessage({type: 'status', text: 'NumPy를 불러오고 있어요'});
      await py.loadPackage('numpy');
      for (const [file, source] of Object.entries(payload.files)) {
        const full = '/engine/' + file;
        py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
        py.FS.writeFile(full, source);
      }
      py.runPython("import sys; sys.path.insert(0, '/engine')");
      api = py.pyimport('upliftlab.bridge');
      api.set_reporter(message => self.postMessage({type: 'progress', data: message}));
      self.postMessage({id, response: api.call('info', '{}')});
    } else {
      if (CODES[method]) await prepare(CODES[method](payload));
      self.postMessage({id, response: api.call(method, JSON.stringify(payload))});
    }
  } catch (error) {
    self.postMessage({id, response: JSON.stringify({ok: false, error: String((error && error.message) || error)})});
  }
};`;

function unwrap(text) {
  const out = typeof text === 'string' ? JSON.parse(text) : text;
  if (out.ok) return out.result;
  const error = new Error(out.error || '엔진 오류'); error.trace = out.trace || ''; throw error;
}

// Calls run strictly in order, so a progress event always belongs to the call at the head of the queue.
function queue(send) {
  let tail = Promise.resolve();
  const runtime = {active: null, call(method, payload = {}) {
    const run = tail.then(() => { runtime.active = {method, payload}; return send(method, payload); });
    tail = run.catch(() => {}).finally(() => { runtime.active = null; });
    return run;
  }};
  return runtime;
}

function browserRuntime(onProgress, onStatus, onLoading) {
  const worker = new Worker(URL.createObjectURL(new Blob([WORKER], {type: 'text/javascript'})));
  const waiting = new Map(); let next = 0, runtime;
  worker.onmessage = ({data}) => {
    if (data.type === 'status') return onStatus(data.text);
    if (data.type === 'loading') return onLoading(data.text);
    if (data.type === 'progress') return onProgress(JSON.parse(data.data), runtime.active);
    const done = waiting.get(data.id); waiting.delete(data.id);
    try { done.resolve(unwrap(data.response)); } catch (error) { done.reject(error); }
  };
  worker.onerror = event => { for (const w of waiting.values()) w.reject(new Error(event.message || 'Python 워커 오류')); waiting.clear(); };
  runtime = queue((method, payload) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, {resolve, reject}); worker.postMessage({id, method, payload}); }));
  runtime.kind = 'browser';
  runtime.ready = runtime.call('__init__', {indexURL: PYODIDE, files: ENGINE_FILES});
  return runtime;
}

function localRuntime(info, onProgress) {
  let runtime;
  runtime = queue(async (method, payload) => {
    const response = await fetch('api/engine/' + method, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    if (!response.ok) throw new Error(`로컬 엔진 응답 ${response.status}`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result;
    for (;;) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
        if (line.type === 'progress') onProgress(line.data, runtime.active); else result = line;
      }
      if (done) break;
    }
    return unwrap(result);
  });
  runtime.kind = 'local'; runtime.ready = Promise.resolve(info);
  return runtime;
}

// The local edition answers GET api/engine; anywhere else the engine runs inside this tab.
export async function createRuntime({onProgress = () => {}, onStatus = () => {}, onLoading = () => {}} = {}) {
  if (location.protocol === 'file:') return browserRuntime(onProgress, onStatus, onLoading);
  try {
    const response = await fetch('api/engine', {signal: AbortSignal.timeout(1500)});
    const info = response.ok && (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
    if (info?.ok && info.result.runtime === 'local') return localRuntime(info.result, onProgress);
  } catch { /* not the local edition */ }
  return browserRuntime(onProgress, onStatus, onLoading);
}
