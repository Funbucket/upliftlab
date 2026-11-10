// Shell: header, router and the engine chip. Views live in ./views and read from ./store.
import {$, esc, go} from './lib.js?v=0.24.0';
import {state, subscribe, boot, running} from './store.js?v=0.24.0';
import {workspaceView} from './views/workspace.js?v=0.24.0';
import {algorithmsView} from './views/algorithms.js?v=0.24.0';
import {dataView} from './views/data.js?v=0.24.0';

const routes = [
  [/^\/?$/, workspaceView, () => ({})],
  [/^\/runs\/(.+)$/, workspaceView, m => ({id: decodeURIComponent(m[1])})],
  [/^\/algorithms(?:\/(.+))?$/, algorithmsView, m => ({id: m[1] && decodeURIComponent(m[1])})],
  [/^\/data(?:\/(.+))?$/, dataView, m => ({id: m[1] && decodeURIComponent(m[1])})],
];
const app = $('#app');
let view = null, path = null;

function route() {
  if (location.hash === '#/') history.replaceState(null, '', location.pathname + location.search);  // the home page is just the address
  const [p, q = ''] = location.hash.replace(/^#/, '').split('?');
  const hit = routes.find(([re]) => re.test(p));
  if (!hit) { go('#/'); return; }
  const [re, mount, params] = hit;
  view?.destroy?.();
  const el = document.createElement('div');  // a fresh element per mount, so a view's listeners leave with it
  app.replaceChildren(el);
  view = mount(el, {...params(p.match(re)), query: new URLSearchParams(q)});
  if (p !== path) window.scrollTo(0, 0);
  path = p;
}

function chrome() {
  const e = state.engine, chip = $('#runtime');
  chip.dataset.kind = e.status === 'ready' ? e.kind : e.status;
  chip.querySelector('span').textContent = e.status === 'ready' ? (e.kind === 'local' ? `로컬 실행 · ${e.info.device}` : '브라우저 실행') : e.status === 'error' ? '엔진 오류' : '엔진 준비 중';
  const info = e.info;
  $('#runtime-now').innerHTML = e.status === 'ready'
    ? (e.kind === 'local' ? `로컬 Python ${esc(info.python)} · NumPy ${esc(info.numpy)} · ${esc(info.devices.join(', '))}에서 실행 중이에요. 알고리즘은 설치된 모든 패키지를 쓸 수 있어요.`
      : `브라우저 안의 Python ${esc(info.python)}(Pyodide)에서 실행 중이에요. 알고리즘이 import하는 라이브러리는 처음 쓸 때 내려받아요. 업로드한 데이터와 코드는 브라우저 밖으로 전송되지 않아요.`)
    : e.status === 'error' ? `엔진을 불러오지 못했어요 · ${esc(e.text)}. 네트워크를 확인하거나 로컬에서 실행해 주세요.` : esc(e.text || '엔진을 준비하고 있어요');
  $('#runtime-local').hidden = e.kind === 'local';
  const pill = $('#live-pill'), r = state.live;
  pill.hidden = !running();
  if (running()) { pill.href = '#/runs/' + r.id; pill.textContent = `실행 중 · ${Math.min(r.cycles.length + 1, r.plan?.cycles || r.config.cycles)}/${r.plan?.cycles || r.config.cycles}`; }
}

document.addEventListener('click', e => {
  const button = e.target.closest('#runtime, #runtime-local'), pop = $('#runtime-pop');
  if (button) { pop.hidden = !pop.hidden; button.setAttribute('aria-expanded', String(!pop.hidden)); return; }
  if (!e.target.closest('#runtime-pop')) { pop.hidden = true; $('#runtime').setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#runtime-pop').hidden = true; });
window.addEventListener('hashchange', route);
subscribe(kind => { if (kind === 'init') route(); if (kind !== 'activity' && kind !== 'draft') chrome(); });  // route once saved data is loaded
boot();
chrome();
