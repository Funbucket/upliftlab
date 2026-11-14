// The main screen: the hero with the timing tower, the setup console, the result of the run, how a cycle works, and how to run
// it locally. The local edition is used by people who already installed it, so it opens on the console and the result only.
import {$, esc, go} from '../lib.js?v=0.26.5';
import {state, runById, latestRun, setDraft, selectAlgorithm, dataset, datasetReady, running, startRun} from '../store.js?v=0.26.5';
import {launcherPanel} from './launcher.js?v=0.26.5';
import {resultsPanel} from './results.js?v=0.26.5';
import {towerPanel, loopPanel, installPanel} from './home.js?v=0.26.5';
import {EN, tr} from '../i18n.js?v=0.26.5';

const DOCS = EN ? ['Docs', 'https://github.com/Funbucket/upliftlab/blob/main/README.en.md'] : ['사용 안내', 'https://github.com/Funbucket/upliftlab/blob/main/docs/guide.md'];

const STEPS = EN ? [
  ['Select targets', 'Each model ranks users by score and picks whom to treat within the same budget.'],
  ['Split into treatment and control', 'The selected users are split at random, and every model shares the same Explore group.'],
  ['Measure the effect', 'Treatment minus control gives the outcome the treatment really added.'],
  ['Retrain', 'Every model retrains on recent Explore data and moves to the next cycle.'],
] : [
  ['대상을 골라요', '모델마다 점수가 높은 순으로, 같은 예산 안에서 처치할 사용자를 골라요.'],
  ['처치군과 대조군으로 나눠요', '고른 사용자를 무작위로 나누고, 모든 모델이 같은 Explore 그룹을 써요.'],
  ['효과를 재요', '처치군과 대조군의 차이로 실제로 늘어난 성과를 계산해요.'],
  ['다시 학습해요', '최근 사이클의 Explore 데이터로 재학습하고 다음 사이클로 넘어가요.'],
];

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
  if (state.engine.kind === 'local') return localView(root, run);
  root.innerHTML = `<div class="home">
    <section class="hero" id="hero"><div class="wrap hero-in">
      <div class="hero-copy"><p class="kick caps"><i></i>Uplift model benchmark</p>
        ${EN ? `<h1><span class="gauge-word">Same budget<span class="gw" aria-hidden="true"><i></i></span></span>,<br>models race.</h1>
        <p class="lede">Uplift models select targets, measure the effect and retrain, cycle after cycle, as in production. The ranking adds up the outcome each one really added.</p>`
        : `<h1><span class="gauge-word">같은 예산<span class="gw" aria-hidden="true"><i></i></span></span>을 주고,<br>모델끼리 겨뤄요.</h1>
        <p class="lede">uplift 모델들이 운영처럼 대상을 고르고, 효과를 재고, 다시 학습해요. 사이클마다 실제로 늘어난 성과를 쌓아 순위를 매겨요.</p>`}
        <div class="hero-cta"><button type="button" class="btn btn-primary btn-hero" data-scroll="setup">${tr('비교 시작', 'Start')}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><a class="btn btn-line btn-hero" href="#/data?upload=1">${tr('내 CSV로 해 보기', 'Try my CSV')}</a></div>
        <p class="hero-meta"><span>${tr('설치 없이 브라우저에서', 'Runs in your browser')}</span><span>${tr('데이터는 밖으로 안 나가요', 'Your data stays with you')}</span><span>${tr('기본 모델 6개', '6 built-in models')}</span></p></div>
      <div class="tower" id="tower" role="group" aria-label="${tr('예시 결과를 사이클마다 다시 보여 주는 순위표', 'Standings replaying the example cycle by cycle')}"></div>
    </div></section>
    <section class="band" id="setup"><div class="wrap"><div class="band-head"><h2>${tr('고르고, 출발.', 'Pick, then go.')}<em>${tr('기본값 그대로도 돼요.', 'The defaults work too.')}</em></h2><p>${tr('데이터, 모델, 선정 방식과 예산만 정하면 돼요. 사이클 수와 시드는 고급 설정에 있어요.', 'Choose the data, the models, the selection rule and the budget. Cycles and seed are under Advanced.')}</p></div>
      <section class="console" id="launcher" aria-label="${tr('비교 설정', 'Comparison settings')}"></section></div></section>
    <section class="band band-result"><div class="wrap"><div class="main" id="main"></div></div></section>
    <section class="band" id="loop"><div class="wrap"><div class="band-head"><h2>${tr('한 사이클은 한 바퀴.', 'One cycle, one lap.')}<em>${tr('매 바퀴 같은 조건으로.', 'Same conditions every lap.')}</em></h2><p>${tr('오프라인 지표 하나로는 안 보이는 차이를 보려고, 운영 루프를 사이클마다 그대로 반복해요.', 'To see what one offline metric misses, the production loop runs again every cycle.')}</p></div>
      <div class="loop"><svg class="lp" viewBox="0 0 640 350" role="img" aria-label="${tr('선정, 처치와 대조, 측정, 재학습을 도는 사이클', 'A cycle of selecting, treatment and control, measuring and retraining')}"></svg>
        <ol class="lp-steps">${STEPS.map(([b, p], i) => `<li><span class="caps">S${i + 1}</span><b>${b}</b><p>${p}</p></li>`).join('')}</ol></div></div></section>
    <section class="band" id="install"><div class="wrap"><div class="band-head"><h2>${tr('로컬에서는 한 줄.', 'Locally, one line.')}<em>${tr('EconML로, 내 데이터 그대로.', 'EconML, on your own data.')}</em></h2><p>${tr('같은 화면이 내 Python에서 열려요. 큰 데이터와 이미 깔린 라이브러리, GPU를 그대로 써요.', 'The same screen opens from your own Python, with large data, the libraries you have and your GPU.')}</p></div>
      <div class="inst"><div class="in" id="in"></div><ol class="in-after">${(EN ? [['Install in one line', 'pip or uvx. The six built-in models come with EconML.'], ['Download the Criteo sample once', 'The first run downloads 2.3 MB into a cache and reuses it after that.'], ['Your browser opens', 'Use this same screen at <code>http://127.0.0.1:4180</code>.']]
        : [['한 줄로 설치해요', 'pip이나 uvx 한 줄이에요. 기본 모델 6개가 EconML로 함께 설치돼요.'], ['Criteo 표본을 한 번 받아요', '처음 실행할 때 2.3MB를 내려받아 캐시에 두고, 그다음부터는 그대로 써요.'], ['브라우저가 열려요', '<code>http://127.0.0.1:4180</code>에서 이 화면을 그대로 써요.']]).map(([b, t], i) => `<li><span class="caps">0${i + 1}</span><b>${b}</b><p>${t}</p></li>`).join('')}</ol></div></div></section>
    <footer class="foot"><div class="wrap"><p class="foot-line">${tr('같은 예산이면,<br><span>더 남기는 모델로.</span>', 'Same budget,<br><span>the model that earns more.</span>')}</p>
      <nav><a href="https://github.com/Funbucket/upliftlab" target="_blank" rel="noopener">GitHub</a><a href="${DOCS[1]}" target="_blank" rel="noopener">${DOCS[0]}</a><a href="https://github.com/Funbucket/upliftlab/blob/main/CHANGELOG.md" target="_blank" rel="noopener">${tr('변경 기록', 'Changelog')}</a><span>${tr('MIT · Criteo 표본 CC BY-NC-SA 4.0', 'MIT · Criteo sample CC BY-NC-SA 4.0')}</span></nav></div></footer></div>`;
  const parts = [launcherPanel($('#launcher', root)), resultsPanel($('#main', root), run), towerPanel($('#tower', root)), loopPanel($('.lp', root), $('.lp-steps', root)), installPanel($('#in', root))];
  requestAnimationFrame(() => $('#hero', root)?.classList.add('is-on'));
  root.addEventListener('click', e => { const t = e.target.closest('[data-scroll]'); if (t) $(`#${t.dataset.scroll}`, root)?.scrollIntoView({behavior: 'smooth', block: 'start'}); });
  if (state.scrollToResults) { state.scrollToResults = false; requestAnimationFrame(() => $('#main', root)?.scrollIntoView({behavior: 'smooth', block: 'start'})); }
  return {destroy: () => parts.forEach(p => p.destroy())};
}

// The local edition: settings and result, nothing to introduce. A run still scrolls to its result.
function localView(root, run) {
  const v = state.engine.info?.engine || '';
  root.innerHTML = `<div class="home is-local">
    <section class="band band-tight" id="setup"><div class="wrap"><section class="console" id="launcher" aria-label="${tr('비교 설정', 'Comparison settings')}"></section></div></section>
    <section class="band band-result"><div class="wrap"><div class="main" id="main"></div></div></section>
    <footer class="foot foot-local"><div class="wrap"><nav><span>upliftlab ${esc(v)} · ${tr('로컬 실행', 'local')}</span><a href="${DOCS[1]}" target="_blank" rel="noopener">${DOCS[0]}</a><a href="https://github.com/Funbucket/upliftlab/blob/main/CHANGELOG.md" target="_blank" rel="noopener">${tr('변경 기록', 'Changelog')}</a><a href="https://github.com/Funbucket/upliftlab/issues/new/choose" target="_blank" rel="noopener">${tr('문제 알리기', 'Report a problem')}</a><a href="https://github.com/Funbucket/upliftlab" target="_blank" rel="noopener">GitHub</a></nav></div></footer></div>`;
  const parts = [launcherPanel($('#launcher', root)), resultsPanel($('#main', root), run)];
  if (state.scrollToResults) { state.scrollToResults = false; requestAnimationFrame(() => $('#main', root)?.scrollIntoView({behavior: 'smooth', block: 'start'})); }
  return {destroy: () => parts.forEach(p => p.destroy())};
}
