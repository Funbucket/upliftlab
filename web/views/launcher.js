// The setup console: a status line of the current settings, then data, models, and the selection rule with its one number, and
// the start bar. Cycles, the Explore share, the base model and the seed fold under 고급 설정 with working defaults.
import {$, esc, int, share, duration, go, BRIEF, MAX_ALGORITHMS, SELECTION, BUDGET_MODES} from '../lib.js?v=0.26.0';
import {state, subscribe, dataset, datasetReady, running, startRun, estimate, algorithm, unavailable, setDraft, selectAlgorithm, planOf, wordsFor} from '../store.js?v=0.26.0';

const CYCLES = [4, 6, 8, 10, 12];
const worst = d => { const levels = (d.stored?.profile?.checks || []).map(c => c.level); return levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : null; };
const order = d => (d.id === 'public/criteo' ? 0 : 1);
const maxCyclesOf = d => { const rows = d?.stored?.profile?.rows ?? d?.rows; return d && d.kind !== 'synthetic' && rows ? Math.max(1, Math.min(12, Math.floor(rows / 400))) : 12; };
const ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The one number of each selection rule. The rest of the run's settings are under 고급 설정.
function knob(c) {
  if (BUDGET_MODES.includes(c.mode)) return {key: 'budget', label: '예산', min: 10, max: 70, note: v => `후보 전원에게 처치할 때 드는 비용의 ${v}%까지 써요. 모든 모델이 같은 예산으로 대상을 골라요.`};
  if (c.mode === 'roi') return {key: 'efficiency', label: '최소 효율 개선', min: 0, max: 100, sign: '+', note: v => `무작위로 고를 때보다 비용 효율이 ${v}% 이상 좋은 사용자까지만 골라요.`};
  if (c.mode === 'validation') return {key: 'target', label: '첫 사이클 선정 비율', min: 10, max: 70, note: v => `모델이 없는 사이클 1에는 후보의 ${v}%를 무작위로 골라요. 그다음부터는 validation에서 비율을 정해요.`};
  return {key: 'target', label: '선정 비율', min: 10, max: 70, note: v => `후보 중 모델 점수 상위 ${v}%를 골라요. 모든 모델이 같은 인원을 골라요.`};
}

export function launcherPanel(el) {
  let message = '';
  el.innerHTML = `<div class="cs-status" id="l-status" aria-label="현재 설정"></div>
    <div class="cs-panes">
      <div class="cs-pane"><h3>데이터</h3><div class="cs-data" role="radiogroup" aria-label="데이터" id="l-data"></div></div>
      <div class="cs-pane"><h3>모델<small id="l-count"></small></h3><div id="l-models"></div></div>
      <div class="cs-pane"><h3>선정 방식과 예산</h3><div id="l-rule"></div><div class="cs-gauge" id="l-knob"></div></div>
    </div>
    <div class="cs-go"><button type="button" class="adv-toggle" data-act="advanced" aria-expanded="false" aria-controls="l-adv"><b>고급 설정</b><small id="l-adv-sum"></small></button><div class="go-right" id="l-go"></div></div>
    <div class="advanced" id="l-adv" hidden></div>`;

  function status() {
    const c = state.draft, d = dataset(c.dataset), k = knob(c), engine = state.engine;
    const chips = [['Data', d?.name?.split(' ')[0] || '—'], ['Models', c.algorithms.length], ['Rule', SELECTION[c.mode]?.name], [k.key === 'budget' ? 'Budget' : 'Value', `${k.sign || ''}${Math.round(c[k.key] * 100)}%`], ['Cycles', planOf(c).cycles], ['Explore', share(c.explore)], ['Run', engine.kind === 'local' ? 'Local' : 'Browser']];
    $('#l-status', el).innerHTML = chips.map(([key, value]) => `<span class="cs-chip"><span class="caps">${key}</span><b>${esc(value)}</b></span>`).join('');
  }
  function data() {
    const draft = state.draft, list = state.datasets.filter(d => d.kind !== 'synthetic' && (d.kind !== 'upload' || d.stored)).sort((a, b) => order(a) - order(b));
    const tile = d => {
      const on = draft.dataset === d.id, ready = datasetReady(d), flag = worst(d), rows = d.kind === 'public' ? d.rows : d.stored?.profile?.rows, W = wordsFor(d.id);
      return `<button type="button" role="radio" class="cs-tile" data-dataset="${esc(d.id)}" aria-checked="${on}" ${ready ? '' : 'disabled'}>
        <b>${esc(d.name)}${d.id === 'public/criteo' ? '<em class="tag tag-solid">추천</em>' : ''}${flag ? `<em class="tag ${flag === 'bad' ? 'tag-red' : 'tag-amber'}">검사 ${flag === 'bad' ? '오류' : '경고'}</em>` : ''}</b>
        <span class="cs-stats"><span><strong class="fig">${int(rows)}</strong>${d.kind === 'public' ? '사용자' : '행'}</span><span><strong>${esc(W.outcome)}</strong>결과</span>${d.kind === 'public' ? '<span><strong>공개</strong>무작위 실험</span>' : '<span><strong>내 CSV</strong>업로드</span>'}</span></button>`;
    };
    $('#l-data', el).innerHTML = list.map(tile).join('')
      + '<a class="cs-tile cs-add" href="#/data?upload=1"><b>+ 내 CSV 올리기</b><small>처치를 무작위로 나눈 실험 로그 · 예시 파일로 먼저 해 볼 수 있어요</small></a>'
      + `<a class="step-link" href="#/data/${encodeURIComponent(draft.dataset)}">고른 데이터 자세히 보기</a>`;
  }
  function models() {
    const c = state.draft, full = c.algorithms.length >= MAX_ALGORITHMS;
    const chip = a => {
      const on = c.algorithms.includes(a.id), gone = unavailable(a), broken = a.ok === false || !!gone, off = broken || (!on && full);
      const note = gone ? gone.text : a.ok === false ? `${a.line ? a.line + '번째 줄 · ' : ''}${a.error}` : BRIEF[a.id] || a.summary || '';
      return `<label class="cs-model ${on ? 'is-on' : ''} ${off ? 'is-off' : ''}"><input type="checkbox" value="${esc(a.id)}" ${on ? 'checked' : ''} ${off && !on ? 'disabled' : ''}><span class="mark mark-check" aria-hidden="true"></span>
        <span class="cs-model-text"><b>${esc(a.name)}</b>${a.builtin ? '' : '<em class="tag tag-blue">내 코드</em>'}${gone ? `<em class="tag tag-red">${esc(gone.short)}</em>` : a.ok === false ? '<em class="tag tag-red">오류</em>' : ''}<small title="${esc(note)}">${esc(note)}</small></span><a class="opt-link" href="#/algorithms/${encodeURIComponent(a.id)}">코드</a></label>`;
    };
    $('#l-count', el).textContent = `${c.algorithms.length}개 선택`;
    $('#l-models', el).innerHTML = `<div class="cs-models">${state.algorithms.map(chip).join('')}<a class="cs-model cs-add" href="#/algorithms?new=1"><b>+ 내 알고리즘 추가</b></a></div>`;
  }
  function rule() {
    const c = state.draft;
    $('#l-rule', el).innerHTML = `<div class="cs-rules" role="radiogroup" aria-label="선정 방식">${Object.entries(SELECTION).map(([value, m]) => `<button type="button" role="radio" aria-checked="${c.mode === value}" class="cs-rule ${c.mode === value ? 'is-on' : ''}" data-set="mode" data-value="${value}" title="${esc(m.rule)}"><b>${m.name}</b><small>${m.who.map(w => w[0]).slice(0, 2).join(' · ')}</small></button>`).join('')}</div>`;
    const k = knob(c), v = Math.round(c[k.key] * 100), at = (v - k.min) / (k.max - k.min) * 100;
    $('#l-knob', el).style.setProperty('--v', `${at}%`);
    $('#l-knob', el).innerHTML = `<p class="knob-value"><span>${esc(k.label)}</span><b class="fig" data-out>${k.sign || ''}${v}%</b></p>
      <div class="cs-track"><span class="cs-fill"></span><span class="cs-knob"></span><input type="range" min="${k.min}" max="${k.max}" step="5" value="${v}" data-range="${k.key}" aria-label="${esc(k.label)}"></div>
      <p class="knob-note" data-note>${esc(k.note(v))}</p>`;
  }
  function goView() {
    const c = state.draft, d = dataset(c.dataset), n = c.algorithms.length, engine = state.engine, gone = c.algorithms.map(algorithm).find(a => a && unavailable(a));
    const blocked = running() ? '실행 중인 비교가 끝나면 새로 시작할 수 있어요.' : engine.status === 'error' ? `엔진을 불러오지 못했어요 · ${engine.text}` : !n ? '모델을 하나 이상 골라 주세요.'
      : !datasetReady(d) ? '데이터를 먼저 올려 주세요.' : gone ? `${gone.name} · ${unavailable(gone).text}` : '';
    const where = engine.kind === 'local' ? `이 컴퓨터(${engine.info?.device || 'cpu'})` : '브라우저', note = message || blocked;
    $('#l-go', el).innerHTML = `<p class="go-note ${note && !running() ? 'is-warn' : ''}">${esc(note || `모델 ${n}개 · 예상 ${duration(estimate(c))} · ${where}에서 실행`)}</p>
      <button type="button" class="btn btn-primary btn-go" data-act="run" ${blocked ? 'disabled' : ''}>${running() ? '비교 중…' : `비교 시작${ARROW}`}</button>`;
  }
  function summary() {
    const c = state.draft, p = planOf(c);
    $('#l-adv-sum', el).textContent = `${p.cycles}사이클 · Explore ${share(c.explore)} · ${c.baseLearner === 'tree' ? 'Gradient Boosting' : 'Ridge'} · 시드 ${c.seed}`;
  }
  function advanced() {
    const c = state.draft, maxCycles = maxCyclesOf(dataset(c.dataset)), p = planOf(c);
    const range = (key, label, min, max, help, text) => `<label class="field"><span class="field-label">${label}<b>${text}</b></span><input type="range" min="${min}" max="${max}" step="5" value="${Math.round(c[key] * 100)}" data-range="${key}" style="--v:${(c[key] * 100 - min) / (max - min) * 100}%"><small>${help}</small></label>`;
    const choice = (key, label, options, help) => `<div class="field"><span class="field-label">${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${options.map(([value, text]) => `<button type="button" role="radio" aria-checked="${c[key] === value}" data-set="${key}" data-value="${value}">${text}</button>`).join('')}</div><small>${help}</small></div>`;
    $('#l-adv', el).innerHTML = `<div class="field"><span class="field-label">사이클 수</span><div class="seg" role="radiogroup" aria-label="사이클 수">${CYCLES.map(n => `<button type="button" role="radio" aria-checked="${c.cycles === n}" data-cycles="${n}" ${n > maxCycles ? 'disabled' : ''}>${n}</button>`).join('')}</div><small>순위는 모델이 배포된 사이클 2부터 합산해요.</small></div>
      ${range('explore', 'Explore 비율 ε', 5, 40, '후보 중 무작위로 고르는 비율이에요. 모델 학습과 비교 기준(benchmark)에 써요. 높이면 학습 데이터가 늘고 모델이 고르는 인원은 줄어요.', `${share(c.explore)} · ${int(p.exploreN)}명`)}
      ${c.mode === 'roi' ? range('target', '사이클 1 선정 비율', 10, 70, '모델이 없는 사이클 1에 무작위로 고를 비율이에요.', `${share(c.target)} · ${int(p.selectedN)}명`) : ''}
      ${choice('baseLearner', '기본 모델', [['ridge', 'Ridge'], ['tree', 'Gradient Boosting']], '기본 알고리즘 안의 회귀 모델이에요. Gradient Boosting은 비선형 효과를 배우지만 학습이 약 25배 오래 걸려요.')}
      <label class="field"><span class="field-label">시드</span><input type="number" class="input" min="0" max="999999" step="1" value="${c.seed}" data-seed><small>같은 시드면 결과를 그대로 재현할 수 있어요.</small></label>`;
  }
  function all() { status(); data(); models(); rule(); goView(); summary(); if (!$('#l-adv', el).hidden) advanced(); }
  all();

  function clampCycles() {
    const maxCycles = maxCyclesOf(dataset(state.draft.dataset));
    if (state.draft.cycles > maxCycles) setDraft({cycles: CYCLES.filter(n => n <= maxCycles).at(-1) || maxCycles});
  }
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-dataset], [data-set], [data-cycles], [data-act]'); if (!t) return;
    message = '';
    if (t.dataset.dataset) { setDraft({dataset: t.dataset.dataset}); clampCycles(); all(); return; }
    if (t.dataset.set) { setDraft({[t.dataset.set]: t.dataset.value}); all(); return; }
    if (t.dataset.cycles) { setDraft({cycles: Number(t.dataset.cycles)}); all(); return; }
    if (t.dataset.act === 'advanced') {
      const box = $('#l-adv', el), open = box.hidden;
      box.hidden = !open; t.setAttribute('aria-expanded', String(open)); if (open) advanced();
      return;
    }
    if (t.dataset.act === 'run') {
      const ids = state.algorithms.map(a => a.id), config = {...state.draft, algorithms: ids.filter(id => state.draft.algorithms.includes(id))};
      startRun(config).catch(error => { message = error.message; goView(); });
      if (state.live) { state.scrollToResults = true; go('#/runs/' + state.live.id); }
    }
  });
  el.addEventListener('change', e => {
    const t = e.target; message = '';
    if (t.type === 'checkbox') { selectAlgorithm(t.value, t.checked); models(); goView(); status(); }
    else if (t.matches('[data-seed]')) { const seed = Math.max(0, Math.min(999999, Math.round(Number(t.value) || 0))); t.value = seed; setDraft({seed}); summary(); }
  });
  el.addEventListener('input', e => {
    const t = e.target.closest('[data-range]'); if (!t) return;
    const at = `${(t.value - t.min) / (t.max - t.min) * 100}%`;
    (t.closest('#l-knob') || t).style.setProperty('--v', at);
    setDraft({[t.dataset.range]: Number(t.value) / 100});
    const k = knob(state.draft), v = Number(t.value);
    if (t.closest('#l-knob')) { $('[data-out]', el).textContent = `${k.sign || ''}${v}%`; $('[data-note]', el).textContent = k.note(v); }
    else { const label = t.closest('.field')?.querySelector('.field-label b'), p = planOf(state.draft); if (label) label.textContent = t.dataset.range === 'explore' ? `${share(state.draft.explore)} · ${int(p.exploreN)}명` : `${share(state.draft.target)} · ${int(p.selectedN)}명`; }
    goView(); summary(); status();
  });
  const off = subscribe(kind => {
    if (kind === 'algorithms' || kind === 'datasets' || kind === 'engine') all();
    else if (kind === 'run') goView();
  });
  return {destroy: off};
}
