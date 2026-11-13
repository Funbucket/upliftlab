// App state: the engine, algorithms, datasets and runs. Views subscribe and re-render when something changes.
import {ENGINE_FILES} from './engine-files.js?v=0.26.2';
import {CATALOG, EXAMPLE} from './catalog.js?v=0.26.2';
import {createRuntime} from './runtime.js?v=0.26.2';
import {load, save, MAX_ALGORITHMS} from './lib.js?v=0.26.2';

const USER_KEY = 'upliftlab.algorithms.v15', RUN_KEY = 'upliftlab.runs.v16', DRAFT_KEY = 'upliftlab.draft.v22', MAX_RUNS = 12, KEEP_TRACES = 3;
const SETTINGS = {mode: 'quantile', budget: .4, efficiency: .2, baseLearner: 'ridge'};  // results made before these settings existed used these values
const listeners = new Set();
export const state = {engine: {status: 'loading', text: '엔진을 준비하고 있어요', kind: null, info: null, loading: ''}, algorithms: [], datasets: [], runs: [], live: null, activity: null, draft: null};
export const EXAMPLE_RUN = {...EXAMPLE, id: 'example', example: true, status: 'done'};
let runtime = null, frame = 0, resolveReady, rejectReady, librariesLoaded = false;
const engineReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
engineReady.catch(() => {});

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(kind = 'change') { for (const fn of [...listeners]) fn(kind); }
function emitSoon(kind) { if (!frame) frame = requestAnimationFrame(() => { frame = 0; emit(kind); }); }
export const call = (method, payload = {}) => engineReady.then(() => runtime.call(method, payload));

// ---------- algorithms ----------
function initAlgorithms() {
  const builtins = CATALOG.algorithms.map(a => ({...a, code: ENGINE_FILES[a.file], builtin: true, ok: true}));
  const users = load(USER_KEY, []).filter(a => a && typeof a.id === 'string' && typeof a.code === 'string')
    .map(a => ({id: a.id, name: a.name || '내 알고리즘', code: a.code, base: a.base || null, builtin: false, summary: '', ok: null}));
  state.algorithms = [...builtins, ...users];
}
export const algorithm = id => state.algorithms.find(a => a.id === id);
// Starting files for a new algorithm (scikit-learn, LightGBM, PyTorch). Their code ships with the engine files.
export const templates = () => (state.engine.info?.templates || CATALOG.templates).map(t => ({...t, code: ENGINE_FILES[t.file]}));
// Why an algorithm cannot run here: a library this runtime does not have. Null when it can.
export function unavailable(a) {
  const gone = (a.libraries || []).filter(l => ['missing', 'failed', 'local'].includes(l.status));
  if (!gone.length) return null;
  const names = gone.map(l => l.package).join(', ');
  if (state.engine.kind === 'local') return {short: '설치 필요', text: `${names} 미설치 · pip install ${gone.map(l => l.package).join(' ')}`};
  return gone.some(l => l.status === 'local') ? {short: '로컬 실행 필요', text: `${names} · 브라우저용 빌드가 없어 로컬에서 실행해요`}
    : {short: '라이브러리 없음', text: `${names} 미설치 · PyPI 패키지라면 파일 맨 위 # /// script 블록에 적어 주세요`};
}
const saveUsers = () => save(USER_KEY, state.algorithms.filter(a => !a.builtin).map(({id, name, code, base}) => ({id, name, code, base})));
export function addAlgorithm({name, code, base = null}) {
  const a = {id: 'user-' + crypto.randomUUID().slice(0, 8), name, code, base, builtin: false, summary: '', ok: null};
  state.algorithms.push(a); saveUsers(); check(a); emit('algorithms');
  return a;
}
export function updateAlgorithm(a, code) {
  a.code = code; a.ok = null;
  const saved = saveUsers();
  clearTimeout(a.timer); a.timer = setTimeout(() => check(a), 400);
  emit('algorithms');
  return saved;
}
export function removeAlgorithm(id) { state.algorithms = state.algorithms.filter(a => a.builtin || a.id !== id); saveUsers(); emit('algorithms'); }
async function check(a) {
  const code = a.code, out = await call('check', {code, id: a.id}).catch(error => ({ok: false, error: error.message}));
  if (a.code !== code) return;
  Object.assign(a, {ok: out.ok, error: out.ok ? null : out.error, line: out.line ?? null, libraries: out.libraries || a.libraries || []});
  if (out.ok) { a.summary = out.summary || ''; if (out.name) a.name = out.name; saveUsers(); }
  emit('algorithms');
}
export async function quickCheck(a) {
  if (state.activity) throw new Error('다른 검사가 실행 중이에요.');
  state.activity = {method: 'try_algorithm', id: a.id, trace: []}; emit('activity');
  try {
    const out = await call('try_algorithm', {code: a.code, id: a.id, name: a.name}).catch(error => ({ok: false, error: error.message}));
    if (out.ok) librariesLoaded = true;
    return {...out, trace: state.activity.trace};
  } finally { state.activity = null; emit('activity'); }
}

// ---------- datasets: catalog entries plus files kept in IndexedDB ----------
const memory = new Map(), loaded = new Set(), profiles = new Map();
let dbp = null;
export const storage = {persistent: true};
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('upliftlab', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('datasets', {keyPath: 'id'});
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => { const t = d.transaction('datasets', mode), r = fn(t.objectStore('datasets')); t.oncomplete = () => resolve(r.result); t.onerror = () => reject(t.error); });
}
async function idb(mode, fn, fallback) {
  try { return await tx(mode, fn); } catch { storage.persistent = false; return fallback(); }
}
const meta = rec => ({id: rec.id, name: rec.name, mapping: rec.mapping, profile: rec.profile, createdAt: rec.createdAt, local: !!rec.local});
async function initDatasets() {
  state.datasets = CATALOG.datasets.map(d => ({...d, stored: null}));
  for (const rec of await idb('readonly', s => s.getAll(), () => [...memory.values()]) || []) placeDataset(meta(rec));
}
function placeDataset(m) {
  const known = state.datasets.find(d => d.id === m.id);
  if (known) known.stored = m;
  else state.datasets.push({id: m.id, kind: 'upload', name: m.name, summary: '', truth: false, stored: m});
}
export const dataset = id => state.datasets.find(d => d.id === id);
export const datasetReady = d => !!d && (d.kind === 'synthetic' || !!d.bundled || !!d.stored || (d.kind === 'public' && state.engine.kind === 'local'));
export const inspectFile = text => call('inspect_csv', {csv: text});
export const sampleFile = () => call('sample_csv');  // {name, csv}: an example randomized coupon experiment
export async function addDataset({text, name, mapping}) {
  const id = 'upload/' + crypto.randomUUID().slice(0, 8);
  const out = await call('add_dataset', {id, csv: text, name, mapping});
  const rec = {id, name: id.startsWith('public/') ? dataset(id).name : name, csv: text, mapping: out.mapping, profile: out.profile, createdAt: Date.now()};
  await idb('readwrite', s => s.put(rec), () => memory.set(id, rec));
  loaded.add(id); placeDataset(meta(rec)); profiles.set(id, out.profile); emit('datasets');
  return id;
}
export async function fetchPublic(id) {
  const out = await call('fetch_dataset', {id});
  const rec = {id, name: dataset(id).name, csv: null, local: true, mapping: out.mapping, profile: out.profile, createdAt: Date.now()};
  await idb('readwrite', s => s.put(rec), () => memory.set(id, rec));
  loaded.add(id); placeDataset(meta(rec)); profiles.set(id, out.profile); emit('datasets');
}
export async function removeDataset(id) {
  await idb('readwrite', s => s.delete(id), () => memory.delete(id));
  loaded.delete(id); profiles.delete(id);
  const d = dataset(id);
  if (d?.kind === 'upload') state.datasets = state.datasets.filter(x => x.id !== id); else if (d) d.stored = null;
  emit('datasets');
}
// A sample shipped with the site (Criteo): fetched from ./data, unzipped here, and mapped by the catalog. The same file is
// served by the local edition, so both start from the same rows. It is kept in memory only; the browser caches the file.
async function loadBundled(d) {
  const res = await fetch('./' + d.bundled);
  if (!res.ok) throw new Error(`‘${d.name}’ 파일을 불러오지 못했어요 (${res.status}).`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());  // a server may already have unzipped it
  const out = await call('add_dataset', {id: d.id, csv: new TextDecoder().decode(bytes), name: d.name, mapping: d.mapping});
  d.stored = {id: d.id, name: d.name, mapping: out.mapping, profile: out.profile, createdAt: null, bundled: true};
  loaded.add(d.id); profiles.set(d.id, out.profile); emit('datasets');
}
export async function ensureDataset(id) {
  const d = dataset(id);
  if (!d) throw new Error('데이터를 찾을 수 없어요.');
  if (d.kind === 'synthetic' || loaded.has(id)) return;
  if (d.bundled) { await (d.loading ||= loadBundled(d).finally(() => { d.loading = null; })); return; }
  const rec = await idb('readonly', s => s.get(id), () => memory.get(id));
  if (rec?.csv) await call('add_dataset', {id, csv: rec.csv, name: rec.name, mapping: rec.mapping});
  else if (d.kind === 'public' && state.engine.kind === 'local') await fetchPublic(id);
  else throw new Error(`‘${d.name}’ 데이터셋을 먼저 업로드해 주세요.`);
  loaded.add(id);
}
export async function profileOf(id) {
  if (profiles.has(id)) return profiles.get(id);
  const d = dataset(id);
  if (d.bundled) await ensureDataset(id);
  const profile = d.kind === 'synthetic' ? (await call('describe_dataset', {id})).profile : d.stored?.profile;
  if (profile) profiles.set(id, profile);
  return profile;
}

// Names of the outcome and cost for a dataset, used in column headers and metric labels.
export function wordsFor(id) {
  const d = dataset(id);
  if (d?.kind === 'synthetic' || String(id).startsWith('synthetic/')) return {data: d?.name || '합성 쿠폰 실험', outcome: '리텐션', incR: '증분 리텐션', unit: '명', cost: '보상 비용', binary: true};  // runs saved before the synthetic data left the list
  if (d?.id === 'public/criteo') return {data: d.name, outcome: '방문', incR: '증분 방문', unit: '명', cost: '광고 대상 인원', binary: true};
  const m = d?.stored?.mapping, outcome = m?.outcome || '결과';
  return {data: d?.name || id || '데이터', outcome, incR: `증분 ${outcome}`, unit: '', cost: m ? m.cost || '처치 건수' : '비용', binary: false};
}

// ---------- the comparison being set up: kept across pages, so editing code and coming back loses nothing ----------
function initDraft() {
  const base = EXAMPLE.config, saved = load(DRAFT_KEY, null) || {};
  const draft = {...SETTINGS, ...base, ...saved, algorithms: (saved.algorithms || base.algorithms).filter(id => algorithm(id)).slice(0, MAX_ALGORITHMS)};
  if (!dataset(draft.dataset)) draft.dataset = base.dataset;
  state.draft = draft;
}
export function setDraft(patch, kind = 'draft') { Object.assign(state.draft, patch); save(DRAFT_KEY, state.draft); emit(kind); }
export function selectAlgorithm(id, on = true) {
  const list = state.draft.algorithms.filter(x => x !== id);
  if (on && list.length < MAX_ALGORITHMS) list.push(id);
  setDraft({algorithms: list});
}
export function useConfig(config) {
  setDraft({dataset: dataset(config.dataset) ? config.dataset : state.draft.dataset, algorithms: config.algorithms.filter(id => algorithm(id)).slice(0, MAX_ALGORITHMS), cycles: config.cycles, explore: config.explore, target: config.target, seed: config.seed, ...SETTINGS, ...Object.fromEntries(Object.keys(SETTINGS).filter(k => config[k] !== undefined).map(k => [k, config[k]]))});
}
export function sameConfig(a, b) {
  if (!a || !b) return false;
  const set = list => [...list].sort().join();
  const setting = (c, k) => c[k] ?? SETTINGS[k];
  return a.dataset === b.dataset && set(a.algorithms) === set(b.algorithms) && a.cycles === b.cycles && a.explore === b.explore && a.target === b.target && a.seed === b.seed && Object.keys(SETTINGS).every(k => setting(a, k) === setting(b, k));
}
// How one cycle will split, with the same rules as the engine: an uploaded file is cut into per-cycle pools of at most 20,000 rows.
export function planOf(config) {
  const d = dataset(config.dataset), rows = d?.stored?.profile?.rows;
  const cycles = d?.kind === 'synthetic' || !rows ? config.cycles : Math.max(1, Math.min(config.cycles, Math.floor(rows / 400)));
  const pool = d?.kind === 'synthetic' ? d.pool : rows ? Math.min(20000, Math.floor(rows / cycles)) : 20000;
  const exploreN = Math.round(pool * config.explore), candidates = pool - exploreN, selectedN = Math.round(candidates * (config.mode === 'budget' || config.mode === 'knapsack' ? config.budget : config.target));
  return {cycles, pool, exploreN, candidates, selectedN, rest: candidates - selectedN};
}

// ---------- runs ----------
function initRuns() { state.runs = load(RUN_KEY, []).filter(r => r && r.id && r.summary && Array.isArray(r.cycles)); }
function saveRuns() {
  state.runs = state.runs.slice(0, MAX_RUNS);
  state.runs.slice(KEEP_TRACES).forEach(r => r.cycles.forEach(c => delete c.trace));  // only recent runs keep their row samples
  while (state.runs.length && !save(RUN_KEY, state.runs)) state.runs.pop();  // drop the oldest until it fits
}
export const runById = id => (id === 'example' ? EXAMPLE_RUN : state.live?.id === id ? state.live : state.runs.find(r => r.id === id));
export const latestRun = () => state.live || state.runs[0] || EXAMPLE_RUN;
export const running = () => ['starting', 'running', 'paused'].includes(state.live?.status);
export function deleteRun(id) { state.runs = state.runs.filter(r => r.id !== id); if (state.live?.id === id) state.live = null; saveRuns(); emit('runs'); }
export function importRun(text, name) {
  const data = JSON.parse(text);
  if (data.format !== 'upliftlab.run/1' || !data.plan || !Array.isArray(data.cycles) || !data.summary) throw new Error('upliftlab 결과 JSON이 아니에요.');
  const run = {id: 'file-' + Date.now().toString(36), createdAt: Date.now(), imported: name, status: 'done', plan: data.plan, cycles: data.cycles, summary: data.summary,
    config: {dataset: data.plan.dataset, algorithms: data.plan.algorithms.map(a => a.id), cycles: data.plan.cycles, explore: data.plan.explore, target: data.plan.target, seed: data.plan.seed, mode: data.plan.mode, budget: data.plan.budget, efficiency: data.plan.efficiency, baseLearner: data.plan.baseLearner}};
  state.runs.unshift(run); saveRuns(); emit('runs');
  return run.id;
}
export const exportRun = run => JSON.stringify({format: 'upliftlab.run/1', plan: run.plan, cycles: run.cycles, summary: run.summary});

// Rough wall time from the example's measured fit times; the browser engine is a few times slower than native Python.
export function estimate(config) {
  const fitMs = Object.fromEntries(EXAMPLE.summary.arms.map(a => [a.arm, a.trainMs]));
  const factor = state.engine.kind === 'local' ? 1 : 3, slower = config.baseLearner === 'tree' ? 25 : 1;  // measured: Gradient Boosting fits about 25 times slower than Ridge
  const d = dataset(config.dataset), treatments = d?.treatments || d?.stored?.profile?.treatments || 1;  // the built-ins fit once per treatment
  const perCycle = config.algorithms.reduce((sum, id) => sum + (id in fitMs ? fitMs[id] * slower * treatments : 300) * factor + 60, 250);
  const loading = state.engine.kind === 'local' || librariesLoaded ? 0 : 10000;  // measured: the first run in a page loads scikit-learn, about 10 seconds
  return perCycle * config.cycles + loading;
}

export async function startRun(config) {
  if (running()) throw new Error('이미 실행 중인 시뮬레이션이 있어요.');
  const algorithms = config.algorithms.map(algorithm).filter(Boolean).slice(0, MAX_ALGORITHMS);
  const run = {id: 'run-' + Date.now().toString(36), createdAt: Date.now(), config, plan: null, cycles: [], summary: null, status: 'starting', progress: {}, current: null, error: null};
  state.live = run; emit('run');
  const started = performance.now();
  try {
    await ensureDataset(config.dataset);
    run.plan = await call('run_start', {dataset: config.dataset, algorithms: algorithms.map(({id, name, code}) => ({id, name, code})),
      cycles: config.cycles, explore: config.explore, target: config.target, seed: config.seed, mode: config.mode, budget: config.budget, efficiency: config.efficiency ?? .2, base_learner: config.baseLearner});
    if (run.status === 'starting') run.status = 'running';
    emit('run');
    while (run.cycles.length < run.plan.cycles && !run.stop) {
      if (run.status === 'paused') { await new Promise(resolve => { run.resume = resolve; }); continue; }
      const out = await call('run_cycle');
      run.summary = out.summary; delete out.summary;  // the summary holds the pooled offline curves, so each cycle drops its own
      librariesLoaded = true;
      run.cycles.push(out); run.current = null; run.progress = {}; emit('run');
    }
    run.status = run.stop ? 'stopped' : 'done';
  } catch (error) { run.status = 'failed'; run.error = error.message; }
  run.elapsed = performance.now() - started; run.runtime = state.engine.kind;
  if (run.cycles.length) {
    const {progress, current, resume, stop, ...record} = run;  // eslint-disable-line no-unused-vars
    state.runs.unshift(record); saveRuns();
  }
  emit('run');
}
export function pauseRun() { const r = state.live; if (r?.status === 'running') { r.status = 'paused'; emit('run'); } }
export function resumeRun() { const r = state.live; if (r?.status === 'paused') { r.status = 'running'; r.resume?.(); emit('run'); } }
export function stopRun() { const r = state.live; if (!running()) return; r.stop = true; if (r.status === 'paused') { r.status = 'running'; r.resume?.(); } emit('run'); }

function onProgress(data, active) {
  if (active?.method === 'run_cycle' && state.live) {
    state.live.current = data;
    const p = state.live.progress[data.arm] ||= {};
    Object.assign(p, {phase: data.phase}, data.total ? {step: data.step, total: data.total} : {});
    emitSoon('progress');
  } else if (active?.method === 'try_algorithm' && state.activity) {
    state.activity.trace.push(data);
    emitSoon('activity');
  }
}

export async function boot() {
  initAlgorithms(); initRuns();
  await initDatasets().catch(() => {});
  initDraft();
  emit('init');
  try {
    runtime = await createRuntime({onProgress, onStatus: text => { state.engine.text = text; emit('engine'); },
      onLoading: text => { state.engine.loading = text; emit('loading'); }});
    state.engine.kind = runtime.kind;
    const info = await runtime.ready;
    state.engine = {status: 'ready', kind: runtime.kind, info, text: '', loading: ''};
    // The engine says which files its built-ins are: EconML where it is installed (local), the scikit-learn lite files in the browser.
    for (const b of info.algorithms || []) { const a = algorithm(b.id); if (a?.builtin) Object.assign(a, {libraries: b.libraries, code: b.code, file: b.file, summary: b.summary, implementation: b.implementation}); }
    resolveReady();
    for (const a of state.algorithms) if (!a.builtin) check(a);
  } catch (error) {
    state.engine = {status: 'error', kind: runtime?.kind || null, info: null, text: error.message, loading: ''};
    rejectReady(error);
  }
  emit('engine');
}
