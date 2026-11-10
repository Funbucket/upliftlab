// Reading a run: the basis it ranks on, its algorithms, the leader's Exploit group, and the conclusion.
// The results panel and the shared report both use these, so the app and the report say the same thing.
import {esc, isNum, int, pct, pp, josa, colorsFor} from './lib.js?v=0.23.0';
import {algorithm} from './store.js?v=0.23.0';

export const FIELDS = {
  truth: {gain: 'truthGain', R: 'truthR', base: 'baseTruthR', incR: 'truthIncR', incC: 'truthIncC', aucc: 'auccTruth', qini: 'qiniTruth', upliftAt: 'upliftAtTruth', name: '참값'},
  observed: {gain: 'gain', R: 'R', base: 'baseR', incR: 'incR', incC: 'incC', aucc: 'aucc', qini: 'qini', upliftAt: 'upliftAt', name: '관측'},
};
export const BASIS_NOTE = {truth: '합성 데이터라서 알 수 있는 실제 효과', observed: '처치군과 대조군의 차이로 추정한 값'};
export const baseOf = (s, F) => s[F.base] ?? (isNum(s[F.R]) && isNum(s[F.gain]) ? s[F.R] / (1 + s[F.gain]) : null);
export const hasTruth = run => (run.summary ? !!run.summary.by?.startsWith('truth') : !!run.plan?.truth);
export const modeOf = run => run.plan?.mode || run.config?.mode || 'quantile';
export const isBudget = run => ['budget', 'knapsack'].includes(modeOf(run));
export const byVolume = run => modeOf(run) !== 'quantile';  // the group size differs between algorithms, so the rank is the incremental outcome
export const sumOf = (run, id) => run.summary?.arms.find(a => a.arm === id);
export const datasetOf = run => run.config?.dataset || run.plan?.dataset;
export const pooledFrom = s => (s.cycles === 1 ? '사이클 2' : `사이클 2–${s.cycles + 1}`);

export function armsOf(run) {
  const list = run.plan?.algorithms || run.config.algorithms.map(id => ({id, name: algorithm(id)?.name || id}));
  const colors = colorsFor(list.map(a => a.id));
  return list.map(a => ({...a, color: colors[a.id], user: !!algorithm(a.id) && !algorithm(a.id).builtin}));
}

// The Exploit group's covariates against the candidate pool, pooled over the cycles served by the algorithm's own model.
export function exploitProfile(run, id) {
  const rows = run.cycles.map(c => ({c, r: c.arms.find(a => a.arm === id)})).filter(({c, r}) => r?.version > 0 && r.profile && c.pool);
  if (!rows.length) return null;
  const total = rows.reduce((sum, {r}) => sum + r.selected, 0);
  return (run.plan?.features || []).map((name, j) => {
    const avg = pick => rows.reduce((sum, x) => sum + pick(x)[j] * x.r.selected, 0) / total;
    const mean = avg(x => x.r.profile), base = avg(x => x.c.pool.mean), std = avg(x => x.c.pool.std);
    return {name, mean, base, d: std > 0 ? (mean - base) / std : 0};
  }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}
export function describeProfile(items) {
  const top = items.filter(x => Math.abs(x.d) >= .15).slice(0, 2);
  if (!top.length) return '후보 풀과 공변량 차이가 작아요 (|SMD| < 0.15).';
  const word = (x, end) => `${x.name.includes('=') ? `${x.name} 비중이` : josa(x.name, '이', '가')} ${x.d > 0 ? (end ? '높아요' : '높고') : (end ? '낮아요' : '낮고')}`;
  return `후보 풀 대비 ${top.length === 2 ? `${word(top[0], false)} ${word(top[1], true)}` : word(top[0], true)}.`;
}

/* The conclusion of a run, on one basis.
   The rank, the headline and the numbers under it use the rank basis (참값 for synthetic data, 관측 for logs). The check of
   whether the gap to second place is real comes from the bootstrap of observed values, so it is its own sentence that says 관측.
   Returns HTML pieces (names escaped) and a plain-text version for pasting into chat. */
export function verdictOf(run, W) {
  const s = run.summary, lead = s && sumOf(run, s.leader);
  if (!lead?.cycles) return null;
  const truth = hasTruth(run), basis = truth ? 'truth' : 'observed', F = FIELDS[basis], volume = byVolume(run), mode = modeOf(run);
  const ranked = s.arms.filter(a => a.cycles).sort((a, b) => a.rank - b.rank), second = ranked[1];
  const rnd = lead.arm !== 'random_baseline' ? sumOf(run, 'random_baseline') : null;
  const n = v => `${int(v)}${W.unit}`, signed = v => `${v < 0 ? '−' : '+'}${int(Math.abs(v))}${W.unit}`;
  const incR = esc(W.incR), more = `${esc(josa(W.incR, '이', '가'))} 가장 많아요.`;
  const vsRandom = rnd?.cycles && isNum(rnd[F.incR]) && isNum(lead[F.incR]) ? {label: 'Random 대비', value: signed(lead[F.incR] - rnd[F.incR]), note: rnd[F.incR] > 0 ? pct(lead[F.incR] / rnd[F.incR] - 1) : ''} : null;
  const vsSecond = second && second.arm !== 'random_baseline' && isNum(second[F.incR]) ? {label: `2위 ${esc(second.name)} 대비`, value: signed(lead[F.incR] - second[F.incR]), note: ''} : null;
  const outcome = {label: incR, value: n(lead[F.incR]), note: `${pooledFrom(lead)} 합계`}, spend = {label: '증분 비용', value: int(lead[F.incC]), note: isBudget(run) ? '모든 알고리즘이 같은 예산' : ''};
  let line, kpis, hint = '';
  if (isBudget(run)) { line = `같은 예산에서 ${more}`; kpis = [outcome, vsRandom, vsSecond, spend]; }
  else if (mode === 'roi') { line = lead.meets === false ? `효율 기준을 지킨 알고리즘이 없어요. 그중 ${more}` : `효율 기준을 지키면서 ${more}`; kpis = [outcome, vsSecond || vsRandom, {label: '비용 효율 개선', value: pct(lead[F.gain]), note: 'Explore 대비'}, spend]; }
  else if (mode === 'validation') { line = `validation에서 고른 비율로 선정했을 때 ${more}`; kpis = [outcome, vsSecond || vsRandom, {label: 'Exploit 인원', value: `${int(lead.selected)}명`, note: '사이클 평균'}, spend]; }
  else if (isNum(lead[F.gain]) && lead[F.gain] > 0) {
    line = '같은 인원을 골랐을 때 비용 효율이 가장 높아요.';
    kpis = [{label: '비용 효율 개선', value: pct(lead[F.gain]), note: 'Explore 대비'},
      {...outcome, note: second ? `2위 ${esc(second.name)} 대비 ${signed(lead[F.incR] - second[F.incR])}` : outcome.note},
      {...spend, note: second && second[F.incC] ? `2위 대비 ${pct(lead[F.incC] / second[F.incC] - 1)}` : ''}];
    hint = '예산이 정해져 있다면 선정 방식을 ‘예산 · 점수 순’으로 바꿔 같은 예산에서 비교해요.';
  } else { line = '모든 알고리즘의 비용 효율이 Explore benchmark보다 낮거나 같아요.'; kpis = [{label: '1위의 비용 효율 개선', value: pct(lead[F.gain]), note: 'Explore 대비'}, outcome]; }
  kpis = kpis.filter(Boolean);

  const v = second?.vsLeader, gap = volume ? signed : x => pp(x);
  const check = v && isNum(v.ci?.[0]) ? `${truth ? '관측 기준으로 보면 ' : ''}2위 ${esc(josa(second.name, '과', '와'))}의 차이는 ${gap(-v.diff)}, 95% CI ${gap(-v.ci[1])} ~ ${gap(-v.ci[0])}이에요. ${v.tied ? '구간이 0을 포함해서 확실한 차이는 아니에요.' : '구간이 0을 포함하지 않아 확실한 차이예요.'}` : '';
  const key = volume ? 'incR' : 'gain', top = truth && mode !== 'roi' ? [...ranked].sort((a, b) => (b[key] ?? -1e18) - (a[key] ?? -1e18))[0] : null;
  const flip = top && top.arm !== lead.arm ? `관측 기준 1위는 ${esc(josa(top.name, '이에요', '예요'))}.` : '';
  const sub = [`${F.name} 기준(${BASIS_NOTE[basis]}), ${pooledFrom(lead)} 합산이에요.`, check, flip].filter(Boolean).join(' ');
  const strip = t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const plain = [`1위 ${lead.name} · ${strip(line)}`, kpis.map(k => `${strip(k.label)} ${k.value}${k.note ? ` (${strip(k.note)})` : ''}`).join(' · '), strip(sub)].join('\n');
  return {name: lead.name, line, kpis, sub, hint, plain, basis, bars: barsOf(run, W, F, volume, ranked)};
}

// The ranking at a glance: one bar per algorithm on the value it is ranked by. The leader takes the accent color and Random is
// marked as the baseline, so the gap a model makes is the first thing the eye compares. Plain text; verdictHtml escapes it.
function barsOf(run, W, F, volume, ranked) {
  const value = s => (volume ? s[F.incR] : s[F.gain]), rows = ranked.filter(s => isNum(value(s))), top = Math.max(0, ...rows.map(value));
  if (rows.length < 2 || top <= 0) return null;
  const title = volume ? `알고리즘별 ${W.incR}${isBudget(run) ? ' · 모두 같은 예산' : ''}` : '알고리즘별 비용 효율 개선 · Explore 대비';
  return {title, rows: rows.map(s => ({name: s.name, value: volume ? `${int(value(s))}${W.unit}` : pct(value(s)), width: Math.max(0, value(s)) / top * 100, lead: s.rank === 1, base: s.arm === 'random_baseline'}))};
}

export function verdictHtml(V) {
  const B = V.bars, bars = B ? `<figure class="v-bars"><figcaption>${esc(B.title)}</figcaption><ol>${B.rows.map(r => `<li class="${r.lead ? 'is-lead' : r.base ? 'is-base' : ''}"><span class="vb-name">${esc(r.name)}${r.base ? '<small>기준선</small>' : ''}</span><span class="vb-track"><i style="width:${r.width.toFixed(1)}%"></i></span><span class="vb-val">${esc(r.value)}</span></li>`).join('')}</ol></figure>` : '';
  return `<div class="verdict"><span class="v-rank">1위</span><h2>${esc(V.name)}</h2><p class="v-line">${V.line}</p>
    <div class="v-body ${bars ? '' : 'is-single'}"><dl class="v-kpis">${V.kpis.map(k => `<div><dt>${k.label}</dt><dd>${esc(k.value)}</dd>${k.note ? `<small>${k.note}</small>` : ''}</div>`).join('')}</dl>${bars}</div>
    <p class="v-sub">${V.sub}</p>${V.hint ? `<p class="v-hint">${V.hint}</p>` : ''}</div>`;
}
