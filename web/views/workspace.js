// The main screen: settings on the left, results on the right.
import {$} from '../lib.js?v=0.22.0';
import {state, runById, latestRun, setDraft, selectAlgorithm, dataset, datasetReady} from '../store.js?v=0.22.0';
import {sidePanel} from './side.js?v=0.22.0';
import {resultsPanel} from './results.js?v=0.22.0';

export function workspaceView(root, {id, query}) {
  const data = query.get('data'), algo = query.get('algo');
  if (data && datasetReady(dataset(data))) setDraft({dataset: data});
  if (algo && !state.draft.algorithms.includes(algo)) selectAlgorithm(algo);
  const run = (id && runById(id)) || latestRun();
  root.innerHTML = '<div class="work"><div class="work-hero" id="work-hero"></div><aside class="side" id="side" aria-label="비교 설정"></aside><div class="main" id="main"></div></div>';
  const side = sidePanel($('#side', root)), main = resultsPanel($('#main', root), $('#work-hero', root), run);
  return {destroy: () => { side.destroy(); main.destroy(); }};
}
