"""Does the model that tops an offline metric (Qini, AUCC) also top the production loop?

Runs the six built-ins on the synthetic coupon market (true effects known; coupon cost differs by user) with a budget and
with a top-q% rule, ten seeds each, and on the Criteo sample (every treatment costs 1) with six seeds. For each run it
compares the offline pick with the loop winner and records how much the offline pick loses in the loop. Results are in
docs/offline-vs-loop.md. Usage: python scripts/offline-vs-loop.py [out.json]   (about two minutes with EconML)
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from upliftlab import bridge  # noqa: E402

ids = ['random_baseline', 'x_learner', 't_learner', 'r_learner', 'dml', 'duality_r_learner']
B = {a['id']: a for a in bridge.builtins()}
algos = [{'id': i, 'name': B[i]['name'], 'code': B[i]['code']} for i in ids]
bridge.state.update(runtime='local')
bridge.fetch_dataset('public/criteo')

def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])

rows = []
plan = [('synthetic/base', 'budget', s) for s in range(1, 11)] + [('synthetic/base', 'quantile', s) for s in range(1, 11)] + [('public/criteo', 'budget', s) for s in range(1, 7)]
t0 = time.time()
for data, mode, seed in plan:
    r = bridge.run_all(data, algos, 8, .2, .4, seed, mode=mode, budget=.4)
    S = [a for a in r['summary']['arms'] if a['arm'] != 'random_baseline' and a['cycles']]
    truth = r['summary']['by'].startswith('truth')
    loop_key = r['summary']['by']
    off = {'qini': 'qiniTruth' if truth else 'qini', 'aucc': 'auccTruth' if truth else 'aucc'}
    loop = {a['name']: a[loop_key] for a in S}
    best_loop = max(S, key=lambda a: a[loop_key])
    out = {'data': data, 'mode': mode, 'seed': seed, 'loop_best': best_loop['name'], 'impl': r['plan']['implementation']}
    for m, k in off.items():
        best = max(S, key=lambda a: a[k] if a[k] is not None else -9)
        out[f'{m}_best'] = best['name']
        out[f'{m}_match'] = best['name'] == best_loop['name']
        out[f'{m}_rho'] = spearman([a[k] for a in S], [a[loop_key] for a in S])
        # how much the offline pick loses in the loop, relative to the loop leader
        out[f'{m}_loss'] = (best[loop_key] - best_loop[loop_key]) / abs(best_loop[loop_key]) if best_loop[loop_key] else None
        # observed: is that loss outside the 95% CI (a real loss, not noise)?
        g = best.get('vsLeader')
        out[f'{m}_sig'] = None if g is None else (not g['tied'])
    rows.append(out)
    print(f"{time.time() - t0:5.0f}s {data:15} {mode:8} seed {seed:2} loop {out['loop_best']:18} qini {out['qini_best']:18} ({out['qini_loss']:+.1%}) aucc {out['aucc_best']:18} ({out['aucc_loss']:+.1%})", flush=True)

if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
print('\nsummary')
for key in sorted({(r['data'], r['mode']) for r in rows}):
    R = [r for r in rows if (r['data'], r['mode']) == key]
    for m in ('qini', 'aucc'):
        miss = [r for r in R if not r[f'{m}_match']]
        sig = [r for r in miss if r[f'{m}_sig']]
        print(f"{key[0]:15} {key[1]:8} {m:4}: offline best = loop best in {len(R) - len(miss)}/{len(R)} seeds · mean loss when wrong {np.mean([r[f'{m}_loss'] for r in miss]) if miss else 0:+.1%} · significant {len(sig)}/{len(miss)} · rank corr {np.mean([r[f'{m}_rho'] for r in R]):+.2f}")
