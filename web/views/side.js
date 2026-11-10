// The left panel: dataset, algorithms, settings and the run button.
import {$, $$, esc, int, share, duration, go, BRIEF, MAX_ALGORITHMS, SELECTION, BUDGET_MODES, selectionLabel} from '../lib.js?v=0.24.0';
import {state, subscribe, dataset, datasetReady, running, startRun, estimate, algorithm, unavailable, setDraft, selectAlgorithm, planOf} from '../store.js?v=0.24.0';

const CYCLES = [4, 6, 8, 10, 12];
const worst = d => { const levels = (d.stored?.profile?.checks || []).map(c => c.level); return levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : null; };

export function sidePanel(el) {
  let message = '';
  const compact = window.matchMedia('(max-width: 900px)').matches;
  el.innerHTML = `<details class="side-sec" ${compact ? '' : 'open'}><summary><h2><span class="n">1</span>데이터셋</h2><small id="side-data-now"></small></summary><p class="side-hint">시뮬레이션에 사용할 데이터셋을 선택해요.</p><div id="side-data"></div></details>
    <details class="side-sec" ${compact ? '' : 'open'}><summary><h2><span class="n">2</span>알고리즘</h2><small id="side-count"></small></summary><p class="side-hint">비교할 uplift 알고리즘을 선택해요. 코드를 수정하거나 추가할 수 있어요.</p><div id="side-algos"></div></details>
    <section class="side-run"><h2 class="side-run-title"><span class="n">3</span>실행</h2><details class="side-settings"><summary id="side-summary"></summary><div id="side-settings"></div></details><div id="side-go"></div></section>`;

  function data() {
    const draft = state.draft;
    const row = d => {
      const ready = datasetReady(d), on = draft.dataset === d.id, flag = worst(d);
      const note = d.kind === 'public' ? (d.bundled ? `공개 실험 · 표본 ${int(d.rows)}행` : d.stored ? `공개 실험 · ${int(d.stored.profile?.rows)}행` : state.engine.kind === 'local' ? '공개 실험 · 실행 시 다운로드' : '공개 실험 · 파일 업로드 필요') : d.kind === 'upload' ? `업로드 · ${int(d.stored?.profile?.rows)}행` : '';
      return `<label class="opt ${on ? 'is-on' : ''} ${ready ? '' : 'is-off'}"><input type="radio" name="dataset" value="${esc(d.id)}" ${on ? 'checked' : ''} ${ready ? '' : 'disabled'}><span class="mark mark-radio" aria-hidden="true"></span>
        <span class="opt-text"><b>${esc(d.name)}</b>${flag ? `<em class="tag ${flag === 'bad' ? 'tag-red' : 'tag-amber'}">검사 ${flag === 'bad' ? '오류' : '경고'}</em>` : ''}${note ? `<small>${esc(note)}</small>` : ''}${on && d.summary ? `<small class="opt-wrap">${esc(d.summary)}</small>` : ''}</span><a class="opt-link" href="#/data/${encodeURIComponent(d.id)}">${ready ? '상세' : '업로드'}</a></label>`;
    };
    $('#side-data', el).innerHTML = `<div class="opts">${state.datasets.map(row).join('')}</div><a class="side-add" href="#/data?upload=1">+ CSV 업로드</a>`;
    $('#side-data-now', el).textContent = dataset(draft.dataset)?.name || '';
  }
  function algos() {
    const draft = state.draft, full = draft.algorithms.length >= MAX_ALGORITHMS;
    const row = a => {
      const on = draft.algorithms.includes(a.id), gone = unavailable(a), broken = a.ok === false || !!gone, off = broken || (!on && full);
      const note = gone ? gone.text : a.ok === false ? `${a.line ? a.line + '번째 줄 · ' : ''}${a.error}` : BRIEF[a.id] || a.summary || '';
      return `<label class="opt ${on ? 'is-on' : ''} ${off ? 'is-off' : ''}"><input type="checkbox" value="${esc(a.id)}" ${on ? 'checked' : ''} ${off && !on ? 'disabled' : ''}><span class="mark mark-check" aria-hidden="true"></span>
        <span class="opt-text"><b>${esc(a.name)}</b>${a.builtin ? '' : '<em class="tag tag-blue">내 코드</em>'}${gone ? `<em class="tag tag-red">${esc(gone.short)}</em>` : a.ok === false ? '<em class="tag tag-red">오류</em>' : ''}<small title="${esc(note)}">${esc(note)}</small></span><a class="opt-link" href="#/algorithms/${encodeURIComponent(a.id)}">코드</a></label>`;
    };
    $('#side-algos', el).innerHTML = `<div class="opts">${state.algorithms.map(row).join('')}</div><a class="side-add" href="#/algorithms?new=1">+ 알고리즘 추가</a>`;
    count();
  }
  function count() { $('#side-count', el).textContent = `${state.draft.algorithms.length}개 선택`; }
  function settings() {
    const c = state.draft, d = dataset(c.dataset), rows = d?.stored?.profile?.rows, maxCycles = d && d.kind !== 'synthetic' && rows ? Math.max(1, Math.min(12, Math.floor(rows / 400))) : 12;
    const budget = BUDGET_MODES.includes(c.mode), sized = c.mode === 'quantile';
    const choice = (key, label, options, help) => `<div class="field"><span class="field-label">${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${options.map(([value, text]) => `<button type="button" role="radio" aria-checked="${c[key] === value}" data-set="${key}" data-value="${value}">${text}</button>`).join('')}</div><small>${help}</small></div>`;
    const range = (key, label, min, max, help) => `<label class="field"><span class="field-label">${label}<b data-out="${key}"></b></span><input type="range" min="${min}" max="${max}" step="5" value="${Math.round(c[key] * 100)}" data-range="${key}" style="--v:${(c[key] * 100 - min) / (max - min) * 100}%"><small>${help}</small></label>`;
    $('#side-settings', el).innerHTML = `<div class="field"><span class="field-label">사이클 수</span><div class="seg" role="radiogroup" aria-label="사이클 수">${CYCLES.map(n => `<button type="button" role="radio" aria-checked="${c.cycles === n}" data-cycles="${n}" ${n > maxCycles ? 'disabled' : ''}>${n}</button>`).join('')}</div><small>순위는 모델이 배포된 사이클 2부터 합산해요.</small></div>
      ${range('explore', 'Explore 비율 ε', 5, 40, '후보 풀에서 무작위로 선정할 비율이에요. 높이면 학습 데이터가 늘고 Exploit 규모는 줄어요.')}
      <div class="field"><span class="field-label">Exploit 선정 방식</span><div class="opts mode-opts" role="radiogroup" aria-label="Exploit 선정 방식">${Object.entries(SELECTION).map(([value, m]) => `<button type="button" role="radio" aria-checked="${c.mode === value}" class="opt ${c.mode === value ? 'is-on' : ''}" data-set="mode" data-value="${value}"><span class="mark mark-radio" aria-hidden="true"></span><span class="opt-text"><b>${m.name}</b><small>${m.who.map(w => w[0]).join(' · ')}</small>${c.mode === value ? `<small class="opt-wrap">${m.rule}</small>` : ''}</span></button>`).join('')}</div></div>
      ${budget ? range('budget', '예산 비율', 10, 70, 'Explore를 제외한 후보 전원을 처치할 때의 예상 증분 비용 대비 비율이에요. 사이클 1은 비용 추정치가 없어 같은 비율만큼 무작위로 선정해요.') : ''}
      ${c.mode === 'roi' ? range('efficiency', '최소 효율 개선', 0, 100, '무작위 선정의 예상 비용 효율 대비 개선 폭이에요. 예상 효과와 비용은 Explore train 행으로 학습한 공통 Ridge 모델로 구해요.') : ''}
      ${budget ? '' : range('target', 'Exploit 비율 q', 10, 70, sized ? 'Explore를 제외한 후보 중 모델 점수 상위 비율이에요.' : '모델이 없는 사이클 1의 무작위 선정 비율이에요.')}
      ${choice('baseLearner', '기본 모델', [['ridge', 'Ridge'], ['tree', 'Gradient Boosting']], '기본 제공 알고리즘의 회귀 모델이에요. Gradient Boosting은 비선형 효과를 학습할 수 있지만 학습이 약 25배 오래 걸려요. 내 코드에서는 context.base_learner로 받아요.')}
      <label class="field"><span class="field-label">시드</span><input type="number" class="input" min="0" max="999999" step="1" value="${c.seed}" data-seed><small>같은 시드면 결과를 재현할 수 있어요.</small></label>`;
    outputs();
  }
  function outputs() {
    const c = state.draft, p = planOf(c);
    const out = key => $(`[data-out="${key}"]`, el);
    if (out('explore')) out('explore').textContent = `${share(c.explore)} · ${int(p.exploreN)}명`;
    if (out('target')) out('target').textContent = `${share(c.target)} · ${int(p.selectedN)}명`;
    if (out('budget')) out('budget').textContent = share(c.budget);
    if (out('efficiency')) out('efficiency').textContent = `+${share(c.efficiency)}`;
    $('#side-summary', el).innerHTML = `<span>${p.cycles}사이클 · ε ${share(c.explore)} · ${selectionLabel(c)} · ${c.baseLearner === 'tree' ? 'GBM' : 'Ridge'}</span><b>설정</b>`;
  }
  function goButton() {
    const c = state.draft, d = dataset(c.dataset), k = c.algorithms.length, engine = state.engine, gone = c.algorithms.map(algorithm).find(a => a && unavailable(a));
    const blocked = running() ? '실행 중인 시뮬레이션이 끝나면 새로 시작할 수 있어요.' : engine.status === 'error' ? `엔진을 불러오지 못했어요 · ${engine.text}` : !k ? '알고리즘을 하나 이상 선택해 주세요.'
      : !datasetReady(d) ? '데이터 파일을 먼저 업로드해 주세요.' : gone ? `${gone.name} · ${unavailable(gone).text}` : '';
    const where = engine.kind === 'local' ? `로컬(${engine.info?.device || 'cpu'})` : '브라우저';
    const note = message || blocked;
    $('#side-go', el).innerHTML = `<button type="button" class="btn btn-primary btn-run" data-act="run" ${blocked ? 'disabled' : ''}>${running() ? '실행 중' : '시뮬레이션 실행'}</button>
      <p class="side-note ${note && !running() ? 'is-warn' : ''}">${esc(note || `예상 ${duration(estimate(c))} · ${where}에서 실행`)}</p>`;
  }
  function all() { data(); algos(); settings(); goButton(); }
  all();

  el.addEventListener('change', e => {
    const t = e.target; message = '';
    if (t.name === 'dataset') { setDraft({dataset: t.value}); data(); settings(); clampCycles(); goButton(); }
    else if (t.type === 'checkbox') { selectAlgorithm(t.value, t.checked); algos(); goButton(); }
    else if (t.matches('[data-seed]')) { const seed = Math.max(0, Math.min(999999, Math.round(Number(t.value) || 0))); t.value = seed; setDraft({seed}); }
  });
  el.addEventListener('input', e => {
    const t = e.target.closest('[data-range]'); if (!t) return;
    t.style.setProperty('--v', `${(t.value - t.min) / (t.max - t.min) * 100}%`);
    setDraft({[t.dataset.range]: Number(t.value) / 100}); outputs(); goButton();
  });
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-cycles], [data-act], [data-set]'); if (!t) return;
    if (t.dataset.set) { setDraft({[t.dataset.set]: t.dataset.value}); settings(); goButton(); return; }
    if (t.dataset.cycles) { setDraft({cycles: Number(t.dataset.cycles)}); settings(); goButton(); return; }
    if (t.dataset.act === 'run') {
      const order = state.algorithms.map(a => a.id), config = {...state.draft, algorithms: order.filter(id => state.draft.algorithms.includes(id))};
      startRun(config).catch(error => { message = error.message; goButton(); });
      if (state.live) go('#/runs/' + state.live.id);
    }
  });
  function clampCycles() {
    const ok = $$('[data-cycles]:not(:disabled)', el).map(b => Number(b.dataset.cycles));
    if (ok.length && !ok.includes(state.draft.cycles)) { setDraft({cycles: ok.at(-1)}); settings(); }
  }
  const off = subscribe(kind => {
    if (kind === 'algorithms' || kind === 'datasets' || kind === 'engine') all();
    else if (kind === 'run') goButton();
  });
  return {destroy: off};
}
