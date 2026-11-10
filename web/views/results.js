// The right panel: the leaderboard, the Exploit group's covariates, per-cycle metrics and the row-level log.
import {$, $$, esc, isNum, int, fix, pct, pp, share, duration, when, colorsFor, download, go, josa, unitFor, BRIEF, SELECTION, BUDGET_MODES, selectionLabel} from '../lib.js?v=0.24.0';
import {state, subscribe, running, pauseRun, resumeRun, stopRun, deleteRun, importRun, exportRun, dataset, algorithm, EXAMPLE_RUN, wordsFor, planOf, sameConfig, useConfig} from '../store.js?v=0.24.0';
import {lineChart, interpolate, responsive, interval} from '../charts.js?v=0.24.0';
import {FIELDS, baseOf, hasTruth, modeOf, isBudget, byVolume, sumOf, datasetOf, armsOf, exploitProfile, describeProfile, verdictOf, verdictHtml} from '../summary.js?v=0.24.0';
import {downloadReport, printReport, copySummary} from '../report.js?v=0.24.0';

const USE = {train: '학습', validation: '검증', test: '오프라인 평가'};
const upliftK = run => (isBudget(run) ? run.plan?.budget ?? run.config?.budget : run.plan?.target ?? run.config?.target);
// One segment of a cycle's composition bar. Its tooltip names the group, the arm and the size.
function segment(cls, label, n, total) {
  const percent = (n / total * 100).toFixed(1), text = `${label} · ${int(n)}명 (${percent}%)`;
  return `<span class="${cls}" style="width:${(n / total * 100).toFixed(2)}%" data-tip="${esc(text)}" role="img" aria-label="${esc(text)}" tabindex="0"></span>`;
}

export function resultsPanel(el, heroEl, run) {
  const W = wordsFor(datasetOf(run));
  const binary = () => W.binary || !!run.cycles[0]?.trace?.y.every(y => y === 0 || y === 1);
  const rate = v => (!isNum(v) ? '—' : binary() ? `${(v * 100).toFixed(1)}%` : fix(v, 3));
  const lift = v => (!isNum(v) ? '—' : binary() ? pp(v, 1) : (v < 0 ? '−' : '+') + fix(Math.abs(v), 3));
  let basis = hasTruth(run) ? 'truth' : 'observed', basisChosen = false, stats = false, curveKind = 'cost', selected = null, cycleAt = null, filter = 'exploit', openRow = null, focus = null;
  const cleanups = [];
  const leaderId = () => run.summary?.leader || armsOf(run)[0]?.id;
  const selectedId = () => (armsOf(run).some(a => a.id === selected) ? selected : leaderId());
  const cycleNow = () => run.cycles.find(c => c.cycle === cycleAt) || run.cycles.at(-1);

  // First visit: one claim, the way to try it on your own data, and the precomputed answer right under it.
  heroEl.innerHTML = run.example ? `<h1>같은 예산이라도, 대상을 고르는 모델에 따라 증분 성과가 달라져요</h1>
    <p>실험 데이터를 넣으면 uplift 모델마다 운영 환경처럼 대상을 고르고 효과를 재는 과정을 시뮬레이션해서, 같은 예산에서 증분 성과가 가장 큰 모델을 찾아 줘요. 아래는 ${esc(W.data)} 데이터로 미리 돌려 본 결과예요.</p>
    <div class="hero-actions"><a class="btn btn-primary" href="#/data?upload=1">내 데이터로 비교하기</a><a class="btn btn-quiet" href="#/data?upload=1&amp;sample=1">예시 실험 파일로 해 보기</a><span class="hero-note" id="hero-note"></span></div>` : '';
  heroEl.hidden = !run.example;
  const heroNote = () => { const n = $('#hero-note', heroEl); if (n) n.textContent = state.engine.kind === 'local' ? '내 컴퓨터의 Python에서 실행해요. 데이터는 이 컴퓨터 밖으로 나가지 않아요.' : '설치는 필요 없어요. 데이터는 이 컴퓨터 밖으로 나가지 않아요.'; };
  heroNote();
  el.innerHTML = `<div id="run-bar" class="run-bar"></div><div id="run-live"></div><div id="run-verdict"></div><details class="how" id="how"></details>
    <section class="sec" id="sec-board"></section><div id="sec-arms"></div><section class="sec" id="sec-picked"></section><section class="sec" id="sec-cycle"></section><section class="sec" id="sec-rows"></section>
    <section class="sec"><div class="sec-head"><div><h2>사이클별 효율 개선</h2><p>사이클마다 Exploit의 비용 효율이 Explore보다 몇 % 높은지예요. 0%는 Explore benchmark와 같은 수준이에요.</p></div></div><div class="legend" id="gain-legend"></div><div id="gain-chart" class="chart-box"></div></section>
    <section class="sec"><div class="sec-head"><div><h2 id="curve-title">Cost Curve</h2><p id="curve-note"></p></div><div class="sec-tools"><div class="seg" role="radiogroup" aria-label="곡선"><button type="button" role="radio" aria-checked="true" data-curve="cost">Cost Curve</button><button type="button" role="radio" aria-checked="false" data-curve="qini">Qini Curve</button></div></div></div><div class="legend" id="curve-legend"></div><div id="curve-chart" class="chart-box"></div></section>
    <details class="fold" id="defs"></details>`;

  function bar() {
    const p = run.plan, c = run.config, status = {starting: '준비 중', running: '실행 중', paused: '일시정지', stopped: '중단된 실행', failed: '실행 실패', done: '실행 완료'}[run.status] || '실행 완료';
    const label = run.example ? '예시 결과 · 사전 계산' : run.imported ? `결과 파일 · ${run.imported}` : `${status} · ${when(run.createdAt)}`;
    const meta = [W.data, `알고리즘 ${armsOf(run).length}개`, `${p?.cycles ?? c.cycles}사이클`, p ? `사이클당 ${int(p.pool)}명` : null, `ε ${share(p?.explore ?? c.explore)}`, selectionLabel(p ?? c), p?.treatments > 1 ? `처치 ${p.treatments}종류` : null, (p?.baseLearner ?? c.baseLearner) === 'tree' ? 'Gradient Boosting' : null, `시드 ${p?.seed ?? c.seed}`,
      run.runtime ? (run.runtime === 'local' ? '로컬' : '브라우저') : null, p?.implementation ? (p.implementation === 'econml' ? 'EconML' : 'scikit-learn 경량판') : null, isNum(run.elapsed) ? duration(run.elapsed) : null].filter(Boolean);
    const differs = !running() && c && !sameConfig(state.draft, c);
    $('#run-bar', el).innerHTML = `<div class="run-bar-text"><b class="${run.example ? 'is-example' : ''}">${esc(label)}</b><span>${meta.map(esc).join(' · ')}</span>${differs ? '<span class="run-differs">현재 설정이 이 결과와 달라요. 다시 실행해야 결과에 반영돼요. <button type="button" class="btn-link" data-act="use">이 결과의 설정 불러오기</button></span>' : ''}</div>
      <div class="run-bar-actions">${run.summary && sumOf(run, run.summary.leader)?.cycles ? `<div class="menu"><button type="button" class="btn btn-quiet btn-sm" data-act="share" aria-haspopup="true" aria-expanded="false">보고서 공유</button><div class="menu-pop share-pop" id="share-pop" hidden>
        <button type="button" class="menu-item" data-act="report-html"><b>HTML 보고서 내려받기</b><span>파일 하나로 슬랙·메일에 첨부해요. 받은 사람은 브라우저로 열어요.</span></button>
        <button type="button" class="menu-item" data-act="report-pdf"><b>PDF로 저장</b><span>인쇄 창에서 대상을 ‘PDF로 저장’으로 골라요.</span></button>
        <button type="button" class="menu-item" data-act="report-copy"><b>요약 복사</b><span>결론과 핵심 숫자를 복사해 메신저에 붙여 넣어요.</span></button>
        <button type="button" class="menu-item" data-act="export"><b>결과 JSON 내려받기</b><span>upliftlab의 실행 기록에서 같은 화면으로 다시 열어요.</span></button>
        <p class="menu-note">보고서에는 집계 결과만 들어가요. 업로드한 원본 행은 들어가지 않아요.</p><p class="menu-ok" id="share-msg" role="status"></p></div></div>` : ''}
      <div class="menu"><button type="button" class="btn btn-quiet btn-sm" data-act="history" aria-haspopup="true" aria-expanded="false">실행 기록 <span class="count">${state.runs.length + 1}</span></button><div class="menu-pop" id="history-pop" hidden></div></div></div>`;
  }
  function history() {
    const item = r => { const words = wordsFor(datasetOf(r)), lead = r.summary && sumOf(r, r.summary.leader); return `<li><a href="#/runs/${encodeURIComponent(r.id)}" class="${r.id === run.id ? 'is-current' : ''}"><b>${esc(words.data)} · 알고리즘 ${(r.plan?.algorithms || r.config.algorithms).length}개</b><span>${r.example ? '예시 결과' : esc(r.imported ? '결과 파일' : when(r.createdAt))}${lead ? ` · 1위 ${esc(lead.name)}` : ''}</span></a>${r.example ? '' : `<button type="button" class="icon-btn" data-del="${esc(r.id)}" aria-label="기록 삭제">×</button>`}</li>`; };
    $('#history-pop', el).innerHTML = `<ul>${[...state.runs, EXAMPLE_RUN].map(item).join('')}</ul><label class="menu-foot">결과 JSON 열기 <small>python -m upliftlab run --out result.json</small><input type="file" accept=".json,application/json" id="import-run"></label><p class="menu-msg" id="import-msg"></p>`;
  }
  function how() {
    const box = $('#how', el), open = box.open, c = state.draft, p = planOf(c), d = dataset(c.dataset), replay = d && d.kind !== 'synthetic', budget = BUDGET_MODES.includes(c.mode), sized = c.mode === 'quantile', K = d?.treatments || d?.stored?.profile?.treatments || 1;
    const treated = replay && d.stored?.profile ? d.stored.profile.treatedShare : .5;
    box.innerHTML = `<summary><h2>시뮬레이션 구조</h2><small>사이클마다 후보 풀 ${int(p.pool)}명을 Explore, Exploit, 미선정으로 나눠요</small></summary>
      <div class="cycle-bar" role="group" aria-label="사이클 구성">${segment('b-ex', 'Explore 처치군', p.exploreN * treated, p.pool)}${segment('b-ex2', 'Explore 대조군', p.exploreN * (1 - treated), p.pool)}${segment('b-pick', 'Exploit 처치군', p.selectedN * treated, p.pool)}${segment('b-pick2', 'Exploit 대조군', p.selectedN * (1 - treated), p.pool)}${segment('b-rest', '미선정', p.rest, p.pool)}</div>
      <p class="how-key"><span><i class="b-pick"></i>처치군</span><span><i class="b-pick2"></i>대조군</span></p>
      <div class="how-cols">
        <div><b><i class="b-ex"></i>Explore ${int(p.exploreN)}명 (ε ${share(c.explore)})</b><p>후보 풀에서 무작위로 선정해요. ${replay ? '처치 배정과 결과는 로그 값을 그대로 써요.' : K > 1 ? `대조군과 처치 ${K}종류에 무작위 배정해요.` : '처치군과 대조군에 무작위 배정해요.'} 모델 <em>학습</em>과 오프라인 평가에 쓰고, 모든 알고리즘이 공유하는 <em>benchmark</em>예요.</p></div>
        <div><b><i class="b-pick"></i>Exploit ${sized || budget ? `${budget ? '약 ' : ''}${int(p.selectedN)}명 ` : ''}(${selectionLabel(c)})</b><p>${SELECTION[c.mode].how} ${K > 1 ? (c.mode === 'knapsack' ? '처치 종류도 λ로 함께 정해요. ' : '사용자마다 점수가 가장 큰 처치를 골라요. ') : ''}${replay ? (K > 1 ? '로그의 처치가 고른 처치와 같은 행과 대조군 행의 차이로' : '로그의 처치군과 대조군 차이로') : '처치군과 대조군에 무작위 배정하고, 두 군의 차이로'} <em>온라인 평가</em>를 해요.</p></div>
        <div><b><i class="b-rest"></i>미선정 ${int(p.rest)}명</b><p>모델 점수가 낮아 ${replay ? '평가에서 제외해요.' : '처치하지 않아요.'} Exploit 그룹과 공변량 분포가 달라 대조군으로 쓰지 않아요.</p></div>
      </div>
      <p class="how-next">사이클이 끝나면 최근 3사이클의 Explore 데이터로 재학습하고, 새 모델을 다음 사이클에 배포해요. ${p.cycles}사이클을 반복하고, 모델이 없는 사이클 1을 제외해 합산해요. 사용자와 Explore 그룹을 공유하므로 <em>알고리즘 간 차이는 Exploit 선정에서만 생겨요.</em></p>
      <details class="how-why"><summary>Exploit 그룹 안에서도 처치군과 대조군을 나누는 이유</summary><div><p>처치군의 결과만 보면 처치 없이도 전환할 사용자(sure things)와 처치해야 전환할 사용자(persuadables)를 구분할 수 없어요. 아래는 설명용 가상 수치예요.</p>
        <table class="table"><thead><tr><th></th><th class="num">Sure things 위주 선정</th><th class="num">Persuadables 위주 선정</th></tr></thead><tbody><tr><td>처치군 전환 (40명 중)</td><td class="num"><b>36명</b></td><td class="num">24명</td></tr><tr><td>대조군 전환 (40명 중)</td><td class="num">32명</td><td class="num">8명</td></tr><tr><td>증분 전환</td><td class="num">4명</td><td class="num"><b>16명</b></td></tr><tr><td>증분 비용 (전환 1건당 1,000)</td><td class="num">36,000</td><td class="num">24,000</td></tr><tr><td>비용 효율 (비용 10,000당)</td><td class="num">1.1명</td><td class="num"><b>6.7명</b></td></tr></tbody></table>
        <p>처치군 전환만 보면 왼쪽이 높지만, 대조군과의 차이로 보면 오른쪽의 증분 전환이 4배예요.</p></div></details>`;
    box.open = open;
  }
  function live() {
    const box = $('#run-live', el);
    if (state.live !== run || !['starting', 'running', 'paused'].includes(run.status)) {
      box.innerHTML = run.status === 'failed' ? `<div class="notice is-error"><b>실행 실패</b><span>${esc(run.error)}</span></div>` : run.status === 'stopped' ? `<div class="notice"><b>중단된 실행</b><span>사이클 ${run.cycles.length}까지의 결과예요.</span></div>` : '';
      return;
    }
    const p = run.plan, arms = armsOf(run), cur = run.current, done = run.cycles.length;
    let within = 0, text = run.status !== 'starting' ? `사이클 ${done + 1} 시작` : state.engine.status !== 'ready' ? (state.engine.text || '엔진 준비 중') : state.engine.loading ? `라이브러리 로딩 중 · ${state.engine.loading}` : '데이터와 알고리즘 준비 중';
    if (cur && p) {
      const i = Math.max(0, arms.findIndex(a => a.id === cur.arm)), name = arms[i]?.name || cur.arm, pr = run.progress[cur.arm] || {};
      if (cur.phase === 'score') { within = .1 * (i + 1) / arms.length; text = `${name} · 후보 ${int(p.pool - p.exploreN)}명 점수 계산 중`; }
      else { const f = pr.total ? pr.step / pr.total : cur.phase === 'done' ? 1 : .5; within = .1 + .9 * (i + f) / arms.length; text = `${name} · Explore 데이터로 재학습 중${pr.total ? ` · ${int(pr.step)}/${int(pr.total)}` : ''}`; }
    }
    const total = p?.cycles || run.config.cycles, frac = Math.min(1, (done + within) / total);
    const html = `<div class="live"><div class="live-top"><b>사이클 ${Math.min(done + 1, total)} / ${total}</b><span class="live-text">${esc(run.status === 'paused' ? '일시정지 중이에요. 재개하면 다음 사이클부터 실행해요.' : run.stop ? '이번 사이클까지 실행하고 중단해요' : text)}</span><span class="spacer"></span>
      ${run.status === 'paused' ? '<button type="button" class="btn btn-quiet btn-sm" data-act="resume">재개</button>' : `<button type="button" class="btn btn-quiet btn-sm" data-act="pause" ${run.status !== 'running' || run.stop ? 'disabled' : ''}>일시정지</button>`}
      <button type="button" class="btn btn-quiet btn-sm" data-act="stop" ${run.stop ? 'disabled' : ''}>중지</button></div><div class="live-bar"><i style="transform:scaleX(${frac.toFixed(4)})"></i></div></div>`;
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  function verdict() {
    const box = $('#run-verdict', el), V = verdictOf(run, W);
    if (!V) {
      box.innerHTML = run.cycles.length || running() ? '<p class="verdict-wait">사이클 1은 모델이 없어 모든 알고리즘이 같은 무작위 선정으로 시작해요. 순위는 사이클 2가 끝나면 계산돼요.</p>' : '';
      return;
    }
    box.innerHTML = verdictHtml(V) + quality();
  }
  function quality() {
    const d = dataset(datasetOf(run)), bad = (d?.stored?.profile?.checks || []).filter(c => c.level === 'bad' || c.level === 'warn');
    return bad.length ? `<div class="notice is-warn"><b>데이터 검사 경고</b><span>${bad.map(c => esc(c.text)).join(' ')} <a class="link" href="#/data/${encodeURIComponent(d.id)}">데이터셋 보기</a></span></div>` : '';
  }
  function board() {
    const F = FIELDS[basis], truth = hasTruth(run), arms = armsOf(run), sel = selectedId(), budget = byVolume(run), k = upliftK(run);
    const rows = arms.map(a => ({a, s: sumOf(run, a.id)})).sort((x, y) => (x.s?.rank ?? 99) - (y.s?.rank ?? 99));
    const Rs = rows.map(r => r.s?.[F.R]).filter(isNum), base = rows.map(r => r.s && baseOf(r.s, F)).find(isNum);
    const unit = unitFor(base ?? Math.max(0, ...Rs)), top = Math.max(base || 0, ...Rs, 1e-9) * 1.03, scale = v => Math.max(0, Math.min(100, v / top * 100));
    const cis = rows.flatMap(r => r.s?.ci || []).filter(isNum), dom = [Math.min(-.1, ...cis), Math.max(.5, ...cis)];
    const status = id => { if (state.live !== run || !running()) return ''; const p = run.progress[id]; if (!p) return '<small class="st">대기</small>'; return `<small class="st ${run.current?.arm === id ? 'on' : ''}">${p.phase === 'score' ? '점수 계산 중' : p.phase === 'train' ? `재학습 중${p.total ? ` ${int(p.step)}/${int(p.total)}` : ''}` : '사이클 완료'}</small>`; };
    const vs = r => { const v = r?.vsLeader; if (r?.rank === 1) return '<span class="chip">1위</span>'; if (!v) return '—'; const gap = x => (budget ? `${x < 0 ? '−' : '+'}${int(Math.abs(x))}` : pp(x)); return v.tied ? `<span class="chip chip-grey" title="95% CI ${gap(v.ci[0])} ~ ${gap(v.ci[1])}">유의차 없음</span>` : gap(v.diff); };
    const row = ({a, s}) => {
      const R = s?.[F.R], value = isNum(R) ? `${fix(R * unit, 1)}${W.unit}` : '—', isLead = s?.rank === 1;
      return `<tr data-arm="${esc(a.id)}" class="${sel === a.id ? 'is-sel' : ''}" tabindex="0" aria-selected="${sel === a.id}"><td class="c-rank">${s?.cycles ? s.rank : '—'}</td>
        <td class="c-name"><b>${esc(a.name)}</b>${a.user ? '<em class="tag tag-blue">내 코드</em>' : ''}${s?.failures ? `<em class="tag tag-red" title="${esc(s.lastError || '')}">실패 ${s.failures}회</em>` : ''}${s?.meets === false ? '<em class="tag tag-amber">효율 기준 미달</em>' : ''}${status(a.id)}<small>${esc(BRIEF[a.id] || algorithm(a.id)?.summary || '')}</small></td>
        <td class="c-bar"><span class="bar"><i class="${isLead ? 'is-lead' : ''}" style="width:${isNum(R) ? scale(R).toFixed(1) : 0}%"></i>${isNum(base) ? `<u style="left:${scale(base).toFixed(1)}%"></u>` : ''}</span><span class="bar-val">${value}</span></td>
        <td class="num ${!budget && isNum(s?.[F.gain]) && s[F.gain] > 0 ? 'strong' : ''}">${pct(s?.[F.gain])}</td><td class="num ${budget ? 'strong' : ''}">${int(s?.[F.incR])}</td><td class="num">${int(s?.[F.incC])}</td>${budget ? `<td class="num">${int(s?.selected)}</td>` : ''}
        ${stats ? `${truth && basis === 'truth' ? `<td class="num">${pct(s?.gain)}</td>` : ''}<td class="c-ci">${interval(s?.gain, s?.ci, dom)}<small>${s && isNum(s.ci[0]) ? `${pct(s.ci[0])} ~ ${pct(s.ci[1])}` : ''}</small></td><td class="num">${vs(s)}</td><td class="num">${fix(s?.[F.aucc], 3)}</td><td class="num">${fix(s?.[F.qini], 3)}</td><td class="num">${lift(s?.[F.upliftAt])}</td><td class="num muted">${duration(s?.trainMs)}</td>` : ''}</tr>`;
    };
    $('#sec-board', el).innerHTML = `<div class="sec-head"><div><h2>순위</h2><p>${isBudget(run) ? `사용 예산이 같으므로 ${esc(josa(W.incR, '으로', '로'))} 순위를 매겨요. ` : modeOf(run) === 'roi' ? `효율 기준을 지킨 알고리즘을 먼저 놓고, ${esc(josa(W.incR, '으로', '로'))} 순위를 매겨요. ` : budget ? `선정 인원이 달라서 ${esc(josa(W.incR, '으로', '로'))} 순위를 매겨요. 효율 개선을 함께 보세요. ` : ''}${basis === 'truth' ? '참값은 합성 데이터의 잠재 결과로 계산한 실제 효과예요.' : '관측은 처치군과 대조군의 차이로 추정한 값으로, 운영 환경에서 볼 수 있는 값이에요.'} 사이클 2부터 합산해요.${isNum(base) ? ` 세로선은 Explore benchmark예요. 무작위 선정의 비용 효율로, 비용 ${int(unit)}당 ${esc(W.incR)} ${fix(base * unit, 1)}${W.unit}이에요. 막대가 세로선보다 길면 무작위 선정보다 효율이 높아요.` : ''}</p></div>
      <div class="sec-tools">${truth ? `<div class="seg" role="radiogroup" aria-label="기준">${[['truth', '참값'], ['observed', '관측']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${basis === k}" data-basis="${k}">${t}</button>`).join('')}</div>` : ''}<button type="button" class="btn btn-quiet btn-sm" data-act="stats" aria-pressed="${stats}">${stats ? '상세 지표 접기' : '상세 지표'}</button></div></div>
      <div class="table-wrap"><table class="table board ${budget ? 'is-budget' : ''}"><thead><tr><th class="c-rank">#</th><th>알고리즘</th><th>비용 효율<small>비용 ${int(unit)}당 ${esc(W.incR)}</small></th><th class="num">효율 개선<small>Explore 대비</small></th><th class="num">${esc(W.incR)}</th><th class="num">증분 비용</th>${budget ? '<th class="num">Exploit 인원<small>사이클 평균</small></th>' : ''}
      ${stats ? `${truth && basis === 'truth' ? '<th class="num">효율 개선<small>관측</small></th>' : ''}<th class="c-ci">95% CI<small>관측</small></th><th class="num">1위와 차이<small>관측</small></th><th class="num">테스트 AUCC<small>${F.name}</small></th><th class="num">Qini<small>${F.name}</small></th><th class="num">Uplift@${share(k)}<small>${F.name}</small></th><th class="num">학습 시간<small>평균</small></th>` : ''}</tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>
      <p class="sec-foot">행을 선택하면 아래 분석이 해당 알고리즘 기준으로 바뀌어요.</p>`;
  }
  // Which treatment each algorithm chose for its Exploit group, when the dataset has several.
  function treatments() {
    const box = $('#sec-arms', el), K = run.plan?.treatments || 1, labels = run.plan?.labels || [];
    if (K < 2) { box.innerHTML = ''; return; }
    const tone = k => `color-mix(in srgb, var(--blue) ${Math.round(30 + 70 * k / (K - 1))}%, #fff)`;
    const rows = armsOf(run).map(a => ({a, s: sumOf(run, a.id)})).sort((x, y) => (x.s?.rank ?? 99) - (y.s?.rank ?? 99));
    const mix = share_ => (share_ ? `<span class="arm-bar">${share_.map((v, k) => (v >= .005 ? `<i style="width:${(v * 100).toFixed(1)}%;background:${tone(k)}" title="${esc(labels[k])} · ${(v * 100).toFixed(1)}%"></i>` : '')).join('')}</span>` : '<span class="muted">—</span>');
    box.innerHTML = `<section class="sec"><div class="sec-head"><div><h2>처치 분포</h2><p>각 알고리즘이 Exploit 그룹에 어떤 처치를 골랐는지예요. 사이클 2부터 합산해요.</p></div></div>
      <p class="how-key arm-key">${labels.map((l, k) => `<span><i style="background:${tone(k)}"></i>${esc(l)}</span>`).join('')}</p>
      <div class="table-wrap"><table class="table arm-table"><thead><tr><th>알고리즘</th><th>처치 분포</th>${labels.map(l => `<th class="num">${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(({a, s}) => `<tr><td><b>${esc(a.name)}</b></td><td>${mix(s?.armShare)}</td>${labels.map((_, k) => `<td class="num">${isNum(s?.armShare?.[k]) ? share(s.armShare[k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function picked() {
    const id = selectedId(), arm = armsOf(run).find(a => a.id === id), items = arm && exploitProfile(run, id), box = $('#sec-picked', el);
    if (!arm) { box.innerHTML = ''; return; }
    const known = algorithm(id);
    const head = `<div class="sec-head"><div><h2>Exploit 그룹 특성 · ${esc(arm.name)}</h2><p>${esc(BRIEF[id] || known?.summary || '')}</p></div><div class="sec-tools">${known ? `<a class="btn btn-quiet btn-sm" href="#/algorithms/${encodeURIComponent(id)}">코드 보기</a>` : ''}</div></div>`;
    if (!items) { box.innerHTML = `${head}<p class="muted">사이클 2부터 계산돼요.</p>`; return; }
    const shown = items.slice(0, 8), reach = Math.max(.5, ...shown.map(x => Math.abs(x.d)));
    box.innerHTML = `${head}<p class="picked-line">${esc(describeProfile(items))}</p>
      <div class="pf"><div class="pf-row pf-head"><span>공변량</span><span class="num">후보 풀 평균</span><span class="num">Exploit 평균</span><span class="pf-axis"><em>−</em><em>표준화 평균 차이</em><em>+</em></span><span class="num">SMD</span></div>
      ${shown.map(x => { const size = Math.abs(x.d) / reach * 50; return `<div class="pf-row"><span class="pf-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="num muted">${fix(x.base, 2)}</span><span class="num"><b>${fix(x.mean, 2)}</b></span><span class="pf-bar"><u></u><i style="${x.d >= 0 ? 'left:50%' : `left:${(50 - size).toFixed(1)}%`};width:${size.toFixed(1)}%"></i></span><span class="num">${x.d < 0 ? '−' : '+'}${fix(Math.abs(x.d), 2)}</span></div>`; }).join('')}</div>
      <p class="sec-foot">사이클 2부터 합산했어요.${items.length > shown.length ? ` |SMD|가 큰 공변량 ${shown.length}개만 표시해요 (전체 ${items.length}개).` : ''}</p>`;
  }
  function cycle() {
    const box = $('#sec-cycle', el), c = cycleNow();
    const total = run.plan?.cycles || run.config.cycles, seg = `<div class="seg seg-cycles" role="radiogroup" aria-label="사이클">${Array.from({length: total}, (_, i) => i + 1).map(n => `<button type="button" role="radio" aria-checked="${c?.cycle === n}" data-cycle="${n}" ${run.cycles.some(x => x.cycle === n) ? '' : 'disabled'}>${n}</button>`).join('')}</div>`;
    const head = `<div class="sec-head"><div><h2>사이클 ${c?.cycle ?? 1} 지표</h2><p>이 사이클 하나의 관측 값이에요. 위 순위는 사이클 2부터 합산한 값이라 숫자가 달라요.</p></div><div class="sec-tools">${seg}</div></div>`;
    if (!c) { box.innerHTML = `${head}<p class="muted">사이클 1이 끝나면 표시돼요.</p>`; return; }
    const id = selectedId(), arms = armsOf(run), rowOf = a => c.arms.find(r => r.arm === a), me = rowOf(id), ex = c.explore, x = me?.exploit, unit = unitFor(ex.R);
    const version = me?.version ?? 0, w = c.window, last = w?.cycles?.length ? (w.cycles.length > 1 ? `사이클 ${w.cycles[0]}–${w.cycles.at(-1)}` : `사이클 ${w.cycles[0]}`) : '';
    const told = version === 0 ? '학습된 모델이 없어 모든 알고리즘이 같은 무작위 Exploit 그룹을 선정해요. 순위 합산에서 제외해요.' : `각 알고리즘의 모델 v${version}이 Exploit 그룹을 선정했어요.`;
    const armName = esc(josa(arms.find(a => a.id === id)?.name || id, '은', '는'));
    const spent = isBudget(run) && isNum(c.budget) && me ? ` 이번 사이클 예산은 예상 증분 비용 기준 ${int(c.budget)}이고, ${armName} ${int(me.planned)}을 배정해 ${int(me.selected)}명을 선정했어요.`
      : modeOf(run) === 'roi' && isNum(c.efficiencyTarget) && me ? ` 이번 사이클 효율 기준은 예상 비용 ${int(unit)}당 ${esc(W.incR)} ${fix(c.efficiencyTarget * unit, 1)}${W.unit}이고, ${armName} ${int(me.selected)}명을 선정했어요.`
        : modeOf(run) === 'validation' && isNum(me?.cutoff) ? ` ${armName} validation 행에서 고른 비율 ${share(me.cutoff)}로 ${int(me.selected)}명을 선정했어요.` : '';
    const after = w ? ` 사이클이 끝난 뒤 ${last} Explore ${int(w.rows)}행(train ${int(w.split.train)} · validation ${int(w.split.validation)} · test ${int(w.split.test)})으로 재학습했어요.` : '';
    const n = c.n, chosen = me?.selected ?? x?.n ?? 0, rest = n - ex.n - chosen, skipped = Math.max(0, chosen - (x?.n ?? 0));  // skipped: logged under a treatment other than the one chosen
    const row = (label, cell, rowClass, gain, key = '') => `<tr class="${rowClass}" ${key ? `data-arm="${esc(key)}"` : ''}><td class="c-name"><b>${label}</b></td><td class="num">${int(cell.n)}</td><td class="num">${rate(cell.retainT)}</td><td class="num">${rate(cell.retainC)}</td><td class="num strong">${lift(cell.ateR)}</td><td class="num">${fix(cell.ateC, 2)}</td><td class="num strong">${isNum(cell.R) ? fix(cell.R * unit, 1) : '—'}</td><td class="num">${gain}</td></tr>`;
    box.innerHTML = `${head}<p class="sec-lead">${told}${spent}${after}</p>
      ${x ? `<div class="cycle-bar" role="group" aria-label="${esc(me.arm)}의 사이클 ${c.cycle} 구성">${segment('b-ex', 'Explore 처치군', ex.nT, n)}${segment('b-ex2', 'Explore 대조군', ex.nC, n)}${segment('b-pick', 'Exploit 처치군', x.nT, n)}${segment('b-pick2', 'Exploit 대조군', x.nC, n)}${segment('b-rest', skipped ? '미선정 · 측정 제외' : '미선정', rest + skipped, n)}</div>
      <div class="cycle-key"><span><i class="b-ex"></i>Explore 처치군 ${int(ex.nT)}</span><span><i class="b-ex2"></i>Explore 대조군 ${int(ex.nC)}</span><span><i class="b-pick"></i>Exploit 처치군 ${int(x.nT)}</span><span><i class="b-pick2"></i>Exploit 대조군 ${int(x.nC)}</span><span><i class="b-rest"></i>미선정 ${int(rest)}${skipped ? ` · 측정 제외 ${int(skipped)}` : ''}</span></div>` : ''}
      <div class="table-wrap"><table class="table cycle-table"><thead><tr><th>그룹</th><th class="num">n</th><th class="num">${esc(W.outcome)}<small>처치군</small></th><th class="num">${esc(W.outcome)}<small>대조군</small></th><th class="num">증분 성과<small>ATEʳ</small></th><th class="num">증분 비용<small>ATEᶜ</small></th><th class="num">비용 효율<small>비용 ${int(unit)}당 ${esc(W.incR)}</small></th><th class="num">효율 개선<small>Explore 대비</small></th></tr></thead>
      <tbody>${row('Explore (benchmark)', ex, 'is-base', '—')}${arms.map(a => ({a, r: rowOf(a.id)})).filter(v => v.r).sort((p, q) => (q.r.exploit.R ?? -1e9) - (p.r.exploit.R ?? -1e9)).map(({a, r}) => row(`Exploit · ${esc(a.name)}`, r.exploit, a.id === id ? 'is-sel' : '', pct(r.gain), a.id)).join('')}</tbody></table></div>
      <p class="sec-foot">처치군 ${esc(W.outcome)}만으로는 증분 효과를 알 수 없어요. 처치군과 대조군의 차이(ATE)를 봐야 해요.</p>`;
  }
  function rowsTable() {
    const box = $('#sec-rows', el), c = cycleNow(), id = selectedId(), arm = armsOf(run).find(a => a.id === id), me = c?.arms.find(r => r.arm === id), trace = c?.trace;
    const head = `<div class="sec-head"><div><h2>Row-level 로그</h2><p>${arm ? `사이클 ${c?.cycle ?? 1} · ${esc(arm.name)} 기준이에요.` : ''} 사이클마다 무작위 100행과 알고리즘별 점수 상위 8행을 저장해요.</p></div>${trace ? `<div class="sec-tools"><button type="button" class="btn btn-quiet btn-sm" data-act="csv">CSV 내려받기</button></div>` : ''}</div>`;
    if (!trace || !trace.arms?.[id]) { box.innerHTML = `${head}<p class="muted">${c ? '이 결과에는 row-level 로그가 없어요. 다시 실행하면 생성돼요.' : '사이클 1이 끝나면 표시돼요.'}</p>`; return; }
    const features = (run.plan?.features || []).slice(0, trace.X[0]?.length ?? 0), mine = trace.arms[id], ranks = mine.rank, scores = mine.score, N = me.selected, src = mine.t ? mine : trace, multi = !!mine.arm, labels = run.plan?.labels || [], truth = !!src.tauR;
    const off = i => multi && !trace.explore[i] && src.t[i] !== 0 && src.t[i] !== mine.arm[i];  // logged under a treatment other than the one chosen
    const kind = i => (trace.explore[i] ? 'explore' : ranks[i] && ranks[i] <= N ? 'exploit' : 'rest');
    const all = trace.ids.map((_, i) => i).sort((a, b) => (ranks[a] ?? 1e12) - (ranks[b] ?? 1e12));
    const counts = {all: all.length, exploit: all.filter(i => kind(i) === 'exploit').length, rest: all.filter(i => kind(i) === 'rest').length, explore: all.filter(i => kind(i) === 'explore').length};
    const shown = filter === 'all' ? all : all.filter(i => kind(i) === filter);
    const span = 8 + features.length + (truth ? 2 : 0) + (multi ? 1 : 0);
    const chosenOf = (i, k) => (k === 'rest' || (k === 'explore' && !src.t[i]) ? '—' : esc(labels[mine.arm[i] - 1] ?? mine.arm[i]));
    const line = i => {
      const k = kind(i), measured = k !== 'rest', open = openRow === trace.ids[i];
      const label = {exploit: '<span class="chip">exploit</span>', rest: '<span class="chip chip-line">미선정</span>', explore: '<span class="chip chip-grey">explore</span>'}[k];
      const use = k === 'explore' ? USE[trace.split[i]] : k === 'exploit' ? (off(i) ? '측정 제외' : '온라인 평가') : '미사용';
      const main = `<tr data-row="${esc(trace.ids[i])}" class="${open ? 'is-open' : ''}" tabindex="0"><td class="c-id">${esc(trace.ids[i])}</td><td>${label}</td>${features.map((_, j) => `<td class="num muted">${fix(trace.X[i][j], 2)}</td>`).join('')}<td class="num">${isNum(scores[i]) ? scores[i] : '—'}</td><td class="num"><b>${ranks[i] ? int(ranks[i]) : '—'}</b></td>${multi ? `<td class="nowrap">${chosenOf(i, k)}</td>` : ''}
        <td class="num">${measured ? src.t[i] : '—'}</td><td class="num">${measured ? src.y[i] : '—'}</td><td class="num">${measured ? fix(src.cost[i], 2) : '—'}</td>${truth ? `<td class="num">${fix(src.tauR[i], 3)}</td><td class="num">${fix(src.tauC[i], 3)}</td>` : ''}<td class="muted">${use}</td></tr>`;
      if (!open) return main;
      if (k === 'explore') return `${main}<tr class="row-more"><td colspan="${span}"><div>Explore 행은 모델 점수로 선정하지 않아요. 모든 알고리즘의 benchmark와 재학습에 똑같이 쓰여요.</div></td></tr>`;
      const others = armsOf(run).filter(a => trace.arms[a.id]).map(a => { const r = trace.arms[a.id].rank[i], limit = c.arms.find(x => x.arm === a.id)?.selected ?? 0; return `<span class="${r && r <= limit ? 'is-picked' : ''}"><b>${esc(a.name)}</b> ${r ? `${int(r)}위 · ${r <= limit ? 'exploit' : '미선정'}` : 'explore'}</span>`; }).join('');
      return `${main}<tr class="row-more"><td colspan="${span}"><div>알고리즘별 순위<p>${others}</p></div></td></tr>`;
    };
    box.innerHTML = `${head}<div class="row-tools"><div class="seg" role="radiogroup" aria-label="strategy 필터">${[['exploit', 'Exploit'], ['rest', '미선정'], ['explore', 'Explore'], ['all', '전체']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${filter === k}" data-filter="${k}">${t} ${counts[k]}</button>`).join('')}</div><span class="muted small">Exploit은 ${int(N)}위까지예요. 행을 선택하면 알고리즘별 순위를 볼 수 있어요.</span></div>
      <div class="table-scroll"><table class="table rows"><thead><tr><th>user id</th><th>strategy</th>${features.map(f => `<th class="num" title="${esc(f)}">${esc(f)}</th>`).join('')}<th class="num">score</th><th class="num">rank</th>${multi ? '<th>선택 처치</th>' : ''}<th class="num">처치<small>T</small></th><th class="num">${esc(W.outcome)}<small>Yʳ</small></th><th class="num">비용<small>Yᶜ</small></th>${truth ? '<th class="num">증분 성과<small>참값 τʳ</small></th><th class="num">증분 비용<small>참값 τᶜ</small></th>' : ''}<th>용도</th></tr></thead><tbody>${shown.map(line).join('') || `<tr><td colspan="${span}" class="muted">이 조건의 행이 표본에 없어요.</td></tr>`}</tbody></table></div>`;
  }
  function rowsCsv() {
    const c = cycleNow(), trace = c.trace, ids = Object.keys(trace.arms), features = (run.plan?.features || []).slice(0, trace.X[0]?.length ?? 0), quote = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const multi = !!trace.arms[ids[0]]?.arm, hasTau = !!(trace.tauR || trace.arms[ids[0]]?.tauR);
    const measured = i => trace.explore[i] || (!multi && ids.some(id => { const r = trace.arms[id].rank[i], limit = c.arms.find(x => x.arm === id)?.selected ?? 0; return r && r <= limit; }));
    const header = ['user_id', 'in_explore', ...features, 'T', 'Y_r', 'Y_c', 'split', ...(trace.tauR ? ['tau_r_true', 'tau_c_true'] : []), ...ids.flatMap(id => [`score_${id}`, `rank_${id}`, `exploit_${id}`, ...(multi ? [`treatment_${id}`, `T_${id}`, `Y_r_${id}`, `Y_c_${id}`, ...(hasTau ? [`tau_r_true_${id}`, `tau_c_true_${id}`] : [])] : [])])];
    const body = trace.ids.map((rid, i) => [rid, Number(trace.explore[i]), ...trace.X[i], ...(measured(i) ? [trace.t[i], trace.y[i], trace.cost[i]] : ['', '', '']), trace.explore[i] ? trace.split[i] : '', ...(trace.tauR ? [trace.tauR[i], trace.tauC[i]] : []),
      ...ids.flatMap(id => { const r = trace.arms[id].rank[i], limit = c.arms.find(x => x.arm === id)?.selected ?? 0; const m = trace.arms[id]; return [m.score[i] ?? '', r ?? '', r ? Number(r <= limit) : '', ...(multi ? [m.arm[i], m.t[i], m.y[i], m.cost[i], ...(hasTau ? [m.tauR[i], m.tauC[i]] : [])] : [])]; })]);
    download(`upliftlab-cycle-${c.cycle}.csv`, [header, ...body].map(line => line.map(quote).join(',')).join('\n'), 'text/csv');
  }
  function legend(id, extra = '') {
    $(id, el).innerHTML = armsOf(run).map(a => `<span class="${focus && focus !== a.id ? 'is-dim' : ''}" data-arm="${esc(a.id)}"><i style="background:${a.color}"></i>${esc(a.name)}</span>`).join('') + extra;
  }
  function gainChart() {
    const box = $('#gain-chart', el), arms = armsOf(run), total = run.plan?.cycles || run.config.cycles, k = FIELDS[basis].gain;
    legend('#gain-legend');
    if (!run.cycles.length) { box.innerHTML = '<p class="chart-empty">사이클 1이 끝나면 표시돼요.</p>'; return; }
    const series = arms.map(a => ({id: a.id, name: a.name, color: a.color, points: run.cycles.map(c => [c.cycle, c.arms.find(r => r.arm === a.id)?.[k] ?? null])}));
    lineChart(box, {series, focus, x: {domain: [1, Math.max(2, total)], ticks: Array.from({length: total}, (_, i) => i + 1), format: v => String(v)}, y: {format: v => pct(v), label: '사이클별 효율 개선'},
      baseline: {y: 0, label: 'Explore benchmark'}, hover: {xs: run.cycles.map(c => c.cycle), title: v => `사이클 ${v}${v === 1 ? ' · 무작위 선정' : ''}`, value: (s, x) => s.points.find(p => p[0] === x)?.[1]}});
  }
  function curveChart() {
    const box = $('#curve-chart', el), arms = armsOf(run), last = [...run.cycles].reverse().find(c => c.arms.some(r => r.train?.curve)), qini = curveKind === 'qini';
    $('#curve-title', el).textContent = qini ? 'Qini Curve' : 'Cost Curve';
    $$('[data-curve]', el).forEach(b => b.setAttribute('aria-checked', String(b.dataset.curve === curveKind)));
    legend('#curve-legend', '<span class="ref"><i class="dash"></i>무작위 순서</span>');
    if (!last) { box.innerHTML = '<p class="chart-empty">첫 학습이 끝나면 표시돼요.</p>'; $('#curve-note', el).textContent = qini ? '점수 순으로 처치 범위를 넓힐 때의 처치 대상 비율(x)과 증분 성과(y)예요.' : '점수 순으로 처치 범위를 넓힐 때의 증분 비용(x)과 증분 성과(y)예요.'; return; }
    const truth = basis === 'truth' && last.arms.some(r => r.train?.truthCurve), test = last.arms.find(r => r.train?.n)?.train.n;
    $('#curve-note', el).textContent = qini
      ? `사이클 ${last.cycle}에 학습한 모델을 test ${int(test)}행에 적용해, 점수 순으로 처치 범위를 넓힐 때의 처치 대상 비율(x)과 증분 성과(y)를 그렸어요. y축은 전체 처치 시 증분 성과로 정규화했어요. 대각선은 무작위 순서이고, 왼쪽 위로 휠수록 Qini가 커요. 비용은 반영하지 않아요.`
      : `사이클 ${last.cycle}에 학습한 모델을 test ${int(test)}행에 적용해, 점수 순으로 처치 범위를 넓힐 때의 증분 비용(x)과 증분 성과(y)를 그렸어요. 양 축은 최댓값으로 정규화했어요. 대각선은 무작위 순서이고, 왼쪽 위로 휠수록 AUCC가 커요.`;
    const series = arms.map(a => {
      const curve = last.arms.find(r => r.arm === a.id)?.train?.[truth ? 'truthCurve' : 'curve'];
      if (!curve) return {id: a.id, name: a.name, color: a.color, points: []};
      const end = curve.at(-1), cx = end.cost || Math.max(...curve.map(p => Math.abs(p.cost))) || 1, cy = end.value || Math.max(...curve.map(p => Math.abs(p.value))) || 1;
      return {id: a.id, name: a.name, color: a.color, points: curve.map(p => [qini ? p.f : p.cost / cx, p.value / cy])};
    });
    const grid = Array.from({length: 21}, (_, i) => i / 20);
    lineChart(box, {series, focus, diagonal: true, x: {domain: [0, 1], ticks: [0, .25, .5, .75, 1], format: v => `${Math.round(v * 100)}%`}, y: {format: v => `${Math.round(v * 100)}%`, label: qini ? 'Qini Curve' : 'Cost Curve'},
      hover: {xs: grid, title: v => `${qini ? '처치 대상' : '증분 비용'} ${Math.round(v * 100)}% 지점`, value: (s, x) => interpolate(s.points, x)}});
  }
  function defs() {
    $('#defs', el).innerHTML = `<summary>지표 정의</summary><dl class="defs">
      <div><dt>비용 효율 (cost effectiveness)</dt><dd>증분 성과 ÷ 증분 비용 = ATEʳ / ATEᶜ. 비용 1을 더 쓸 때 늘어나는 성과이고, 논문의 R이에요. ATEʳ는 처치군과 대조군의 평균 ${esc(W.outcome)} 차이, ATEᶜ는 평균 비용 차이예요.</dd></div>
      <div><dt>효율 개선 (relative efficiency gain)</dt><dd>(Exploit 비용 효율 − Explore 비용 효율) / Explore 비용 효율. 0%면 Explore benchmark와 같아요. 사이클 2부터 Exploit 인원으로 가중 합산해요.</dd></div>
      <div><dt>참값 · 관측</dt><dd>합성 데이터는 사용자별 잠재 결과를 알아서 τʳ, τᶜ의 참값을 계산할 수 있어요. 관측은 처치군과 대조군의 차이로 추정한 값이고 표본 오차가 있어요.</dd></div>
      <div><dt>95% CI · 1위와 차이</dt><dd>처치군과 대조군을 각각 부트스트랩(200회)해 구해요. 1위와 차이의 95% CI가 0을 포함하면 ‘유의차 없음’으로 표시해요.</dd></div>
      <div><dt>${esc(W.incR)} · 증분 비용</dt><dd>Exploit 인원 × ATEʳ, Exploit 인원 × ATEᶜ. Exploit 그룹 전체를 처치했을 때의 합계예요.</dd></div>
      <div><dt>AUCC</dt><dd>학습에 쓰지 않은 test 행에서 구한 Cost Curve 아래 면적이에요. 무작위 순서가 약 0.5이고, 표본이 작으면 변동이 커요.</dd></div>
      <div><dt>Qini</dt><dd>Qini Curve(처치 대상 비율에 따른 증분 성과)와 무작위 순서 대각선 사이의 넓이를, 전체 처치 시 증분 성과로 나눈 값이에요. 무작위 순서가 약 0이에요. 비용을 반영하지 않으므로 AUCC와 순위가 다를 수 있어요.</dd></div>
      <div><dt>Uplift@k</dt><dd>test 행 중 점수 상위 k%의 ATEʳ이에요. k는 Exploit 비율 q(예산을 쓰는 선정 방식이면 예산 비율)예요. 비용을 반영하지 않아요.</dd></div>
      ${Object.values(SELECTION).map(m => `<div><dt>선정 방식 · ${m.name}</dt><dd>${m.rule} 공개 사례: ${m.who.map(w => `<a class="link" href="${w[1]}" target="_blank" rel="noopener">${w[0]}</a>`).join(', ')}</dd></div>`).join('')}
      <div><dt>예산 · 예상 증분 비용</dt><dd>예산은 예산 비율 × 후보 전원의 예상 증분 비용이에요. 예상 증분 비용과 효율 제약의 예상 효과는 Explore train 행으로 학습한 Ridge 모델로 구하고, 모든 알고리즘이 같은 모델을 써요.</dd></div>
      <div><dt>score_is_effect</dt><dd>Knapsack과 효율 제약은 점수를 기대 효과로 읽어 비용과 견줘요. 점수가 효과가 아닌 Random과 Duality R-Learner는 점수 순서를 그대로 쓰고, 내 코드도 Model에 score_is_effect = False를 두면 같아요.</dd></div>
      <div><dt>기본 모델</dt><dd>기본 제공 알고리즘의 회귀 모델이에요. Ridge는 선형 모델이고, Gradient Boosting은 scikit-learn의 HistGradientBoosting(max_depth 3, 100 iterations)이에요.</dd></div>
      <div><dt>다중 처치</dt><dd>처치가 K종류면 처치마다 T=k 행과 T=0 행으로 CATE를 추정하고, 사용자마다 점수가 가장 큰 처치를 골라요. 온라인 평가는 고른 처치와 대조군의 차이로 구해요.</dd></div></dl>`;
  }
  function detail() { treatments(); picked(); cycle(); rowsTable(); }
  function charts() { gainChart(); curveChart(); }
  function all() { bar(); how(); live(); verdict(); board(); detail(); charts(); defs(); }
  all();

  const setFocus = id => { if (id === focus) return; focus = id; charts(); };
  const pickArm = id => { selected = id; focus = id; board(); detail(); charts(); };
  el.addEventListener('mouseover', e => { const t = e.target.closest('.legend [data-arm], .board tr[data-arm]'); if (t) setFocus(t.dataset.arm); });
  el.addEventListener('mouseout', e => { const t = e.target.closest('.legend [data-arm], .board tr[data-arm]'); if (t && !t.contains(e.relatedTarget)) setFocus(null); });
  el.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const t = e.target.closest('[data-act], [data-basis], [data-curve], [data-del], [data-cycle], [data-filter], [data-row], .board tr[data-arm], .cycle-table tr[data-arm]');
    if (!t) { if (!e.target.closest('.menu')) closeMenu(); return; }
    if (t.dataset.basis) { basis = t.dataset.basis; basisChosen = true; board(); charts(); return; }
    if (t.dataset.curve) { curveKind = t.dataset.curve; curveChart(); return; }
    if (t.dataset.cycle) { cycleAt = Number(t.dataset.cycle); openRow = null; cycle(); rowsTable(); return; }
    if (t.dataset.filter) { filter = t.dataset.filter; openRow = null; rowsTable(); return; }
    if (t.dataset.row) { openRow = openRow === t.dataset.row ? null : t.dataset.row; rowsTable(); return; }
    if (t.dataset.del) { deleteRun(t.dataset.del); if (t.dataset.del === run.id) go('#/'); else history(); return; }
    if (t.dataset.arm) { pickArm(t.dataset.arm); return; }
    const act = t.dataset.act;
    if (act === 'history' || act === 'share') {
      const pop = $(`#${act}-pop`, el), open = pop.hidden;
      closeMenu();
      if (open && act === 'history') history();
      if (open && act === 'share') $('#share-msg', el).textContent = '';
      pop.hidden = !open; t.setAttribute('aria-expanded', String(open));
    }
    else if (act === 'export') { closeMenu(); download(`upliftlab-${run.id}.json`, exportRun(run)); }
    else if (act === 'report-html') { closeMenu(); downloadReport(run); }
    else if (act === 'report-pdf') { closeMenu(); printReport(run); }
    else if (act === 'report-copy') copySummary(run).then(() => { $('#share-msg', el).textContent = '요약을 복사했어요. 메신저에 붙여 넣으세요.'; }, () => { $('#share-msg', el).textContent = '이 브라우저에서는 복사할 수 없어요. HTML 보고서를 내려받아 주세요.'; });
    else if (act === 'stats') { stats = !stats; board(); }
    else if (act === 'use') useConfig(run.config);
    else if (act === 'csv') rowsCsv();
    else if (act === 'pause') pauseRun(); else if (act === 'resume') resumeRun(); else if (act === 'stop') stopRun();
  });
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('.board tr[data-arm], [data-row]'); if (!t) return;
    e.preventDefault(); t.click();
  });
  el.addEventListener('change', async e => {
    if (e.target.id !== 'import-run') return;
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { go('#/runs/' + importRun(await file.text(), file.name)); } catch (error) { $('#import-msg', el).textContent = error.message; }
  });
  const closeMenu = () => { for (const name of ['history', 'share']) { const pop = $(`#${name}-pop`, el); if (pop && !pop.hidden) { pop.hidden = true; $(`[data-act="${name}"]`, el)?.setAttribute('aria-expanded', 'false'); } } };
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('keydown', onKey); cleanups.push(() => document.removeEventListener('keydown', onKey));
  cleanups.push(responsive($('#gain-chart', el), gainChart), responsive($('#curve-chart', el), curveChart));
  cleanups.push(subscribe(kind => {
    if (kind === 'progress') { if (state.live === run) { live(); board(); } return; }
    if (kind === 'loading' || kind === 'engine') { if (state.live === run) live(); if (kind === 'engine') heroNote(); }
    if (kind === 'draft') { how(); bar(); return; }
    if (kind === 'run' && state.live === run) { if (!basisChosen) basis = hasTruth(run) ? 'truth' : 'observed'; bar(); live(); verdict(); board(); detail(); charts(); return; }
    if (kind === 'runs' || kind === 'engine' || kind === 'algorithms' || kind === 'datasets') { bar(); how(); }
  }));
  return {destroy: () => cleanups.forEach(f => f())};
}
