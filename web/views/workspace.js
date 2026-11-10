// The main screen: settings on the left, results on the right.
import {$, go} from '../lib.js?v=0.24.0';
import {state, runById, latestRun, setDraft, selectAlgorithm, dataset, datasetReady, running, startRun} from '../store.js?v=0.24.0';
import {sidePanel} from './side.js?v=0.24.0';
import {resultsPanel} from './results.js?v=0.24.0';

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
    if (state.live) { go('#/runs/' + state.live.id); return {destroy() {}}; }
  }
  const run = (id && runById(id)) || latestRun();
  root.innerHTML = '<div class="work"><div class="work-hero" id="work-hero"></div><aside class="side" id="side" aria-label="비교 설정"></aside><div class="main" id="main"></div></div>';
  const side = sidePanel($('#side', root)), main = resultsPanel($('#main', root), $('#work-hero', root), run);
  return {destroy: () => { side.destroy(); main.destroy(); }};
}
