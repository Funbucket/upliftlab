"""Draw the README's result chart from the bundled example run.

Reads EXAMPLE from web/catalog.js (written by build-catalog.py) and writes
docs/images/result-light.svg and result-dark.svg: one bar per algorithm, the
leader in blue, Random marked as the baseline. Run it after build-catalog.py.

    python3 -I scripts/readme-chart.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
text = (ROOT / 'web/catalog.js').read_text(encoding='utf-8')
line = next(l for l in text.splitlines() if l.startswith('export const EXAMPLE = '))
example = json.loads(line[len('export const EXAMPLE = '):].rstrip(';'))
arms = sorted(example['summary']['arms'], key=lambda a: a['rank'])
leader, base = arms[0], next(a for a in arms if a['arm'] == 'random_baseline')
lift = (leader['incR'] - base['incR']) / base['incR']

THEMES = {
    'light': {'ink': '#191f28', 'sub': '#4e5968', 'mute': '#8b95a1', 'axis': '#d1d6db', 'lead': '#3182f6', 'bar': '#c4cbd3', 'base': '#e1e5e9'},
    'dark': {'ink': '#f0f3f6', 'sub': '#b7bdc8', 'mute': '#8b949e', 'axis': '#30363d', 'lead': '#4493f8', 'bar': '#4a5361', 'base': '#353c47'},
}
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif"
W, PITCH, BAR, TOP, LX, X0, RIGHT = 880, 38, 16, 10, 152, 168, 190
H = TOP * 2 + PITCH * len(arms)
scale = (W - X0 - RIGHT) / max(a['incR'] for a in arms)


def bar(x, y, w, h, r=4):  # square at the baseline, rounded at the data end
    r = min(r, w / 2, h / 2)
    return f'M{x} {y}h{w - r:.1f}a{r} {r} 0 0 1 {r} {r}v{h - 2 * r}a{r} {r} 0 0 1 {-r} {r}h{-(w - r):.1f}z'


def svg(c):
    rows = []
    for i, a in enumerate(arms):
        cy = TOP + PITCH * i + PITCH / 2
        w = a['incR'] * scale
        is_lead, is_base = a is leader, a is base
        fill = c['lead'] if is_lead else c['base'] if is_base else c['bar']
        weight = 700 if is_lead else 500
        note = (f'<tspan dx="10" fill="{c["mute"]}" font-weight="500">Random 대비 +{lift:.0%}</tspan>' if is_lead
                else f'<tspan dx="10" fill="{c["mute"]}" font-weight="500">기준선</tspan>' if is_base else '')
        rows.append(
            f'  <text x="{LX}" y="{cy + 5:.1f}" text-anchor="end" fill="{c["ink"] if is_lead else c["sub"]}" font-weight="{weight}">{a["name"]}</text>\n'
            f'  <path d="{bar(X0, cy - BAR / 2, w, BAR)}" fill="{fill}"/>\n'
            f'  <text x="{X0 + w + 10:.1f}" y="{cy + 5:.1f}" fill="{c["ink"]}" font-weight="{weight}">{a["incR"]:,.0f}{note}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}" font-size="14" '
            f'style="font-variant-numeric:tabular-nums" role="img" aria-label="Criteo 예시에서 알고리즘별 증분 방문. '
            f'{leader["name"]} {leader["incR"]:,.0f}, Random {base["incR"]:,.0f}">\n'
            f'  <line x1="{X0}" y1="{TOP}" x2="{X0}" y2="{H - TOP}" stroke="{c["axis"]}"/>\n' + '\n'.join(rows) + '\n</svg>\n')


for name, colors in THEMES.items():
    (ROOT / f'docs/images/result-{name}.svg').write_text(svg(colors), encoding='utf-8')
print(f'Wrote docs/images/result-{{light,dark}}.svg · {leader["name"]} {leader["incR"]:,.0f} vs Random {base["incR"]:,.0f} (+{lift:.0%})')
