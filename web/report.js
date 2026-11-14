// The shareable report: one self-contained HTML file with the conclusion, the ranking, two charts, the conditions and how to
// read them. It holds aggregates only, never uploaded rows. The same page prints to PDF, and a three-line summary goes to chat.
import {esc, isNum, int, fix, pct, pp, share, duration, unitFor, download, josa, BRIEF, SELECTION, selectionLabel} from './lib.js?v=0.26.5';
import {wordsFor, dataset, algorithm} from './store.js?v=0.26.5';
import {CATALOG} from './catalog.js?v=0.26.5';
import {EN, LOCALE, lang, tr} from './i18n.js?v=0.26.5';
import {lineChart} from './charts.js?v=0.26.5';
import {FIELDS, BASIS_NOTE, baseOf, hasTruth, modeOf, isBudget, byVolume, sumOf, datasetOf, armsOf, exploitProfile, describeProfile, verdictOf, verdictHtml, headlineOf} from './summary.js?v=0.26.5';

const SITE = 'https://upliftlab.dev';
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
  const kind = synthetic ? tr('합성 데이터 · 사용자별 실제 효과를 알아요', 'Synthetic data · each user’s true effect is known') : d?.kind === 'public' ? tr('공개 실험 로그 · 기록된 처치와 결과를 다시 써요', 'Public experiment log · replays the recorded treatments and outcomes') : tr('업로드한 실험 로그 · 기록된 처치와 결과를 다시 써요', 'Uploaded experiment log · replays the recorded treatments and outcomes');
  const rows = [
    [tr('데이터셋', 'Dataset'), `${esc(W.data)}<small>${kind}${d?.stored?.profile?.rows ? ` · ${int(d.stored.profile.rows)}${tr('행', ' rows')}` : ''}</small>`],
    [tr('비교한 알고리즘', 'Algorithms'), armsOf(run).map(a => esc(a.name)).join(', ')],
    [tr('선정 방식', 'Selection rule'), `${esc(SELECTION[mode]?.name || mode)} · ${esc(selectionLabel(p.mode ? p : c))}<small>${esc(SELECTION[mode]?.rule || '')}</small>`],
    [tr('사이클', 'Cycles'), `${EN ? `${int(p.cycles ?? c.cycles)} cycles · ${int(p.pool)} candidates per cycle` : `${int(p.cycles ?? c.cycles)}사이클 · 사이클당 후보 ${int(p.pool)}명`} · Explore ${share(p.explore ?? c.explore)}<small>${tr('사이클 1은 학습된 모델이 없어 합산에서 빼요.', 'Cycle 1 has no trained model and is left out of the totals.')}</small>`],
    [tr('기본 모델', 'Base learner'), (p.baseLearner ?? c.baseLearner) === 'tree' ? 'Gradient Boosting' : 'Ridge'],
    ...(p.implementation ? [[tr('알고리즘 구현', 'Implementation'), p.implementation === 'econml' ? 'EconML (PyWhy)' : tr('scikit-learn 경량판<small>브라우저에는 EconML이 없어 같은 방법을 scikit-learn으로 구현한 파일을 썼어요.</small>', 'scikit-learn lite<small>The browser has no EconML, so the same methods ran as scikit-learn files.</small>')]] : []),
    [tr('시드', 'Seed'), esc(p.seed ?? c.seed)],
    [tr('실행', 'Run'), run.example ? tr('예시 결과 (사전 계산)', 'Example (precomputed)') : [run.createdAt ? new Date(run.createdAt).toLocaleString(LOCALE) : null, run.runtime ? (run.runtime === 'local' ? tr('로컬 Python', 'local Python') : tr('브라우저', 'browser')) : null, isNum(run.elapsed) ? duration(run.elapsed) : null].filter(Boolean).join(' · ') || '—'],
  ];
  return `<dl class="conds">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function ranking(run, W) {
  const truth = hasTruth(run), F = FIELDS[truth ? 'truth' : 'observed'], volume = byVolume(run), arms = armsOf(run);
  const rows = arms.map(a => ({a, s: sumOf(run, a.id)})).filter(r => r.s?.cycles).sort((x, y) => x.s.rank - y.s.rank);
  const base = rows.map(r => baseOf(r.s, F)).find(isNum), unit = unitFor(base ?? Math.max(0, ...rows.map(r => r.s[F.R]).filter(isNum)));
  const gap = volume ? v => `${v < 0 ? '−' : '+'}${int(Math.abs(v))}${W.unit}` : v => pp(v);
  const vs = s => { const v = s.vsLeader; if (s.rank === 1 || !v) return '—'; const ci = isNum(v.ci?.[0]) ? `<small>95% CI ${gap(v.ci[0])} ~ ${gap(v.ci[1])}</small>` : ''; return `${v.tied ? tr('유의차 없음', 'No clear gap') : gap(v.diff)}${ci}`; };
  const head = `<tr><th class="num">${tr('순위', 'Rank')}</th><th>${tr('알고리즘', 'Algorithm')}</th><th class="num">${esc(W.incR)}</th><th class="num">${tr('증분 비용', 'Incremental cost')}</th><th class="num">${tr('비용 효율', 'Cost effectiveness')}<small>${EN ? `per ${int(unit)} cost` : `비용 ${int(unit)}당`}</small></th><th class="num">${tr('효율 개선', 'Efficiency gain')}<small>${tr('Explore 대비', 'over Explore')}</small></th>${volume ? `<th class="num">${tr('Exploit 인원', 'Exploit users')}<small>${tr('사이클 평균', 'per cycle')}</small></th>` : ''}<th class="num">${tr('1위와 차이', 'Gap to #1')}<small>${tr('관측', 'observed')}</small></th></tr>`;
  const body = rows.map(({a, s}) => `<tr class="${s.rank === 1 ? 'lead' : ''}"><td class="num">${s.rank}</td><td><b><i style="background:${a.color}"></i>${esc(a.name)}</b><small>${esc(BRIEF[a.id] || algorithm(a.id)?.summary || '')}</small></td>
    <td class="num ${volume ? 'key' : ''}">${int(s[F.incR])}</td><td class="num">${int(s[F.incC])}</td><td class="num">${isNum(s[F.R]) ? fix(s[F.R] * unit, 1) : '—'}</td><td class="num ${volume ? '' : 'key'}">${pct(s[F.gain])}</td>${volume ? `<td class="num">${int(s.selected)}</td>` : ''}<td class="num">${vs(s)}</td></tr>`).join('');
  const by = esc(josa(W.incR, '으로', '로')), order = EN ? (isBudget(run) ? `Every algorithm spends the same budget, so the rank is ${esc(W.incR)}.` : volume ? `The number selected differs by algorithm, so the rank is ${esc(W.incR)}.` : 'Everyone selects as many users, so the rank is the efficiency gain.') : isBudget(run) ? `모든 알고리즘이 같은 예산을 써서 ${by} 순위를 매겨요.` : volume ? `선정 인원이 알고리즘마다 달라서 ${by} 순위를 매겨요.` : '선정 인원이 같아서 비용 효율 개선으로 순위를 매겨요.';
  return `<p class="lead-in">${order} ${EN ? `On ${F.name} values (${BASIS_NOTE[truth ? 'truth' : 'observed']}). The gap to #1 reads ‘No clear gap’ when its 95% CI, bootstrapped from observed values, includes 0.${isNum(base) ? ` Random selection (Explore) makes ${fix(base * unit, 1)} ${esc(W.incR)} per ${int(unit)} cost.` : ''}` : `${F.name} 기준(${BASIS_NOTE[truth ? 'truth' : 'observed']})이에요. 1위와 차이는 관측 값을 부트스트랩해 구한 95% CI가 0을 포함하면 ‘유의차 없음’이에요.${isNum(base) ? ` 무작위로 고르면(Explore) 비용 ${int(unit)}당 ${esc(W.incR)} ${fix(base * unit, 1)}${esc(W.unit)}이에요.` : ''}`}</p>
    <div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function profile(run) {
  const id = run.summary.leader, name = sumOf(run, id)?.name || id, items = exploitProfile(run, id);
  if (!items) return '';
  const shown = items.slice(0, 6);
  return `<section><h2>${tr('1위가 고른 사용자', 'Who the leader selected')}</h2><p class="lead-in">${EN ? `${esc(name)}’s Exploit group against all candidates. ${esc(describeProfile(items))} SMD is the standardized mean difference; above 0.2 in absolute value counts as a difference.` : `${esc(name)}의 Exploit 그룹을 후보 전체와 비교했어요. ${esc(describeProfile(items))} SMD는 표준화 평균 차이로, 절댓값이 0.2를 넘으면 차이가 있다고 봐요.`}</p>
    <div class="scroll"><table class="narrow"><thead><tr><th>${tr('공변량', 'Covariate')}</th><th class="num">${tr('후보 평균', 'Candidate mean')}</th><th class="num">${tr('Exploit 평균', 'Exploit mean')}</th><th class="num">SMD</th></tr></thead><tbody>${shown.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${fix(x.base, 2)}</td><td class="num"><b>${fix(x.mean, 2)}</b></td><td class="num">${x.d < 0 ? '−' : '+'}${fix(Math.abs(x.d), 2)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function charts(run) {
  const truth = hasTruth(run), F = FIELDS[truth ? 'truth' : 'observed'], arms = armsOf(run), total = run.plan?.cycles || run.config.cycles;
  let out = '';
  if (run.cycles.length > 1) {
    const series = arms.map(a => ({id: a.id, name: a.name, color: a.color, points: run.cycles.map(c => [c.cycle, c.arms.find(r => r.arm === a.id)?.[F.gain] ?? null])}));
    out += `<section><h2>${tr('사이클별 효율 개선', 'Efficiency gain by cycle')}</h2><p class="lead-in">${EN ? `How much higher Exploit’s cost effectiveness is than random selection (Explore) in each cycle, on ${F.name} values.` : `사이클마다 Exploit의 비용 효율이 무작위 선정(Explore)보다 몇 % 높은지예요. ${F.name} 기준이에요.`}</p>${legend(arms)}
      <figure>${svgOf({series, direct: false, x: {domain: [1, Math.max(2, total)], ticks: Array.from({length: total}, (_, i) => i + 1), format: v => String(v)}, y: {format: v => pct(v), label: tr('사이클별 효율 개선', 'Efficiency gain by cycle')}, baseline: {y: 0, label: tr('무작위 선정', 'Random selection')}})}</figure></section>`;
  }
  const pooled = (run.summary?.arms || []).filter(s => s.curve);
  if (pooled.length) {
    const useTruth = truth && pooled.some(s => s.truthCurve), rows = pooled[0].offlineN;
    const series = arms.map(a => {
      const curve = pooled.find(s => s.arm === a.id)?.[useTruth ? 'truthCurve' : 'curve'];
      if (!curve) return {id: a.id, name: a.name, color: a.color, points: []};
      const end = curve.at(-1), cx = end.cost || Math.max(...curve.map(p => Math.abs(p.cost))) || 1, cy = end.value || Math.max(...curve.map(p => Math.abs(p.value))) || 1;
      return {id: a.id, name: a.name, color: a.color, points: curve.map(p => [p.cost / cx, p.value / cy])};
    });
    out += `<section><h2>Cost Curve</h2><p class="lead-in">${EN ? `Each cycle’s served model applied to that cycle’s Explore group, pooled from cycle 2 (${int(rows)} rows): random groups the models never trained on. Incremental cost spent (across) and incremental outcome gained (up) as treatment widens from the highest scores. The dashed line is random order; the more the curve bows up and left, the more outcome for the same cost (AUCC).` : `사이클마다 배포한 모델을 그 사이클의 Explore 그룹에 적용해 사이클 2부터 합산했어요(${int(rows)}행). 모델이 학습에 쓰지 않은 무작위 그룹이에요. 점수가 높은 사람부터 처치 대상을 넓힐 때 쓴 증분 비용(가로)과 얻은 증분 성과(세로)예요. 점선은 무작위 순서이고, 왼쪽 위로 휠수록 같은 비용에서 성과가 커요(AUCC).`}</p>
      ${legend(arms, `<span><i class="dash"></i>${tr('무작위 순서', 'Random order')}</span>`)}<figure>${svgOf({series, direct: false, diagonal: true, x: {domain: [0, 1], ticks: [0, .25, .5, .75, 1], format: v => `${Math.round(v * 100)}%`}, y: {domain: [0, 1], format: v => `${Math.round(v * 100)}%`, label: 'Cost Curve'}})}</figure></section>`;
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
.v-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:12px}.v-body.is-single{grid-template-columns:minmax(0,1fr)}
.v-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-content:start;border:1px solid #e5e8eb;border-radius:8px;overflow:hidden}
.v-body:not(.is-single) .v-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.v-body:not(.is-single) .v-kpis div:last-child:nth-child(odd){grid-column:1/-1}
.v-bars{margin:0;padding:9px 12px 12px;border:1px solid #e5e8eb;border-radius:8px}.v-bars figcaption{font-size:12px;color:#4e5968}
.v-bars ol{list-style:none;display:grid;gap:6px;margin-top:8px;padding:0;font-size:12.5px;color:#333d4b}.v-bars li+li{margin-top:0}
.v-bars li{display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr) 64px;align-items:center;gap:8px;line-height:1.35}
.vb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vb-name small{display:inline;margin-left:4px;font-size:11px;color:#8b95a1}
.vb-track i{display:block;height:9px;min-width:2px;border-radius:0 4px 4px 0;background:#b4d2fb}.vb-val{text-align:right;font-variant-numeric:tabular-nums}
.is-lead .vb-name,.is-lead .vb-val{font-weight:700}.is-lead .vb-val{color:#1b64da}.is-lead .vb-track i{background:#3182f6}.is-base .vb-track i{background:#b0b8c1}
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
@media(max-width:600px){main{padding:24px 16px 40px}.conds,.v-body{grid-template-columns:minmax(0,1fr)}.v-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:12px}}
@page{size:A4;margin:14mm}
@media print{main{padding:0;max-width:none}.scroll{overflow:visible}section,.verdict,table,figure{break-inside:avoid}a{color:inherit;text-decoration:none}}`;

export function reportHtml(run) {
  const W = wordsFor(datasetOf(run)), V = verdictOf(run, W), p = run.plan || {}, c = run.config || {}, synthetic = hasTruth(run);
  const when = run.createdAt ? day(run.createdAt) : day(Date.now()), label = selectionLabel(p.mode ? p : c);
  const title = EN ? `${W.data} · ${label} comparison` : `${W.data} · ${label} 비교 결과`;
  const caveat = synthetic
    ? tr('합성 데이터로 돌린 결과예요. 실제 고객 반응은 다를 수 있으니, 집행 전에 작은 규모의 A/B 테스트로 확인하세요.', 'This ran on synthetic data. Real customers may respond differently; confirm with a small A/B test before rolling out.')
    : tr('이미 진행한 실험 로그 안에서 사용자를 다시 고른 결과예요. 로그에 없는 사용자나 다른 시기에는 결과가 다를 수 있으니, 집행 전에 작은 규모의 A/B 테스트로 확인하세요.', 'This re-selected users within an experiment you already ran. Users outside the log, or another period, may differ; confirm with a small A/B test before rolling out.');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · upliftlab ${tr('보고서', 'report')}</title><style>${CSS}</style></head><body><main>
<header><p class="eyebrow">${tr('upliftlab 시뮬레이션 보고서', 'upliftlab simulation report')}</p><h1>${esc(title)}</h1><p class="meta">${when} · ${EN ? `${armsOf(run).length} algorithms · ${int(p.cycles ?? c.cycles)} cycles · ${int(p.pool)} candidates per cycle` : `알고리즘 ${armsOf(run).length}개 · ${int(p.cycles ?? c.cycles)}사이클 · 사이클당 후보 ${int(p.pool)}명`}</p></header>
${V ? verdictHtml(V) : `<p class="lead-in">${tr('순위를 계산할 사이클이 아직 없어요.', 'No cycle to rank yet.')}</p>`}
${V ? `<section><h2>${tr('순위', 'Ranking')}</h2>${ranking(run, W)}</section>` : ''}
${V ? profile(run) : ''}
${charts(run)}
<section><h2>${tr('실험 조건', 'Conditions')}</h2>${conditions(run, W)}</section>
<section><h2>${tr('읽는 법', 'How to read it')}</h2><ul>
${EN ? `<li><b>${esc(W.incR)}</b> · the Exploit group is split at random into treatment and control too, and the difference of their means times the group size gives the total. Counting treated outcomes alone would include people who would have done the same without treatment.</li>
<li><b>Truth and observed</b> · synthetic data knows each user’s outcome with and without treatment, so the true effect can be computed. Observed is estimated as treatment minus control, as in production, and has sampling error.</li>
<li><b>95% CI</b> · an interval from 200 bootstrap redraws of treatment and control separately. When the gap to #1 includes 0, the difference is not counted as clear.</li>` : `<li><b>${esc(josa(W.incR, '은', '는'))}</b> Exploit 그룹 안에서도 처치군과 대조군을 무작위로 나눠, 두 군의 평균 차이에 인원을 곱해 구해요. 처치군 결과만 세면 처치하지 않아도 결과가 같았을 사람까지 들어가요.</li>
<li><b>참값과 관측</b> · 합성 데이터는 사용자마다 처치했을 때와 안 했을 때의 결과를 모두 알아서 실제 효과(참값)를 계산할 수 있어요. 관측은 운영 환경처럼 처치군과 대조군의 차이로 추정한 값이라 표본 오차가 있어요.</li>
<li><b>95% CI</b> · 처치군과 대조군을 각각 200번 다시 뽑아(부트스트랩) 구한 구간이에요. 1위와 차이의 구간이 0을 포함하면 확실한 차이로 보지 않아요.</li>`}
<li>${caveat}</li></ul></section>
<footer>${EN ? `Made with upliftlab ${esc(CATALOG.engine)}. No row-level data is inside. Open the result JSON at <a href="${SITE}">${SITE.replace('https://', '')}</a> to see the same screen.` : `upliftlab ${esc(CATALOG.engine)}로 만든 보고서예요. 원본 행 데이터는 들어 있지 않아요. 같은 화면은 <a href="${SITE}">${SITE.replace('https://', '')}</a>에서 결과 JSON을 열면 볼 수 있어요.`}</footer>
</main></body></html>`;
}

export function summaryText(run) {
  const W = wordsFor(datasetOf(run)), V = verdictOf(run, W), p = run.plan || {}, c = run.config || {};
  return [`[upliftlab] ${W.data} · ${selectionLabel(p.mode ? p : c)} · ${EN ? `${armsOf(run).length} algorithms · ${p.cycles ?? c.cycles} cycles` : `알고리즘 ${armsOf(run).length}개 · ${p.cycles ?? c.cycles}사이클`}`, V ? V.plain : tr('순위를 계산할 사이클이 아직 없어요.', 'No cycle to rank yet.')].join('\n');
}

export function downloadReport(run) {
  download(`upliftlab-${tr('보고서', 'report')}-${run.createdAt ? day(run.createdAt) : day(Date.now())}.html`, reportHtml(run), 'text/html');
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

// A 1200×630 result card (PNG) for LinkedIn, Slack or a slide: the headline, the lift over Random and the standings, drawn
// on a canvas with the page's own fonts. Like the report it holds aggregates only.
export async function downloadCard(run) {
  const W = wordsFor(datasetOf(run)), V = verdictOf(run, W);
  if (!V) return;
  const p = run.plan || {}, c = run.config || {}, H = headlineOf(V), L = V.lift, rows = (V.bars?.rows || []).slice(0, 6);
  const meta = `${W.data} · ${selectionLabel(p.mode ? p : c)} · ${EN ? `${armsOf(run).length} algorithms · ${p.cycles ?? c.cycles} cycles` : `알고리즘 ${armsOf(run).length}개 · ${p.cycles ?? c.cycles}사이클`}`;
  const lead = L ? (EN ? `${V.name} made ${int(Math.abs(L.more))} ${L.more >= 0 ? 'more' : 'fewer'} ${W.incR} than Random.` : `${josa(V.name, '은', '는')} Random보다 ${josa(W.incR, '이', '가')} ${int(L.more)}${W.unit} ${L.more >= 0 ? '많아요' : '적어요'}.`) : (V.kpis[0]?.note || '').replace(/<[^>]+>/g, '');
  const big = L ? `${L.ratio < 0 ? '−' : '+'}${Math.round(Math.abs(L.ratio) * 100)}%` : V.kpis[0]?.value || '';
  const label = L ? (EN ? `${W.incR.toUpperCase()} VS RANDOM` : `RANDOM 대비 ${W.incR}`) : (V.kpis[0]?.label || '').replace(/<[^>]+>/g, '');
  const foot = !V.gaps.length ? '' : EN ? (H.close ? `Ranks 1–${H.ties + 1} are within the 95% CI.${H.baseFirm ? ' The gap to Random is significant.' : ''}` : 'The gap to #2 is outside the 95% CI too.') : H.close ? `1~${H.ties + 1}위 차이는 95% CI 안이에요.${H.baseFirm ? ' Random과의 차이는 유의해요.' : ''}` : '2위와의 차이도 95% CI 밖이에요.';
  const C = {bg: '#06070a', card: '#0b0d11', line: '#232830', ink: '#f3f5f8', ink2: '#d5dae1', sub: '#9aa3af', mute: '#6b7480', blue: '#4d8dff', blueStrong: '#9cc0ff', amber: '#f4b642', base: '#7d8794', bar: '#3d4550', rest: '#1d2229'};
  const sans = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', num = '"Archivo Variable", "Pretendard Variable", sans-serif';
  const text = [meta, H.h, H.em, lead, label, foot, ...rows.flatMap(r => [r.name, r.value]), '사진 판정 확정 upliftlab upliftlab.dev 같은 예산을 주고, 모델끼리 겨뤄요.'].join(' ');
  await Promise.all([800, 600, 500].map(w => document.fonts.load(`${w} 40px ${sans}`, text)).concat(document.fonts.load(`900 100px ${num}`, `${big}0123456789,`))).catch(() => {});
  const S = 2, WD = 1200, HT = 630, PAD = 64, canvas = document.createElement('canvas');
  canvas.width = WD * S; canvas.height = HT * S;
  const g = canvas.getContext('2d');
  g.scale(S, S); g.textBaseline = 'alphabetic';
  const font = (w, px, family = sans, stretch = 'normal') => { g.font = `${w} ${px}px ${family}`; if ('fontStretch' in g) g.fontStretch = stretch; };
  const fit = (str, max) => { if (g.measureText(str).width <= max) return str; let t = str; while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1); return `${t}…`; };
  const round = (x, y, w, h, r, fill) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fillStyle = fill; g.fill(); };
  const say = (str, x, y, color, align = 'left') => { g.fillStyle = color; g.textAlign = align; g.fillText(str, x, y); };
  g.fillStyle = C.bg; g.fillRect(0, 0, WD, HT);
  // brand and run
  round(PAD, 52, 32, 32, 8, '#3182f6');
  g.save(); g.translate(PAD, 52); g.scale(32 / 48, 32 / 48); g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 3.6;
  g.beginPath(); g.moveTo(12, 36); g.bezierCurveTo(14.5, 20, 22.5, 13.6, 36, 12); g.stroke(); g.beginPath(); g.arc(36, 12, 3.2, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
  font(800, 24); say('upliftlab', PAD + 44, 77, C.ink);
  font(500, 15); say(fit(meta, 640), WD - PAD, 74, C.sub, 'right');
  // headline
  font(800, 52); say(fit(H.h, WD - PAD * 2), PAD, 172, C.ink);
  say(fit(H.em, WD - PAD * 2), PAD, 236, C.blueStrong);
  // the lift over Random, left
  const top = 300;
  font(600, 14); g.letterSpacing = '2px'; say(fit(label, 460), PAD, top, C.mute); g.letterSpacing = '0px';
  font(900, 132, num, 'extra-condensed'); say(big, PAD - 4, top + 134, C.blue);
  font(500, 19);
  const lines = [], words = lead.split(' ');  // up to two lines; English runs longer than Korean
  for (const w of words) { const last = lines.at(-1); if (last && g.measureText(`${last} ${w}`).width <= 500) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w); }
  lines.slice(0, 2).forEach((line, i) => say(i === 1 && lines.length > 2 ? fit(`${line} ${lines.slice(2).join(' ')}`, 500) : line, PAD, top + 176 + i * 27, C.ink2));
  // standings, right
  const X = 640, RW = WD - PAD - X, RH = 40, max = Math.max(...rows.map(r => r.width), 1);
  rows.forEach((r, i) => {
    const y = top - 12 + i * RH;
    font(r.lead ? 700 : 500, 16); say(fit(`${r.base ? 'BASE' : `P${i + 1}`}  ${r.name}`, RW - 110), X, y + 14, r.lead ? C.ink : C.ink2);
    font(800, 19, num); say(r.value, WD - PAD, y + 15, r.lead ? C.ink : C.sub, 'right');
    round(X, y + 23, RW, 5, 2.5, C.rest);
    if (r.width > 0) round(X, y + 23, Math.max(5, RW * r.width / max), 5, 2.5, r.lead ? C.blue : r.base ? C.base : C.bar);
  });
  // verdict and address
  g.fillStyle = C.line; g.fillRect(PAD, HT - 92, WD - PAD * 2, 1);
  let fx = PAD;
  if (V.gaps.length) {
    font(800, 14); const flag = H.close ? tr('사진 판정', 'Photo finish') : tr('확정', 'Decided'), fw = g.measureText(flag).width + 22;
    round(fx, HT - 66, fw, 28, 6, H.close ? C.amber : C.blue); say(flag, fx + 11, HT - 47, H.close ? '#1a1306' : '#fff'); fx += fw + 14;
  }
  font(500, 16); say(fit(foot, 640), fx, HT - 47, H.close ? '#f7cf82' : C.ink2);
  font(600, 16); say('upliftlab.dev', WD - PAD, HT - 47, C.mute, 'right');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `upliftlab-${tr('결과', 'result')}-${run.createdAt ? day(run.createdAt) : day(Date.now())}.png`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return canvas;
}
