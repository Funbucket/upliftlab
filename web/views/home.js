// The home page's own pieces: the timing tower that replays the bundled example cycle by cycle, the run loop drawn as a
// circuit, and the install commands. They read the bundled example only, so they stay the same whatever run is shown below.
import {$, $$, esc, int, isNum, josa, selectionLabel} from '../lib.js?v=0.26.5';
import {EXAMPLE_RUN, wordsFor} from '../store.js?v=0.26.5';
import {armsOf, datasetOf} from '../summary.js?v=0.26.5';
import {EN, tr} from '../i18n.js?v=0.26.5';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROW = 58;
const PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2v8M9 2v8" stroke="currentColor" stroke-width="2"/></svg>';
const PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5l7 4.5-7 4.5z" fill="currentColor"/></svg>';
const AGAIN = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6a3.5 3.5 0 1 0 1-2.5M2.5 1.5v2h2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

// The cumulative incremental outcome of every algorithm after each cycle. Cycle 1 has no model and is left out of the ranking,
// so every line starts at 0 and the last value is the result's incR.
function standings(run) {
  return armsOf(run).map(a => {
    let sum = 0;
    return {id: a.id, name: a.name, base: a.id === 'random_baseline', s: run.cycles.map(c => { const r = c.arms.find(x => x.arm === a.id); if (c.cycle > 1 && isNum(r?.incR)) sum += r.incR; return sum; })};
  });
}

export function towerPanel(el, run = EXAMPLE_RUN) {
  const W = wordsFor(datasetOf(run)), lines = standings(run), N = run.cycles.length, max = Math.max(1, ...lines.map(l => l.s.at(-1)));
  if (!N) { el.hidden = true; return {destroy() {}}; }
  // How the final ranking reads: the run of ranks right below the leader whose gap holds 0, and the ones that are sure.
  const ranked = (run.summary?.arms || []).filter(a => a.cycles).sort((a, b) => a.rank - b.rank);
  let close = 1; while (ranked[close]?.vsLeader?.tied) close++;
  const sure = ranked.slice(close).filter(a => a.vsLeader && !a.vsLeader.tied).map(a => a.name);
  const final = EN ? (close > 1 ? `Ranks 1–${close} are within the 95% CI.${sure.length ? ` The gap to ${esc(sure.join(', '))} is significant.` : ''}` : 'The gap between #1 and #2 is significant.')
    : close > 1 ? `1~${close}위 차이는 95% CI 안이에요.${sure.length ? ` ${esc(josa(sure.join(', '), '과', '와'))}의 차이는 유의해요.` : ''}` : '1위와 2위의 차이가 유의해요.';
  el.innerHTML = `<div class="t-head"><span class="t-live"><i></i>${tr('다시 보기', 'Replay')}</span><span class="t-ctx">${esc(W.data.split(' ')[0])} · ${esc(selectionLabel(run.plan || run.config))}</span>
      <span class="t-cyc"><span class="fig"><small class="caps">Cycle</small><b data-cyc>1</b> / ${N}</span><span class="t-segs">${'<i></i>'.repeat(N)}</span></span>
      <span class="t-ctl"><button type="button" data-t="pause" aria-label="${tr('멈추기', 'Pause')}">${PAUSE}</button><button type="button" data-t="again" aria-label="${tr('처음부터', 'Restart')}">${AGAIN}</button></span></div>
    <div class="t-cols caps"><span>${tr('순위', 'Rank')}</span><span>${tr('모델', 'Model')}</span><span>${EN ? `Incr. ${esc(W.outcome)}` : `누적 ${esc(W.incR)}`}</span><span>${tr('선두와', 'Gap')}</span></div>
    <ol class="t-rows" style="height:${ROW * lines.length}px">${lines.map(l => `<li class="t-row ${l.base ? 'is-base' : ''}" data-id="${esc(l.id)}"><span class="t-pos fig">–</span><span class="t-who"><b>${esc(l.name)}</b><span class="t-track"><i></i></span></span><b class="t-val fig">0</b><span class="t-gap fig">–</span></li>`).join('')}</ol>
    <p class="t-foot"><span class="flag">${tr('사진 판정', 'Photo finish')}</span><span data-note></span></p>`;
  const rows = Object.fromEntries($$('.t-row', el).map(li => [li.dataset.id, li])), shown = Object.fromEntries(lines.map(l => [l.id, 0]));
  let at = 0, playing = !still(), timer = 0;
  const frames = new Set();
  const count = (id, to) => {
    const from = shown[id], t0 = performance.now(), d = still() ? 0 : 900, out = $('.t-val', rows[id]);
    const step = now => { const p = d ? Math.min(1, (now - t0) / d) : 1; shown[id] = from + (to - from) * (1 - (1 - p) ** 3); out.textContent = int(shown[id]); if (p < 1) frames.add(requestAnimationFrame(step)); };
    frames.add(requestAnimationFrame(step));
  };
  function show(c) {
    at = c;
    const order = [...lines].sort((a, b) => (b.s[c] - a.s[c]) || (lines.indexOf(a) - lines.indexOf(b))), lead = order[0].s[c];
    order.forEach((l, i) => {
      const li = rows[l.id]; li.style.transform = `translateY(${i * ROW}px)`; li.classList.toggle('is-lead', c > 0 && i === 0);
      $('.t-pos', li).textContent = c ? i + 1 : '–';
      $('.t-track i', li).style.width = `${(l.s[c] / max * 100).toFixed(1)}%`;
      $('.t-gap', li).textContent = !c ? '–' : i ? `−${int(lead - l.s[c])}` : tr('선두', 'Lead');
      count(l.id, l.s[c]);
    });
    $('[data-cyc]', el).textContent = c + 1;
    $$('.t-segs i', el).forEach((s, i) => s.classList.toggle('on', i <= c));
    const last = c === N - 1, foot = $('.t-foot', el);
    foot.classList.toggle('is-final', last); foot.classList.toggle('is-close', last && close > 1);
    $('[data-note]', el).innerHTML = !c ? tr('1사이클은 학습할 결과를 모으는 사이클이라 순위 합산에서 빠져요.', 'Cycle 1 only collects data to learn from, so it is left out of the ranking.') : last ? final : EN ? `Total ${esc(W.incR)} · measured each cycle as treatment minus control.` : `누적 ${esc(W.incR)}(${esc(W.unit)}) · 사이클마다 처치군과 대조군 차이로 재요.`;
  }
  function loop() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(() => { show(at === N - 1 ? 0 : at + 1); loop(); }, at === N - 1 ? 4200 : at ? 1500 : 1800);
  }
  const button = $('[data-t="pause"]', el);
  const setPlaying = on => { playing = on; button.innerHTML = on ? PAUSE : PLAY; button.setAttribute('aria-label', on ? tr('멈추기', 'Pause') : tr('재생', 'Play')); loop(); };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (!t) return;
    if (t.dataset.t === 'pause') setPlaying(!playing);
    else { show(0); setPlaying(true); }
  });
  show(playing ? 0 : N - 1); setPlaying(playing);
  return {destroy() { clearTimeout(timer); frames.forEach(cancelAnimationFrame); }};
}

// One cycle as one lap: S1 선정 → S2 처치·대조 → S3 측정 → S4 재학습, with the step list beside it following the runner.
export function loopPanel(svg, steps) {
  const d = 'M200 50 H440 A120 120 0 0 1 440 290 H200 A120 120 0 0 1 200 50 Z', ST = 240, ARC = Math.PI * 120;
  const ends = [ST, ST + ARC, 2 * ST + ARC, 2 * (ST + ARC)], mids = [ST / 2, ST + ARC / 2, ST + ARC + ST / 2, 2 * ST + ARC + ARC / 2];
  const names = EN ? ['Select', 'Treat · control', 'Measure', 'Retrain'] : ['선정', '처치 · 대조', '측정', '재학습'], place = [[0, -34, 'middle'], [-44, 6, 'end'], [0, 48, 'middle'], [44, 6, 'start']];
  svg.innerHTML = `<path d="${d}" class="lp-track"/><path d="${d}" class="lp-trail"/><path d="${d}" class="lp-dash"/><g class="lp-marks"></g>
    <text x="320" y="176" text-anchor="middle" class="lp-count">×${EXAMPLE_RUN.plan?.cycles || 8}</text><text x="320" y="206" text-anchor="middle" class="lp-sub">${tr('사이클마다 한 바퀴', 'one lap per cycle')}</text><circle r="9" class="lp-runner"/>`;
  const path = $('.lp-trail', svg), len = path.getTotalLength(), runner = $('.lp-runner', svg), items = $$('li', steps);
  $('.lp-marks', svg).innerHTML = mids.map((l, i) => {
    const p = path.getPointAtLength(l), flat = i % 2 === 0;
    return `<line class="lp-tick" x1="${flat ? p.x : p.x - 18}" y1="${flat ? p.y - 18 : p.y}" x2="${flat ? p.x : p.x + 18}" y2="${flat ? p.y + 18 : p.y}"/>
      <text class="lp-label" data-i="${i}" x="${p.x + place[i][0]}" y="${p.y + place[i][1]}" text-anchor="${place[i][2]}"><tspan class="lp-s">S${i + 1} </tspan>${names[i]}</text>`;
  }).join('');
  const labels = $$('.lp-label', svg);
  path.style.strokeDasharray = len;
  let frame = 0;
  const t0 = performance.now(), T = 9000;
  const draw = now => {
    const f = still() ? .58 : ((now - t0) % T) / T, l = f * len, p = path.getPointAtLength(l), s = ends.findIndex(e => l < e);
    runner.setAttribute('cx', p.x); runner.setAttribute('cy', p.y); path.style.strokeDashoffset = len - l;
    items.forEach((li, i) => li.classList.toggle('is-on', i === s)); labels.forEach((t, i) => t.classList.toggle('is-on', i === s));
    if (!still()) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return {destroy: () => cancelAnimationFrame(frame)};
}

// The ways to run it locally, from PyPI.
const INSTALL = [
  {tab: 'pip', lines: ['pip install upliftlab', 'upliftlab'], note: tr('내 Python 환경에 설치해요. 이미 깔린 LightGBM, PyTorch를 내 알고리즘에서 그대로 써요.', 'Installs into your Python environment. Your algorithms can use the LightGBM and PyTorch you already have.')},
  {tab: 'uvx', lines: ['uvx upliftlab'], note: tr('내 Python 환경에 설치하지 않고 바로 실행해요. uv가 격리된 환경을 따로 만들어요.', 'Runs without installing into your environment. uv makes an isolated one.')},
  {tab: tr('명령줄 비교', 'Command line'), lines: ['upliftlab run --data my.csv --algorithm my_model.py'], note: tr('화면 없이 내 데이터와 내 모델로 비교하고, 순위표를 터미널에 보여 줘요.', 'Compares your model on your data without the screen and prints the standings in the terminal.')},
];
export function installPanel(el) {
  let i = 0;
  const draw = () => {
    $$('[data-tab]', el).forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.tab) === i)));
    $('.in-body', el).innerHTML = INSTALL[i].lines.map(l => `<div><span class="in-ps">$</span>${esc(l)}</div>`).join('');
    $('.in-note', el).textContent = INSTALL[i].note;
    $('[data-copy]', el).textContent = 'copy';
  };
  el.innerHTML = `<div class="in-top" role="tablist">${INSTALL.map((x, k) => `<button type="button" role="tab" data-tab="${k}">${esc(x.tab)}</button>`).join('')}<button type="button" class="in-copy" data-copy>copy</button></div>
    <div class="in-body"></div><p class="in-note"></p>`;
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-tab], [data-copy]'); if (!t) return;
    if (t.dataset.tab) { i = Number(t.dataset.tab); draw(); return; }
    navigator.clipboard?.writeText(INSTALL[i].lines.join('\n')).then(() => { t.textContent = 'copied'; }, () => { t.textContent = tr('복사 안 됨', 'copy failed'); });
  });
  draw();
  return {destroy() {}};
}
