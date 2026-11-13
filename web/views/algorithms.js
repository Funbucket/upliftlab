// Algorithm library: read the built-in code, clone it, write your own, and run a quick check before a full simulation.
import {$, esc, isNum, int, fix, pp, share, duration, download, go, BRIEF} from '../lib.js?v=0.26.2';
import {state, subscribe, algorithm, addAlgorithm, updateAlgorithm, removeAlgorithm, quickCheck, templates, unavailable, selectAlgorithm} from '../store.js?v=0.26.2';
import {createEditor} from '../vendor/editor.js?v=0.26.2';
import {ENGINE_FILES} from '../engine-files.js?v=0.26.2';

const checks = new Map();  // algorithm id → last quick-check result, kept while the page is open
const PEP723 = `# /// script
# dependencies = ["scikit-uplift"]
# ///`;

// One library of a file and what this runtime can do with it.
function lib(l) {
  const local = state.engine.kind === 'local';
  const note = {ok: l.version || '설치됨', auto: `${l.version ? l.version + ' · ' : ''}실행 시 로딩`, declared: 'PyPI에서 설치',
    local: '로컬 실행 필요', missing: local ? `pip install ${l.package}` : '브라우저 미지원', failed: '설치 실패'}[l.status];
  return `<span class="lib ${l.status ? 'is-' + l.status : ''}" ${l.note ? `title="${esc(l.note)}"` : ''}><b>${esc(l.package)}</b>${note ? `<small>${esc(note)}</small>` : ''}</span>`;
}
function libs(list) {
  if (!list) return '';
  return `<div class="libs"><span class="libs-label">라이브러리</span>${list.length ? list.map(lib).join('') : '<span class="muted">Python 표준 라이브러리만 사용</span>'}</div>`;
}

// A built-in has two files: the EconML one (algorithms/<id>.py, run locally) and the scikit-learn lite one (algorithms/lite/<id>.py,
// run in the browser, which has no EconML). Both ship in the engine bundle, so the page can show either without the engine.
function variantsOf(a) {
  const econml = `upliftlab/algorithms/${a.id}.py`, lite = `upliftlab/algorithms/lite/${a.id}.py`;
  return a.builtin && ENGINE_FILES[econml] && ENGINE_FILES[lite] ? {econml: {file: econml, code: ENGINE_FILES[econml]}, lite: {file: lite, code: ENGINE_FILES[lite]}} : null;
}
const PACKAGE = {sklearn: 'scikit-learn'};
// The libraries a file imports, read from its text, for the variant this runtime does not run (no install status to report).
function importsOf(code, runtimeLocal) {
  const mods = [...new Set([...code.matchAll(/^(?:from|import)\s+(\w+)/gm)].map(m => m[1]))];
  return mods.map(m => ({package: PACKAGE[m] || m, status: m === 'econml' && !runtimeLocal ? 'local' : null}));
}

export function algorithmsView(root, {id, query}) {
  const a = algorithm(id) || state.algorithms[0];
  const vars = variantsOf(a);
  let editor = null, view = vars ? 'econml' : null;  // the EconML file first: it is what the algorithm is; the lite file is what a browser runs
  const runs = () => (a.implementation === 'econml' ? 'econml' : 'lite');
  root.innerHTML = `<section class="page algos"><a class="back" href="#/">← 시뮬레이션</a><header class="page-head row"><div><h1>알고리즘</h1><p>알고리즘은 <code>class Model</code>을 담은 Python 파일이에요. scikit-learn, LightGBM, PyTorch 같은 라이브러리를 그대로 import하고, 시뮬레이션은 이 코드를 그대로 실행해요.</p></div>
    <div class="menu"><button type="button" class="btn btn-primary" data-act="new" aria-haspopup="true" aria-expanded="false">알고리즘 추가</button><div class="menu-pop new-pop" id="new-pop" hidden></div></div></header>
    <div class="algo-layout"><nav class="card algo-nav" id="algo-nav" aria-label="알고리즘 목록"></nav>
    <div class="algo-main"><section class="card algo-head" id="algo-head"></section>
      <p class="contract-line"><code>class Model</code>에 <code>fit(train, validation)</code>과 <code>predict(X)</code>를 구현해요. <code>predict</code>의 점수가 높은 순서로 Exploit 그룹을 선정해요.</p>
      <section class="card editor-card"><div class="editor-bar">${vars ? '<div class="seg seg-impl" role="radiogroup" aria-label="구현"><button type="button" role="radio" data-view="econml">EconML</button><button type="button" role="radio" data-view="lite">웹 경량판</button></div>' : ''}<code id="code-path">${esc(a.builtin ? a.file : `내 알고리즘 · ${a.id}.py`)}</code><span class="tag ${a.builtin ? '' : 'tag-blue'}">${a.builtin ? '읽기 전용' : '편집 가능 · 브라우저에 저장'}</span><span class="spacer"></span><span class="muted small">⌘/Ctrl + Enter 빠른 검사</span></div><div class="code" id="code"></div><div class="editor-status" id="editor-status" role="status"></div></section>
      <section class="card" id="algo-check"></section>
      <details class="card fold" id="contract"></details>
    </div></div></section>`;

  function nav() {
    const item = x => `<a href="#/algorithms/${encodeURIComponent(x.id)}" class="${x.id === a.id ? 'is-on' : ''}" ${x.id === a.id ? 'aria-current="page"' : ''}><b>${esc(x.name)}</b>${x.ok === false ? '<em class="tag tag-red">오류</em>' : ''}<small>${esc(BRIEF[x.id] || x.summary || (x.builtin ? '' : '내 알고리즘'))}</small></a>`;
    const mine = state.algorithms.filter(x => !x.builtin);
    $('#algo-nav', root).innerHTML = `<h3 class="group">기본 제공<span>${state.algorithms.filter(x => x.builtin).length}</span></h3>${state.algorithms.filter(x => x.builtin).map(item).join('')}
      <h3 class="group">내 알고리즘<span>${mine.length}</span></h3>${mine.length ? mine.map(item).join('') : '<p class="muted small pad">복제하거나 추가한 알고리즘이 여기에 표시돼요.</p>'}`;
  }
  // Built-ins run on EconML locally and as scikit-learn lite files in the browser, which has no EconML.
  function impl() {
    if (!vars) return '';
    return `<p class="algo-impl">EconML(PyWhy)로 구현했어요. 브라우저에는 EconML이 없어서, 웹에서는 같은 방법을 scikit-learn으로 쓴 경량판이 돌아가요. 지금 이 환경에서는 <b>${runs() === 'econml' ? 'EconML' : '웹 경량판'}</b> 코드로 시뮬레이션해요.</p>`;
  }
  function showView() {
    if (!vars) return;
    for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-checked', String(b.dataset.view === view));
    $('#code-path', root).textContent = vars[view].file;
    editor?.setValue(vars[view].code);
  }
  function head() {
    $('#algo-head', root).innerHTML = `<div class="algo-title"><h2>${esc(a.name)}</h2>${a.builtin ? '<span class="tag">기본 제공</span>' : '<span class="tag tag-blue">내 코드</span>'}${a.base ? `<span class="muted small">원본 · ${esc(algorithm(a.base)?.name || a.base)}</span>` : ''}</div>
      <p class="algo-summary">${esc(a.summary || (a.builtin ? '' : 'docstring의 첫 문단이 여기에 표시돼요.'))}</p>${impl()}${libs(vars && view !== runs() ? importsOf(vars[view].code, state.engine.kind === 'local') : a.libraries)}
      <div class="algo-actions">${a.builtin ? '<button type="button" class="btn btn-primary" data-act="clone">복제해서 수정</button>' : ''}<a class="btn ${a.builtin ? 'btn-quiet' : 'btn-primary'}" href="#/?algo=${encodeURIComponent(a.id)}">시뮬레이션에 추가</a><button type="button" class="btn btn-quiet" data-act="check">빠른 검사</button>
      ${a.builtin ? '' : '<button type="button" class="btn btn-quiet" data-act="clone">복제</button>'}<button type="button" class="btn btn-quiet" data-act="download">.py 내려받기</button>${a.builtin ? '' : '<button type="button" class="btn btn-text danger" data-act="delete">삭제</button>'}</div>`;
  }
  function status() {
    const el = $('#editor-status', root);
    if (a.builtin) {
      el.className = 'editor-status';
      const where = state.engine.kind === 'local' ? '이 컴퓨터' : '웹';
      el.textContent = !vars ? '기본 제공 코드는 읽기 전용이에요. 복제하면 수정할 수 있어요.'
        : view === runs() ? `${where}에서 시뮬레이션하면 이 코드가 돌아가요. 복제하면 수정할 수 있어요.`
          : view === 'econml' ? '로컬(upliftlab)에서 돌아가는 코드예요. 웹에서는 ‘웹 경량판’ 탭의 코드가 돌아가요.' : '브라우저에서 돌아가는 경량판이에요. 이 컴퓨터에서는 ‘EconML’ 탭의 코드가 돌아가요.';
      return;
    }
    el.className = 'editor-status ' + (a.ok === false ? 'is-error' : a.ok ? 'is-ok' : '');
    el.innerHTML = a.ok === false ? `${a.line ? `<button type="button" class="btn btn-text" data-line="${a.line}">${a.line}번째 줄</button> · ` : ''}${esc(a.error)}` : a.ok ? '저장됨 · class Model 확인 · 이름은 코드의 NAME 값'
      : state.engine.loading ? `저장됨 · 라이브러리 로딩 중 · ${esc(state.engine.loading)}` : '저장됨 · 확인 중…';
  }
  function result() {
    const box = $('#algo-check', root), r = checks.get(a.id), busy = state.activity?.id === a.id;
    if (busy) {
      const last = state.activity.trace.at(-1);
      box.innerHTML = `<div class="card-head"><div><h2>빠른 검사 중</h2><p>${state.engine.loading ? `라이브러리 로딩 중 · ${esc(state.engine.loading)}` : '기본 시장의 Explore 데이터로 학습 중이에요.'}</p></div></div>${last?.total ? `<div class="meter"><i style="transform:scaleX(${(last.step / last.total).toFixed(3)})"></i></div><p class="muted small">${int(last.step)} / ${int(last.total)}${isNum(last.loss) ? ` · loss ${fix(last.loss, 4)}` : ''}</p>` : '<div class="meter is-busy"><i></i></div>'}`;
      return;
    }
    if (!r) { box.innerHTML = `<div class="card-head"><div><h2>빠른 검사</h2><p>전체 시뮬레이션 전에 합성 데이터의 Explore 행(약 12,000행)으로 한 번 학습하고 평가해요. 오류가 있으면 줄 번호를 표시해요.${vars ? ` 이 환경에서 돌아가는 ${runs() === 'econml' ? 'EconML' : '웹 경량판'} 코드로 검사해요.` : ''}</p></div></div>`; return; }
    if (!r.ok) { box.innerHTML = `<div class="card-head"><div><h2>빠른 검사 · 실패</h2></div></div><p class="error-text">${r.line ? `<button type="button" class="btn btn-text" data-line="${r.line}">${r.line}번째 줄</button> · ` : ''}${esc(r.error)}</p>`; return; }
    const losses = r.trace.filter(m => isNum(m.loss));
    box.innerHTML = `<div class="card-head"><div><h2>빠른 검사 · 통과</h2><p>train ${int(r.split.train)}행 · validation ${int(r.split.validation)}행 · test ${int(r.split.test)}행. 시뮬레이션의 재학습과 같은 방식이에요.</p></div></div>
      <dl class="kpis"><div><dt>테스트 AUCC · 참값</dt><dd>${fix(r.auccTruth, 3)}</dd><small>무작위 ≈ 0.5</small></div><div><dt>테스트 AUCC · 관측</dt><dd>${fix(r.aucc, 3)}</dd><small>표본 오차 포함</small></div><div><dt>검증 AUCC</dt><dd>${fix(r.val, 3)}</dd><small>fit() 직후</small></div><div><dt>Qini · 참값</dt><dd>${fix(r.qiniTruth, 3)}</dd><small>무작위 ≈ 0 · 비용 미반영</small></div><div><dt>Uplift@${share(r.upliftK)} · 참값</dt><dd>${pp(r.upliftAtTruth, 1)}</dd><small>점수 상위 ${share(r.upliftK)}의 ATEʳ</small></div><div><dt>학습 시간</dt><dd>${duration(r.ms)}</dd><small>예측 ${duration(r.predictMs)}</small></div></dl>
      ${losses.length > 2 ? `<figure class="spark"><figcaption>context.report로 보낸 loss · ${losses.length}회</figcaption>${sparkline(losses.map(m => m.loss))}</figure>` : ''}`;
  }
  function contract() {
    const local = state.engine.kind === 'local', info = state.engine.info;
    const where = local ? `로컬 · Python ${esc(info?.python || '')} · ${esc(info?.device || 'cpu')}`
      : state.engine.status === 'ready' ? `브라우저 · Pyodide (Python ${esc(info?.python || '')})` : '실행 환경 준비 중';
    const el = $('#contract', root), open = el.open;
    el.innerHTML = `<summary>알고리즘 계약 · 라이브러리</summary><div class="contract"><pre class="mono">class Model:
    def fit(self, train, validation, context): ...   # context는 빼도 돼요
    def predict(self, X): return scores               # (행 수,) 배열. 처치가 K종류면 (행 수, K) 배열
    # 또는 {"score": scores, "eligible": bool 배열, "arm": 처치 번호 배열}</pre>
      <dl class="defs"><div><dt>파일 하나로 완결</dt><dd>upliftlab을 import하지 않아요. 필요한 함수는 파일 안에 두고, 라이브러리는 그대로 import해요. 내려받은 .py는 노트북에서도 실행돼요.</dd></div>
      <div><dt>train · validation</dt><dd>X (n×d NumPy 배열), t (0 = 대조군, 1~K = 처치), y (결과), cost (비용), propensity, treatments (처치 수 K), propensities (처치별 P(T=k | T∈{0,k})), features (열 이름). 최근 3사이클 Explore 행의 60% · 20%예요. 나머지 20%는 test로 오프라인 평가에만 써요.</dd></div>
      <div><dt>score_is_effect</dt><dd>Knapsack과 효율 제약 선정은 점수를 기대 효과로 읽어요. 순위나 비용을 뺀 값을 점수로 낸다면 Model에 score_is_effect = False를 두세요.</dd></div>
      <div><dt>context</dt><dd>seed, model_seed, device ('cpu' 또는 'cuda:0'), target_fraction (q 또는 예산 비율), cycle, base_learner ('ridge' 또는 'tree'), treatments, report(**metrics). report로 보낸 값(step, total, loss 등)이 화면에 실시간으로 표시돼요.</dd></div>
      <div><dt>score</dt><dd>입력 행 수와 같은 길이의 유한한 1차원 배열(NumPy 배열, 리스트, PyTorch 텐서)이에요. 점수 상위 q%, 또는 예산 제약이면 예산이 소진될 때까지 Exploit 그룹에 들어가요. 처치가 K종류면 (행 수, K) 배열을 반환하고, 행마다 점수가 가장 큰 처치를 골라요. arm으로 처치를 직접 정할 수도 있어요. eligible을 주면 False인 행은 선정에서 제외해요.</dd></div>
      <div><dt>실행 실패</dt><dd>fit()이 실패한 사이클은 이전 모델을 계속 써요. 첫 학습부터 실패하면 무작위 선정을 유지해요.</dd></div>
      <div><dt>라이브러리 누락</dt><dd>파일을 불러오는 단계에서 중단하고, 없는 패키지와 설치 방법을 표시해요. 시뮬레이션은 시작하지 않아요.</dd></div></dl>
      <div class="env"><h3>현재 실행 환경 · ${where}</h3>
      ${local ? '<p>실행 중인 Python 환경에 설치된 패키지를 그대로 써요. 없는 패키지는 <code>pip install</code>로 설치한 뒤 다시 검사해요. GPU는 <code>context.device</code>로 받아요.</p>'
        : `<p>Pyodide 패키지는 import하면 실행 시 자동으로 로딩해요. 그 밖의 순수 Python 패키지는 파일 맨 위에 선언하면 실행 전에 설치해요(PEP 723). PyTorch처럼 브라우저용 빌드가 없는 라이브러리는 로컬에서 실행해요.</p><pre class="mono">${PEP723}</pre>`}
      ${info?.libraries ? `<div class="libs">${info.libraries.map(lib).join('')}</div>` : ''}</div></div>`;
    el.open = open;
  }
  function starters() {
    $('#new-pop', root).innerHTML = `<div class="menu-title">시작 템플릿</div><ul>${templates().map(t => { const gone = unavailable(t); return `<li><a href="#" data-template="${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(t.summary)}</span><span class="menu-libs">${t.libraries.map(l => esc(l.package)).join(' · ')}${gone ? ` · ${gone.short}` : ''}</span></a></li>`; }).join('')}</ul>
      <div class="menu-note">기본 알고리즘을 수정하려면 목록에서 선택한 뒤 ‘복제해서 수정’을 눌러요.</div>`;
  }
  const closeMenu = () => { const pop = $('#new-pop', root); if (!pop.hidden) { pop.hidden = true; $('[data-act="new"]', root).setAttribute('aria-expanded', 'false'); } };
  nav(); head(); status(); result(); contract();
  editor = createEditor($('#code', root), vars ? vars[view].code : a.code, code => { if (a.builtin) return; if (!updateAlgorithm(a, code)) $('#editor-status', root).textContent = '저장 공간이 부족해요 · .py로 내려받아 두세요'; else status(); }, () => runCheck(), !!a.builtin);
  showView();

  async function runCheck() {
    if (state.activity) return;
    const out = await quickCheck(a).catch(error => ({ok: false, error: error.message, trace: []}));
    checks.set(a.id, out); result();
  }
  const clone = () => {
    const name = a.builtin ? `${a.name} 수정본` : `${a.name} 복제`;
    const made = addAlgorithm({name, code: (editor?.getValue() || a.code).replace(/^NAME = .*$/m, `NAME = '${name.replace(/'/g, '')}'`), base: a.builtin ? a.id : a.base});
    selectAlgorithm(made.id);  // it joins the next simulation, next to the original
    go('#/algorithms/' + made.id);
  };
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act], [data-line], [data-template], [data-view]');
    if (!t?.closest('.menu')) closeMenu();
    if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; showView(); head(); status(); return; }
    if (t.dataset.line) { editor.goTo(Number(t.dataset.line)); return; }
    if (t.dataset.template) { e.preventDefault(); const s = templates().find(x => x.id === t.dataset.template), made = addAlgorithm({name: s.name, code: s.code}); selectAlgorithm(made.id); go('#/algorithms/' + made.id); return; }
    const act = t.dataset.act;
    if (act === 'new') { const pop = $('#new-pop', root), open = pop.hidden; if (open) starters(); pop.hidden = !open; t.setAttribute('aria-expanded', String(open)); }
    else if (act === 'clone') clone();
    else if (act === 'check') runCheck();
    else if (act === 'download') download((a.builtin ? a.id + (view === 'lite' ? '_lite' : '') : a.name.replace(/[^\w가-힣-]+/g, '_')) + '.py', editor.getValue(), 'text/x-python');
    else if (act === 'delete' && confirm(`‘${a.name}’ 알고리즘을 삭제할까요? 이 브라우저에서만 삭제돼요.`)) { removeAlgorithm(a.id); go('#/algorithms'); }
  });
  const off = subscribe(kind => {
    if (kind === 'activity') { result(); return; }
    if (kind === 'loading') { status(); result(); return; }
    if (kind === 'algorithms' || kind === 'engine') { nav(); head(); status(); }
    if (kind === 'engine') contract();
  });
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('keydown', onKey);
  if (query?.get('new')) { starters(); $('#new-pop', root).hidden = false; $('[data-act="new"]', root).setAttribute('aria-expanded', 'true'); }
  return {destroy: () => { off(); editor?.destroy(); document.removeEventListener('keydown', onKey); }};
}

function sparkline(values, w = 560, h = 72) {
  const lo = Math.min(...values), hi = Math.max(...values), X = i => i / (values.length - 1) * w, Y = v => 4 + (1 - (v - lo) / (hi - lo || 1)) * (h - 8);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark-svg" role="img" aria-label="loss 추이"><path d="${values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="#4d8dff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="spark-axis"><span>${fix(values[0], 4)}</span><span>${fix(values.at(-1), 4)}</span></div>`;
}
