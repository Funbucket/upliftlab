// Shell: header, router and the engine chip. Views live in ./views and read from ./store.
import {$, esc, go} from './lib.js?v=0.26.5';
import {lang, tr, setLang, translateStatic} from './i18n.js?v=0.26.5';
import {state, subscribe, boot, running} from './store.js?v=0.26.5';
import {workspaceView} from './views/workspace.js?v=0.26.5';
import {algorithmsView} from './views/algorithms.js?v=0.26.5';
import {dataView} from './views/data.js?v=0.26.5';

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
  const section = p.split('/')[1] === 'data' || p.split('/')[1] === 'algorithms' ? p.split('/')[1] : '';
  document.querySelectorAll('[data-nav]').forEach(link => (link.dataset.nav === section ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current')));
  if (p !== path) window.scrollTo(0, 0);
  path = p;
}

function chrome() {
  const e = state.engine, chip = $('#runtime');
  chip.dataset.kind = e.status === 'ready' ? e.kind : e.status;
  chip.querySelector('span').textContent = e.status === 'ready' ? (e.kind === 'local' ? `${tr('로컬 실행', 'Local')} · ${e.info.device}` : tr('브라우저 실행', 'In browser')) : e.status === 'error' ? tr('엔진 오류', 'Engine error') : tr('엔진 준비 중', 'Starting engine');
  const info = e.info;
  $('#runtime-now').innerHTML = e.status === 'ready'
    ? (e.kind === 'local' ? tr(`로컬 Python ${esc(info.python)} · NumPy ${esc(info.numpy)} · ${esc(info.devices.join(', '))}에서 실행 중이에요. 알고리즘은 설치된 모든 패키지를 쓸 수 있어요.`, `Your local Python ${esc(info.python)} · NumPy ${esc(info.numpy)} · ${esc(info.devices.join(', '))}. Algorithms can use every package you have installed.`)
      : tr(`브라우저 안의 Python ${esc(info.python)}(Pyodide)에서 실행 중이에요. 알고리즘이 import하는 라이브러리는 처음 쓸 때 내려받아요. 업로드한 데이터와 코드는 브라우저 밖으로 전송되지 않아요.`, `Python ${esc(info.python)} inside this browser tab (Pyodide). Libraries an algorithm imports download on first use. Uploaded data and code never leave the browser.`))
    : e.status === 'error' ? tr(`엔진을 불러오지 못했어요 · ${esc(e.text)}. 네트워크를 확인하거나 로컬에서 실행해 주세요.`, `The engine did not load · ${esc(e.text)}. Check the network, or run it locally.`) : esc(e.text || tr('엔진을 준비하고 있어요', 'Starting the engine'));
  $('#runtime-local').hidden = e.kind === 'local';
  $('#runtime-install').hidden = e.kind === 'local';  // the local edition is already installed
  const pill = $('#live-pill'), r = state.live;
  pill.hidden = !running();
  if (running()) { pill.href = '#/runs/' + r.id; pill.textContent = `${tr('실행 중', 'Running')} · ${Math.min(r.cycles.length + 1, r.plan?.cycles || r.config.cycles)}/${r.plan?.cycles || r.config.cycles}`; }
}

document.addEventListener('click', e => {
  const pick = e.target.closest('[data-lang]');
  if (pick) { setLang(pick.dataset.lang); return; }
  const button = e.target.closest('#runtime, #runtime-local'), pop = $('#runtime-pop');
  if (button) { pop.hidden = !pop.hidden; button.setAttribute('aria-expanded', String(!pop.hidden)); return; }
  if (!e.target.closest('#runtime-pop')) { pop.hidden = true; $('#runtime').setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#runtime-pop').hidden = true; });
window.addEventListener('hashchange', route);
subscribe(kind => { if (kind === 'init') route(); if (kind !== 'activity' && kind !== 'draft') chrome(); });  // route once saved data is loaded
translateStatic();
document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
boot();
chrome();
