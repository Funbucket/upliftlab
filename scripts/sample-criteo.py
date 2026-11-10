"""Criteo 업리프트 데이터(v2.1)를 내려받으면서 처치군과 대조군에서 약 10만 행씩 뽑아 web/data/criteo-uplift-sample.csv.gz를 만들어요.
Sampling depends on the treatment only, so treatment stays independent of the features: the sample is still a randomized
experiment, with propensity about 0.5 instead of 0.85."""
import csv, gzip, io, sys, time, urllib.request
import numpy as np
URL = 'https://huggingface.co/datasets/criteo/criteo-uplift/resolve/main/criteo-research-uplift-v2.1.csv.gz'
TREATED, CONTROL = 11_882_655, 2_096_937  # v2.1 counts (85% treated)
KEEP = 100_000
p = {1: KEEP / TREATED * 1.002, 0: KEEP / CONTROL * 1.002}
rng = np.random.default_rng(20261110)
out_path = sys.argv[1]
req = urllib.request.Request(URL, headers={'User-Agent': 'upliftlab-sample'})
t0, n, kept = time.time(), 0, {0: 0, 1: 0}
with urllib.request.urlopen(req, timeout=60) as r, gzip.open(out_path, 'wt', newline='', compresslevel=9) as out:
    print('length', r.headers.get('Content-Length'), flush=True)
    reader = csv.reader(io.TextIOWrapper(gzip.GzipFile(fileobj=r), encoding='utf-8'))
    header = next(reader); print(header, flush=True)
    idx = {k: header.index(k) for k in header}
    feats = [f'f{i}' for i in range(12)]
    w = csv.writer(out, lineterminator='\n')
    w.writerow(['user_id'] + feats + ['treatment', 'visit', 'conversion'])
    buf = rng.random(1 << 20); bi = 0
    for row in reader:
        n += 1
        t = int(row[idx['treatment']])
        if bi == len(buf): buf = rng.random(1 << 20); bi = 0
        u = buf[bi]; bi += 1
        if u < p[t]:
            kept[t] += 1
            w.writerow([f'u{n:08d}'] + [f'{float(row[idx[f]]):.3f}' for f in feats] + [t, row[idx['visit']], row[idx['conversion']]])
        if n % 1_000_000 == 0: print(n, kept, f'{time.time() - t0:.0f}s', flush=True)
print('done', n, kept, f'{time.time() - t0:.0f}s', flush=True)
