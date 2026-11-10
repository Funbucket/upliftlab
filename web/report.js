// The shareable report: one self-contained HTML file with the conclusion, the ranking, two charts, the conditions and how to
// read them. It holds aggregates only, never uploaded rows. The same page prints to PDF, and a three-line summary goes to chat.
import {esc, isNum, int, fix, pct, pp, share, duration, unitFor, download, josa, BRIEF, SELECTION, selectionLabel} from './lib.js?v=0.22.0';
import {wordsFor, dataset, algorithm} from './store.js?v=0.22.0';
import {CATALOG} from './catalog.js?v=0.22.0';
import {lineChart} from './charts.js?v=0.22.0';
import {FIELDS, BASIS_NOTE, baseOf, hasTruth, modeOf, isBudget, byVolume, sumOf, datasetOf, armsOf, exploitProfile, describeProfile, verdictOf, verdictHtml} from './summary.js?v=0.22.0';

const SITE = 'https://uplift-lab.vercel.app';
const day = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// A chart drawn by the app's own line chart, frozen as static SVG.
function svgOf(options) {
  const box = document.createElement('div');
  lineChart(box, {...options, width: 720, height: 250, hover: {xs: [], title: () => '', value: () => null}});
  const svg = box.querySelector('svg');
  svg.querySelector('.c-cross')?.remove(); svg.querySelector('.c-hit')?.remove(); svg.removeAttribute('tabindex');
  svg.setAttribute('width', '100%'); svg.removeAttribute('height');
  return svg.outerHTML;
}
const legend = (arms, extra = '') => `<p class="legend">${arms.map(a => `<span><i style="background:${a.color}"></i>${esc(a.name)}</span>`).join('')}${extra}</p>`;

function conditions(run, W) {
  const p = run.plan || {}, c = run.config || {}, d = dataset(datasetOf(run)), mode = modeOf(run), synthetic = hasTruth(run);
  const kind = synthetic ? '합성 데이터 · 사용자별 실제 효과를 알아요' : d?.kind === 'public' ? '공개 실험 로그 · 기록된 처치와 결과를 다시 써요' : '업로드한 실험 로그 · 기록된 처치와 결과를 다시 써요';
  const rows = [
    ['데이터셋', `${esc(W.data)}<small>${kind}${d?.stored?.profile?.rows ? ` · ${int(d.stored.profile.rows)}행` : ''}</small>`],
    ['비교한 알고리즘', armsOf(run).map(a => esc(a.name)).join(', ')],
    ['선정 방식', `${esc(SELECTION[mode]?.name || mode)} · ${esc(selectionLabel(p.mode ? p : c))}<small>${esc(SELECTION[mode]?.rule || '')}</small>`],
    ['사이클', `${int(p.cycles ?? c.cycles)}사이클 · 사이클당 후보 ${int(p.pool)}명 · Explore ${share(p.explore ?? c.explore)}<small>사이클 1은 학습된 모델이 없어 합산에서 빼요.</small>`],
    ['기본 모델', (p.baseLearner ?? c.baseLearner) === 'tree' ? 'Gradient Boosting' : 'Ridge'],
    ['시드', esc(p.seed ?? c.seed)],
    ['실행', run.example ? '예시 결과 (사전 계산)' : [run.createdAt ? new Date(run.createdAt).toLocaleString('ko-KR') : null, run.runtime ? (run.runtime === 'local' ? '로컬 Python' : '브라우저') : null, isNum(run.elapsed) ? duration(run.elapsed) : null].filter(Boolean).join(' · ') || '—'],
  ];
  return `<dl class="conds">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function ranking(run, W) {
  const truth = hasTruth(run), F = FIELDS[truth ? 'truth' : 'observed'], volume = byVolume(run), arms = armsOf(run);
  const rows = arms.map(a => ({a, s: sumOf(run, a.id)})).filter(r => r.s?.cycles).sort((x, y) => x.s.rank - y.s.rank);
  const base = rows.map(r => baseOf(r.s, F)).find(isNum), unit = unitFor(base ?? Math.max(0, ...rows.map(r => r.s[F.R]).filter(isNum)));
  const gap = volume ? v => `${v < 0 ? '−' : '+'}${int(Math.abs(v))}${W.unit}` : v => pp(v);
  const vs = s => { const v = s.vsLeader; if (s.rank === 1 || !v) return '—'; const ci = isNum(v.ci?.[0]) ? `<small>95% CI ${gap(v.ci[0])} ~ ${gap(v.ci[1])}</small>` : ''; return `${v.tied ? '유의차 없음' : gap(v.diff)}${ci}`; };
  const head = `<tr><th class="num">순위</th><th>알고리즘</th><th class="num">${esc(W.incR)}</th><th class="num">증분 비용</th><th class="num">비용 효율<small>비용 ${int(unit)}당</small></th><th class="num">효율 개선<small>Explore 대비</small></th>${volume ? '<th class="num">Exploit 인원<small>사이클 평균</small></th>' : ''}<th class="num">1위와 차이<small>관측</small></th></tr>`;
  const body = rows.map(({a, s}) => `<tr class="${s.rank === 1 ? 'lead' : ''}"><td class="num">${s.rank}</td><td><b><i style="background:${a.color}"></i>${esc(a.name)}</b><small>${esc(BRIEF[a.id] || algorithm(a.id)?.summary || '')}</small></td>
    <td class="num ${volume ? 'key' : ''}">${int(s[F.incR])}</td><td class="num">${int(s[F.incC])}</td><td class="num">${isNum(s[F.R]) ? fix(s[F.R] * unit, 1) : '—'}</td><td class="num ${volume ? '' : 'key'}">${pct(s[F.gain])}</td>${volume ? `<td class="num">${int(s.selected)}</td>` : ''}<td class="num">${vs(s)}</td></tr>`).join('');
  const by = esc(josa(W.incR, '으로', '로')), order = isBudget(run) ? `모든 알고리즘이 같은 예산을 써서 ${by} 순위를 매겨요.` : volume ? `선정 인원이 알고리즘마다 달라서 ${by} 순위를 매겨요.` : '선정 인원이 같아서 비용 효율 개선으로 순위를 매겨요.';
  return `<p class="lead-in">${order} ${F.name} 기준(${BASIS_NOTE[truth ? 'truth' : 'observed']})이에요. 1위와 차이는 관측 값을 부트스트랩해 구한 95% CI가 0을 포함하면 ‘유의차 없음’이에요.${isNum(base) ? ` 무작위로 고르면(Explore) 비용 ${int(unit)}당 ${esc(W.incR)} ${fix(base * unit, 1)}${esc(W.unit)}이에요.` : ''}</p>
    <div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function profile(run) {
  const id = run.summary.leader, name = sumOf(run, id)?.name || id, items = exploitProfile(run, id);
  if (!items) return '';
  const shown = items.slice(0, 6);
  return `<section><h2>1위가 고른 사용자</h2><p class="lead-in">${esc(name)}의 Exploit 그룹을 후보 전체와 비교했어요. ${esc(describeProfile(items))} SMD는 표준화 평균 차이로, 절댓값이 0.2를 넘으면 차이가 있다고 봐요.</p>
    <div class="scroll"><table class="narrow"><thead><tr><th>공변량</th><th class="num">후보 평균</th><th class="num">Exploit 평균</th><th class="num">SMD</th></tr></thead><tbody>${shown.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${fix(x.base, 2)}</td><td class="num"><b>${fix(x.mean, 2)}</b></td><td class="num">${x.d < 0 ? '−' : '+'}${fix(Math.abs(x.d), 2)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function charts(run) {
  const truth = hasTruth(run), F = FIELDS[truth ? 'truth' : 'observed'], arms = armsOf(run), total = run.plan?.cycles || run.config.cycles;
  let out = '';
  if (run.cycles.length > 1) {
    const series = arms.map(a => ({id: a.id, name: a.name, color: a.color, points: run.cycles.map(c => [c.cycle, c.arms.find(r => r.arm === a.id)?.[F.gain] ?? null])}));
    out += `<section><h2>사이클별 효율 개선</h2><p class="lead-in">사이클마다 Exploit의 비용 효율이 무작위 선정(Explore)보다 몇 % 높은지예요. ${F.name} 기준이에요.</p>${legend(arms)}
      <figure>${svgOf({series, direct: false, x: {domain: [1, Math.max(2, total)], ticks: Array.from({length: total}, (_, i) => i + 1), format: v => String(v)}, y: {format: v => pct(v), label: '사이클별 효율 개선'}, baseline: {y: 0, label: '무작위 선정'}})}</figure></section>`;
  }
  const last = [...run.cycles].reverse().find(c => c.arms.some(r => r.train?.curve));
  if (last) {
    const useTruth = truth && last.arms.some(r => r.train?.truthCurve), test = last.arms.find(r => r.train?.n)?.train.n;
    const series = arms.map(a => {
      const curve = last.arms.find(r => r.arm === a.id)?.train?.[useTruth ? 'truthCurve' : 'curve'];
      if (!curve) return {id: a.id, name: a.name, color: a.color, points: []};
      const end = curve.at(-1), cx = end.cost || Math.max(...curve.map(p => Math.abs(p.cost))) || 1, cy = end.value || Math.max(...curve.map(p => Math.abs(p.value))) || 1;
      return {id: a.id, name: a.name, color: a.color, points: curve.map(p => [p.cost / cx, p.value / cy])};
    });
    out += `<section><h2>Cost Curve</h2><p class="lead-in">사이클 ${last.cycle}에 학습한 모델을 학습에 쓰지 않은 test ${int(test)}행에 적용했어요. 점수가 높은 사람부터 처치 대상을 넓힐 때 쓴 증분 비용(가로)과 얻은 증분 성과(세로)예요. 점선은 무작위 순서이고, 왼쪽 위로 휠수록 같은 비용에서 성과가 커요(AUCC).</p>
      ${legend(arms, '<span><i class="dash"></i>무작위 순서</span>')}<figure>${svgOf({series, direct: false, diagonal: true, x: {domain: [0, 1], ticks: [0, .25, .5, .75, 1], format: v => `${Math.round(v * 100)}%`}, y: {domain: [0, 1], format: v => `${Math.round(v * 100)}%`, label: 'Cost Curve'}})}</figure></section>`;
  }
  return out;
}

// The app's typeface from Google Fonts. Offline, the system's Korean font (Apple SD Gothic Neo, Malgun Gothic) takes over.
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;color:#191f28;font:15px/1.6 "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:820px;margin:0 auto;padding:40px 24px 56px}
header{padding-bottom:18px;border-bottom:1px solid #e5e8eb}
.eyebrow{font-size:12.5px;font-weight:600;color:#1b64da}
h1{margin-top:4px;font-size:24px;line-height:1.35;letter-spacing:-.02em}
.meta{margin-top:4px;font-size:13px;color:#6b7684}
section{margin-top:30px;break-inside:avoid}
h2{font-size:17px;letter-spacing:-.01em}
.lead-in{margin-top:4px;font-size:13px;color:#4e5968}
.verdict{margin-top:22px;padding:18px 20px;border:1px solid #e5e8eb;border-radius:12px;break-inside:avoid}
.v-rank{display:inline-block;padding:1px 8px;border-radius:999px;background:#191f28;color:#fff;font-size:12px;font-weight:700}
.verdict h2{margin-top:6px;font-size:22px}
.v-line{margin-top:2px;font-size:16px;color:#333d4b}
.v-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:12px;border:1px solid #e5e8eb;border-radius:8px;overflow:hidden}
.v-kpis div{padding:9px 12px;box-shadow:-1px 0 0 #e5e8eb,0 -1px 0 #e5e8eb}
.v-kpis dt{font-size:12px;color:#4e5968}.v-kpis dd{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}.v-kpis div:first-child dd{color:#1b64da}
.v-kpis small{display:block;font-size:11.5px;color:#8b95a1}
.v-sub{margin-top:10px;font-size:13px;color:#4e5968}.v-hint{margin-top:6px;font-size:13px;color:#9a6700}
.scroll{margin-top:10px;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}
table.narrow{max-width:520px}
th{padding:7px 8px;border-bottom:1px solid #d1d6db;text-align:left;font-size:12px;font-weight:600;color:#4e5968;vertical-align:bottom}
td{padding:8px;border-bottom:1px solid #f2f4f6;vertical-align:top}
th small,td small{display:block;font-size:11.5px;font-weight:400;color:#8b95a1}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td b i,.legend i{display:inline-block;width:10px;height:3px;margin:0 6px 3px 0;border-radius:2px;vertical-align:middle}
tr.lead td{background:#f5f9ff}td.key{font-weight:700}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;font-size:12px;color:#4e5968}
.legend i.dash{height:0;border-top:2px dashed #b0b8c1;border-radius:0}
figure{margin-top:6px}
.c-grid{stroke:#eef0f3}.c-tick{fill:#8b95a1;font-size:11px}.c-base{stroke:#b0b8c1;stroke-dasharray:4 3}.c-diag{stroke:#b0b8c1;stroke-dasharray:4 4}
.c-note{fill:#4e5968;font-size:11px;paint-order:stroke;stroke:#fff;stroke-width:3px}.c-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.conds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin-top:10px;font-size:13.5px}
.conds dt{font-size:12px;color:#6b7684}.conds dd small{display:block;font-size:12px;color:#8b95a1}
ul{margin-top:8px;padding-left:18px;font-size:13.5px;color:#333d4b}li+li{margin-top:4px}
footer{margin-top:36px;padding-top:14px;border-top:1px solid #e5e8eb;font-size:12px;color:#8b95a1}
a{color:#1b64da}
@media(max-width:600px){main{padding:24px 16px 40px}.conds{grid-template-columns:minmax(0,1fr)}.v-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:12px}}
@page{size:A4;margin:14mm}
@media print{main{padding:0;max-width:none}.scroll{overflow:visible}section,.verdict,table,figure{break-inside:avoid}a{color:inherit;text-decoration:none}}`;

export function reportHtml(run) {
  const W = wordsFor(datasetOf(run)), V = verdictOf(run, W), p = run.plan || {}, c = run.config || {}, synthetic = hasTruth(run);
  const when = run.createdAt ? day(run.createdAt) : day(Date.now()), label = selectionLabel(p.mode ? p : c);
  const title = `${W.data} · ${label} 비교 결과`;
  const caveat = synthetic
    ? '합성 데이터로 돌린 결과예요. 실제 고객 반응은 다를 수 있으니, 집행 전에 작은 규모의 A/B 테스트로 확인하세요.'
    : '이미 진행한 실험 로그 안에서 사용자를 다시 고른 결과예요. 로그에 없는 사용자나 다른 시기에는 결과가 다를 수 있으니, 집행 전에 작은 규모의 A/B 테스트로 확인하세요.';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · upliftlab 보고서</title><style>${CSS}</style></head><body><main>
<header><p class="eyebrow">upliftlab 시뮬레이션 보고서</p><h1>${esc(title)}</h1><p class="meta">${when} · 알고리즘 ${armsOf(run).length}개 · ${int(p.cycles ?? c.cycles)}사이클 · 사이클당 후보 ${int(p.pool)}명</p></header>
${V ? verdictHtml(V) : '<p class="lead-in">순위를 계산할 사이클이 아직 없어요.</p>'}
${V ? `<section><h2>순위</h2>${ranking(run, W)}</section>` : ''}
${V ? profile(run) : ''}
${charts(run)}
<section><h2>실험 조건</h2>${conditions(run, W)}</section>
<section><h2>읽는 법</h2><ul>
<li><b>${esc(josa(W.incR, '은', '는'))}</b> Exploit 그룹 안에서도 처치군과 대조군을 무작위로 나눠, 두 군의 평균 차이에 인원을 곱해 구해요. 처치군 결과만 세면 처치하지 않아도 결과가 같았을 사람까지 들어가요.</li>
<li><b>참값과 관측</b> · 합성 데이터는 사용자마다 처치했을 때와 안 했을 때의 결과를 모두 알아서 실제 효과(참값)를 계산할 수 있어요. 관측은 운영 환경처럼 처치군과 대조군의 차이로 추정한 값이라 표본 오차가 있어요.</li>
<li><b>95% CI</b> · 처치군과 대조군을 각각 200번 다시 뽑아(부트스트랩) 구한 구간이에요. 1위와 차이의 구간이 0을 포함하면 확실한 차이로 보지 않아요.</li>
<li>${caveat}</li></ul></section>
<footer>upliftlab ${esc(CATALOG.engine)}로 만든 보고서예요. 원본 행 데이터는 들어 있지 않아요. 같은 화면은 <a href="${SITE}">${SITE.replace('https://', '')}</a>에서 결과 JSON을 열면 볼 수 있어요.</footer>
</main></body></html>`;
}

export function summaryText(run) {
  const W = wordsFor(datasetOf(run)), V = verdictOf(run, W), p = run.plan || {}, c = run.config || {};
  return [`[upliftlab] ${W.data} · ${selectionLabel(p.mode ? p : c)} · 알고리즘 ${armsOf(run).length}개 · ${p.cycles ?? c.cycles}사이클`, V ? V.plain : '순위를 계산할 사이클이 아직 없어요.'].join('\n');
}

export function downloadReport(run) {
  download(`upliftlab-보고서-${run.createdAt ? day(run.createdAt) : day(Date.now())}.html`, reportHtml(run), 'text/html');
}

// Prints from a hidden frame, so the app stays where it is and no pop-up is needed.
export function printReport(run) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = reportHtml(run);
  frame.onload = () => {
    const w = frame.contentWindow, done = () => frame.remove();
    w.addEventListener('afterprint', done); setTimeout(done, 120000);
    (w.document.fonts?.ready || Promise.resolve()).then(() => { w.focus(); w.print(); });
  };
  document.body.append(frame);
}

export async function copySummary(run) {
  const text = summaryText(run);
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back below */ }
  const area = document.createElement('textarea');
  area.value = text; area.style.cssText = 'position:fixed;opacity:0'; document.body.append(area); area.select();
  const ok = document.execCommand('copy'); area.remove();
  if (!ok) throw new Error('copy failed');
}
