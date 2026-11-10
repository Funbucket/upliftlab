// The main screen: what it does, the three-step launcher, and the result right below it.
import {$, go} from '../lib.js?v=0.25.0';
import {state, runById, latestRun, setDraft, selectAlgorithm, dataset, datasetReady, running, startRun} from '../store.js?v=0.25.0';
import {launcherPanel} from './launcher.js?v=0.25.0';
import {resultsPanel} from './results.js?v=0.25.0';

export function workspaceView(root, {id, query}) {
  const data = query.get('data'), algo = query.get('algo');
  if (data && datasetReady(dataset(data))) setDraft({dataset: data});
  if (algo && !state.draft.algorithms.includes(algo)) selectAlgorithm(algo);
  // "이 데이터로 바로 실행" on a dataset page: start with the current settings and show the run. The address loses run=1
  // first, so going back does not start it again.
  if (query.get('run') && data && datasetReady(dataset(data)) && !running() && state.engine.status !== 'error') {
    history.replaceState(null, '', `${location.pathname}${location.search}#/?data=${encodeURIComponent(data)}`);
    const order = state.algorithms.map(a => a.id);
    startRun({...state.draft, algorithms: order.filter(a => state.draft.algorithms.includes(a))}).catch(() => {});
    if (state.live) { state.scrollToResults = true; go('#/runs/' + state.live.id); return {destroy() {}}; }
  }
  const run = (id && runById(id)) || latestRun();
  root.innerHTML = `<div class="work"><header class="hero"><h1>어떤 모델로 대상을 고를지, 같은 예산으로 경쟁시켜 정해요</h1>
      <p>데이터를 고르고 예산을 정한 뒤 비교를 시작하면, uplift 모델들이 운영 환경처럼 대상을 고르고 효과를 재며 경쟁해요. 1위 모델과, 무작위로 고를 때보다 늘어나는 성과를 바로 보여 줘요. 데이터는 이 컴퓨터 밖으로 나가지 않아요.</p></header>
    <section class="launch" id="launcher" aria-label="비교 설정"></section><div class="main" id="main"></div></div>`;
  const launcher = launcherPanel($('#launcher', root)), main = resultsPanel($('#main', root), run);
  if (state.scrollToResults) { state.scrollToResults = false; requestAnimationFrame(() => $('#main', root)?.scrollIntoView({behavior: 'smooth', block: 'start'})); }
  return {destroy: () => { launcher.destroy(); main.destroy(); }};
}
