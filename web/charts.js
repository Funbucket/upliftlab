// SVG line charts with one y-axis, a recessive grid, 2px lines and a crosshair tooltip that lists every series.
import {esc, isNum, int, pp} from './lib.js?v=0.26.2';

const M = {top: 14, right: 16, bottom: 30, left: 48};

function ticks(lo, hi, count = 5) {
  const span = hi - lo || 1, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// series: [{id, name, color, points: [[x, y], …]}]; hover.xs are the x positions the crosshair snaps to.
export function lineChart(el, {series, x, y, hover, baseline, diagonal = false, focus = null, height = 260, direct = series.length <= 4, width: fixed = 0}) {
  el.classList.add('chart');
  const width = Math.max(280, fixed || el.clientWidth || 600), right = direct ? 128 : M.right;
  const W = width - M.left - right, H = height - M.top - M.bottom;
  const values = series.flatMap(s => s.points.map(p => p[1])).filter(isNum);
  let [lo, hi] = y.domain || [Math.min(0, ...values), Math.max(0, ...values)];
  if (lo === hi) hi = lo + 1;
  const yt = ticks(lo, hi, 4);
  lo = Math.min(lo, yt[0]); hi = Math.max(hi, yt.at(-1));
  const X = v => M.left + (v - x.domain[0]) / (x.domain[1] - x.domain[0]) * W, Y = v => M.top + (1 - (v - lo) / (hi - lo)) * H;
  const path = pts => pts.filter(p => isNum(p[1])).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const grid = yt.map(v => `<line x1="${M.left}" x2="${M.left + W}" y1="${Y(v)}" y2="${Y(v)}" class="c-grid"/><text x="${M.left - 8}" y="${Y(v) + 4}" class="c-tick" text-anchor="end">${esc(y.format(v))}</text>`).join('');
  const xt = x.ticks.map(v => `<text x="${X(v)}" y="${M.top + H + 20}" class="c-tick" text-anchor="middle">${esc(x.format(v))}</text>`).join('');
  const base = baseline && lo <= baseline.y && baseline.y <= hi ? `<line x1="${M.left}" x2="${M.left + W}" y1="${Y(baseline.y)}" y2="${Y(baseline.y)}" class="c-base"/>` : '';
  const note = base ? `<text x="${M.left + W}" y="${Y(baseline.y) + (Y(baseline.y) + 15 > M.top + H ? -6 : 15)}" class="c-note" text-anchor="end">${esc(baseline.label)}</text>` : '';  // drawn over the lines, which may pass through it
  const diag = diagonal ? `<line x1="${X(x.domain[0])}" y1="${Y(0)}" x2="${X(x.domain[1])}" y2="${Y(1)}" class="c-diag"/>` : '';
  const order = [...series].sort((a, b) => (a.id === focus) - (b.id === focus));  // the focused line is drawn last
  const lines = order.map(s => `<path d="${path(s.points)}" class="c-line${focus && s.id !== focus ? ' is-dim' : ''}" stroke="${s.color}" data-id="${esc(s.id)}"/>`).join('');
  let labels = '';
  if (direct) {
    const ends = series.map(s => { const p = s.points.filter(q => isNum(q[1])).at(-1); return p && {s, y: Y(p[1]), x: X(p[0])}; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
    labels = ends.map(e => `<g class="c-label${focus && e.s.id !== focus ? ' is-dim' : ''}"><line x1="${M.left + W + 8}" x2="${M.left + W + 20}" y1="${e.y}" y2="${e.y}" stroke="${e.s.color}" stroke-width="2"/><text x="${M.left + W + 25}" y="${e.y + 4}">${esc(e.s.name.length > 15 ? e.s.name.slice(0, 14) + '…' : e.s.name)}</text></g>`).join('');
  }
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(y.label || '')}" tabindex="0">${grid}${xt}${base}${diag}${lines}${note}${labels}<g class="c-cross" hidden><line class="c-hair" y1="${M.top}" y2="${M.top + H}"/><g class="c-dots"></g></g><rect x="${M.left}" y="${M.top}" width="${W}" height="${H}" fill="transparent" class="c-hit"/></svg><div class="c-tip" hidden></div>`;
  const svg = el.firstChild, tip = el.lastChild, cross = svg.querySelector('.c-cross'), hair = svg.querySelector('.c-hair'), dots = svg.querySelector('.c-dots');
  let at = -1;
  const show = i => {
    at = i; const xv = hover.xs[i], px = X(xv);
    cross.hidden = false; hair.setAttribute('x1', px); hair.setAttribute('x2', px);
    const rows = series.map(s => ({s, v: hover.value(s, xv)})).filter(r => isNum(r.v)).sort((a, b) => b.v - a.v);
    dots.innerHTML = rows.map(r => `<circle cx="${px}" cy="${Y(r.v)}" r="4" fill="${r.s.color}" class="c-dot"/>`).join('');
    tip.replaceChildren();
    const title = document.createElement('b'); title.textContent = hover.title(xv); tip.append(title);
    for (const r of rows) {
      const row = document.createElement('span'), key = document.createElement('i'), value = document.createElement('strong'), name = document.createElement('em');
      key.style.background = r.s.color; value.textContent = y.format(r.v); name.textContent = r.s.name;
      row.append(key, value, name); tip.append(row);
    }
    tip.hidden = false;
    const box = el.getBoundingClientRect(), scale = box.width / width, left = px * scale;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, left + 14 > box.width - tip.offsetWidth ? left - tip.offsetWidth - 14 : left + 14))}px`;
    tip.style.top = `${M.top * scale}px`;
  };
  const hide = () => { at = -1; cross.hidden = true; tip.hidden = true; };
  const nearest = px => { let best = 0; hover.xs.forEach((v, i) => { if (Math.abs(X(v) - px) < Math.abs(X(hover.xs[best]) - px)) best = i; }); return best; };
  svg.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(); show(nearest((e.clientX - r.left) * width / r.width)); });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); show(Math.max(0, Math.min(hover.xs.length - 1, (at < 0 ? hover.xs.length - 1 : at) + (e.key === 'ArrowRight' ? 1 : -1))));
  });
}

// Linear interpolation of y at x along a polyline sorted by x.
export function interpolate(points, x) {
  const pts = points.filter(p => isNum(p[1]));
  if (!pts.length) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts.at(-1)[1];
}

// Re-render on width changes only, so hovering never fights a layout loop.
export function responsive(el, draw) {
  let width = 0;
  const observer = new ResizeObserver(() => { const w = el.clientWidth; if (Math.abs(w - width) > 1) { width = w; draw(); } });
  observer.observe(el);
  return () => observer.disconnect();
}

// A horizontal interval with the point estimate, on a shared scale for one table column.
export function interval(value, ci, [lo, hi]) {
  if (!isNum(ci?.[0]) || !isNum(value)) return '';
  const P = v => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 100).toFixed(1);
  const tone = ci[0] > 0 ? 'pos' : ci[1] < 0 ? 'neg' : 'flat';
  return `<span class="ci ${tone}" aria-hidden="true"><i class="ci-zero" style="left:${P(0)}%"></i><i class="ci-range" style="left:${P(ci[0])}%;width:${P(ci[1]) - P(ci[0])}%"></i><i class="ci-point" style="left:${P(value)}%"></i></span>`;
}

// The gap to the leader with its 95% CI, one row per algorithm (data-gaps from verdictPanel). It is drawn at the element's real
// width, so the labels keep their size on a phone. Rows whose interval holds 0 are grey (no sure gap); the others take the accent.
export function forestPlot(svg) {
  const rows = JSON.parse(svg.dataset.gaps || '[]');
  if (!rows.length) return;
  const W = Math.round(Math.max(280, svg.clientWidth || svg.parentNode.clientWidth)), narrow = W < 520;
  const L = narrow ? 96 : 132, R = 18, top = 30, rh = narrow ? 42 : 46, H = top + rh * rows.length + 28;
  let lo = Math.min(0, ...rows.map(r => r.lo)), hi = Math.max(0, ...rows.map(r => r.hi));
  const pad = (hi - lo) * .05 || 1; lo -= pad; hi += pad;
  const X = v => L + (v - lo) / (hi - lo) * (W - L - R), fmt = v => (svg.dataset.unit === 'pp' ? pp(v) : `${v > 0 ? '+' : v < 0 ? '−' : ''}${int(Math.abs(v))}`);
  let out = ticks(lo, hi, narrow ? 3 : 5).filter(t => t !== 0 && t > lo && t < hi).map(t => `<line class="fp-grid" x1="${X(t)}" x2="${X(t)}" y1="${top - 8}" y2="${top + rh * rows.length}"/><text class="fp-tick" x="${X(t)}" y="${top + rh * rows.length + 20}" text-anchor="middle">${esc(fmt(t))}</text>`).join('');
  out += `<line class="fp-zero" x1="${X(0)}" x2="${X(0)}" y1="${top - 8}" y2="${top + rh * rows.length}"/><text class="fp-tick" x="${X(0)}" y="${top + rh * rows.length + 20}" text-anchor="middle">0</text><text class="fp-lead" x="${X(0)}" y="${top - 14}" text-anchor="${X(0) > W - 60 ? 'end' : 'middle'}">1위 기준</text>`;
  out += rows.map((r, i) => {
    const y = top + rh * i + rh / 2, k = r.tied ? '' : ' is-firm', name = r.name.length > (narrow ? 11 : 17) ? r.name.slice(0, narrow ? 10 : 16) + '…' : r.name;
    return `<g class="fp-row${k}"><text class="fp-name" x="0" y="${y + 5}">${esc(name)}</text><line class="fp-ci" x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}"/>
      <line class="fp-cap" x1="${X(r.lo)}" x2="${X(r.lo)}" y1="${y - 7}" y2="${y + 7}"/><line class="fp-cap" x1="${X(r.hi)}" x2="${X(r.hi)}" y1="${y - 7}" y2="${y + 7}"/>
      <circle class="fp-dot" cx="${X(r.diff)}" cy="${y}" r="6"/><text class="fp-val" x="${X(r.diff)}" y="${y - 13}" text-anchor="middle">${esc(fmt(r.diff))}</text></g>`;
  }).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out;
}
