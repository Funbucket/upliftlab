// Small helpers shared by every view.
export const $ = (selector, el = document) => el.querySelector(selector);
export const $$ = (selector, el = document) => [...el.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
// A value that rounds to zero has no sign: 0%, not −0%.
const signed = (v, d, unit) => { const text = Math.abs(v * 100).toFixed(d); return `${Number(text) === 0 ? '' : v < 0 ? '−' : '+'}${text}${unit}`; };
export const int = v => (isNum(v) ? Math.round(v).toLocaleString('ko-KR') : '—');
export const fix = (v, d = 2) => (isNum(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '—');
export const pct = (v, d = 0) => (isNum(v) ? signed(v, d, '%') : '—');
export const pp = (v, d = 0) => (isNum(v) ? signed(v, d, '%p') : '—');
export const share = v => (isNum(v) ? `${Math.round(v * 100)}%` : '—');
export const duration = v => (!isNum(v) ? '—' : v < 1 ? '<1ms' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}초`);
export const when = t => new Date(t).toLocaleString('ko-KR', {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'});

// Categorical slots in fixed order, stepped for the dark surface (#0b0d11): OKLCH L 0.48–0.67, ≥ 3:1 contrast, worst adjacent
// CVD ΔE 8.4 and normal-vision ΔE 19.3, checked with the dataviz palette validator.
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const MAX_ALGORITHMS = PALETTE.length;
export const BASELINE = '#8b95a1';  // the random baseline is a reference, not a contender
// Colors follow each algorithm's position in a run; the random baseline always reads as a neutral reference.
export function colorsFor(ids) {
  let slot = 0;
  return Object.fromEntries(ids.map(id => [id, id === 'random_baseline' ? BASELINE : PALETTE[slot++ % PALETTE.length]]));
}

// How Exploit is selected. `who` names public cases whose papers describe the rule.
export const BUDGET_MODES = ['budget', 'knapsack'];
const CASE = {
  uber: ['Uber', 'https://arxiv.org/abs/2004.09702'], bookingRoi: ['Booking.com', 'https://arxiv.org/abs/2008.06293'], bookingKnapsack: ['Booking.com', 'https://arxiv.org/abs/2108.13298'],
  kuaishou: ['Kuaishou', 'https://arxiv.org/abs/2201.12585'], meituan: ['Meituan', 'https://arxiv.org/abs/2407.13664'], doordash: ['DoorDash', 'https://causal-machine-learning.github.io/kdd2025-workshop/papers/16.pdf'],
};
export const SELECTION = {
  budget: {name: '예산 · 점수 순', who: [CASE.uber], rule: '모델 점수 순으로 사용자를 더하다가 예상 증분 비용이 예산을 넘기 직전에 멈춰요. 사용 예산이 같으므로 증분 성과로 순위를 매겨요.',
    how: '남은 후보를 모델 점수로 정렬해 예산을 넘기 직전까지 선정해요. 사용 예산이 같으므로 선정 인원은 알고리즘마다 달라요.'},
  quantile: {name: '상위 q%', who: [CASE.uber], rule: '모델 점수 상위 비율을 선정해요. 선정 인원이 같으므로 효율 개선으로 순위를 매겨요.',
    how: '남은 후보를 모델 점수로 정렬해 상위 q%를 선정해요.'},
  knapsack: {name: '예산 · Knapsack', who: [CASE.meituan, CASE.kuaishou, CASE.bookingKnapsack], rule: '효과 − λ·비용이 양수인 사용자를 선정하고, λ는 예산에 맞춰 찾아요. 처치 종류도 함께 정해요. 사용 예산이 같으므로 증분 성과로 순위를 매겨요.',
    how: '남은 후보 중 효과 − λ·비용이 양수인 사용자를 선정해요. λ는 예산에 맞춰 찾아요. 사용 예산이 같으므로 선정 인원은 알고리즘마다 달라요.'},
  roi: {name: '효율 제약 · ROI', who: [CASE.bookingRoi, CASE.doordash], rule: '효과 ÷ 비용이 큰 순으로 더하다가, 예상 비용 효율이 기준을 지키는 마지막 사용자에서 멈춰요. 기준을 지킨 알고리즘을 먼저 놓고 증분 성과로 순위를 매겨요.',
    how: '남은 후보를 효과 ÷ 비용이 큰 순으로 더하다가, 예상 비용 효율이 기준을 지키는 마지막 사용자에서 멈춰요. 선정 인원은 알고리즘마다 달라요.'},
  validation: {name: 'validation 최적 비율', who: [CASE.doordash], rule: 'validation 행에서 총 증분 성과가 가장 큰 상위 비율까지 선정해요. 비용을 보지 않아서, 효과가 대부분 양수인 데이터에서는 거의 전원을 선정해요.',
    how: '남은 후보를 모델 점수로 정렬해, validation 행에서 총 증분 성과가 가장 큰 비율까지 선정해요. 선정 인원은 알고리즘마다 달라요.'},
};
// One short label for a run or a draft: "q 40%", "예산 40%", ...
export function selectionLabel(c) {
  const mode = c.mode || 'quantile';
  if (mode === 'budget') return `예산 ${share(c.budget)}`;
  if (mode === 'knapsack') return `Knapsack 예산 ${share(c.budget)}`;
  if (mode === 'roi') return `효율 기준 +${share(c.efficiency ?? .2)}`;
  if (mode === 'validation') return 'validation 최적 비율';
  return `q ${share(c.target)}`;
}

// What each built-in ranks by. The code page has the full description.
export const BRIEF = {
  random_baseline: '무작위 정렬. 비교 기준선',
  x_learner: '두 효과 모델을 propensity로 가중한 CATE 순. 비용 미반영',
  t_learner: '처치군·대조군 모델의 예측 차이(CATE) 순. 비용 미반영',
  r_learner: '잔차 회귀로 추정한 CATE 순. 비용 미반영',
  dml: 'Y와 T의 잔차로 추정한 CATE 순. 비용 미반영',
  duality_r_learner: '증분 성과 − λ·증분 비용 순. 비용 반영',
};

// The Korean particle that follows a word: josa('Random', '은', '는') → '은'.
export function josa(word, withFinal, withoutFinal) {
  const last = String(word).trim().at(-1) || '', code = last.charCodeAt(0);
  const final = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : /[lmnLMN0136789]/.test(last);
  return word + (final ? withFinal : withoutFinal);
}

// A cost unit that makes cost effectiveness readable: "비용 100당 19.4명", "비용 10,000당 3.1".
export function unitFor(R) {
  let unit = 100;
  if (!isNum(R) || R <= 0) return unit;
  while (R * unit < 1) unit *= 10;
  while (R * unit >= 1000 && unit > 1) unit /= 10;
  return unit;
}

export function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], {type})), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const go = hash => { if (location.hash !== hash) location.hash = hash; };
