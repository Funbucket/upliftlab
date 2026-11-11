"""Datasets: one synthetic experiment with known effects, public experiments, and uploaded CSV files.

Criteo ships as a 200k-row sample (web/data, CC BY-NC-SA 4.0) so the web and the local edition start from the same real
experiment.
"""
import csv
import gzip
import hashlib
import io
import re
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from .scenario import SyntheticScenario

SYNTHETIC = [
    {'id': 'synthetic/base', 'preset': 'base', 'name': '합성 쿠폰 실험',
     'summary': '공변량 4개로 만든 단순한 쿠폰 실험이에요. 사용자마다 실제 효과를 알아서 참값과 비교할 수 있고, 쿠폰 비용이 사용자마다 달라요.'},
]
SYNTHETIC_FIELDS = {'outcome': '리텐션 (0/1)', 'treatment': '쿠폰 지급 = 1, 미지급 = 0', 'cost': '쿠폰 사용액'}

CRITEO = {
    'id': 'public/criteo', 'name': 'Criteo 광고 실험', 'rows': 199837, 'bundled': 'data/criteo-uplift-sample.csv.gz',
    'summary': 'Criteo가 공개한 1,398만 명 규모의 광고 무작위 실험에서 처치군과 대조군을 10만 명씩 뽑은 표본이에요. 광고 후 사이트 방문이 결과예요.',
    'source': 'https://ailab.criteo.com/criteo-uplift-prediction-dataset/',
    'download': 'https://huggingface.co/datasets/criteo/criteo-uplift',
    'license': 'CC BY-NC-SA 4.0 · 비상업적으로만 쓰고 출처를 밝혀요. 표본은 upliftlab과 함께 배포해요.',
    'treatment': '광고 대상 = 1, 대조군 = 0', 'outcome': 'visit · 사이트 방문 (0/1)', 'cost': '열 없음 · 처치 1건당 1',
    'mapping': {'treatment': 'treatment', 'outcome': 'visit', 'cost': None, 'features': [f'f{i}' for i in range(12)]},
}

PUBLIC = [CRITEO]

TREATMENT_NAMES = {'t', 'treatment', 'treated', 'treat', 'w', 'group', 'coupon', 'voucher', 'promo', 'promotion', 'reward', 'offer', 'campaign', 'email', 'exposed', 'sent', 'dose', 'arm', 'variant'}
OUTCOME_NAMES = {'y', 'outcome', 'conversion', 'converted', 'convert', 'retained', 'retention', 'yr', 'visit', 'visited', 'return', 'returned', 'response', 'purchase', 'purchased', 'bought', 'order', 'ordered', 'click', 'clicked', 'revenue', 'target', 'label'}
COST_NAMES = {'cost', 'yc', 'spend', 'spent', 'expense'}
ID_NAMES = {'id', 'user_id', 'userid', 'customer_id', 'index', 'row', 'uid'}
MIN_ROWS = 1000
MAX_LEVELS = 20  # a text column with more distinct values than this cannot become a feature
MAX_TREATMENTS = 8
BLANKS = {'', 'na', 'n/a', 'nan', 'null', 'none'}


def catalog():
    """The datasets the app lists: the public experiments. The synthetic experiment is not listed; it stays in the engine for the
    quick check of an algorithm, the example upload file, the tests and `upliftlab run --data synthetic/base`."""
    return [{**d, 'kind': 'public', 'truth': False} for d in PUBLIC]


def synthetic_preset(dataset_id):
    """The scenario preset of a synthetic id. 'synthetic/tiers' works too (tests, CLI) though the app lists only the base one."""
    preset = next((d['preset'] for d in SYNTHETIC if d['id'] == dataset_id), None)
    if preset is None and dataset_id.startswith('synthetic/') and dataset_id.split('/', 1)[1] in SyntheticScenario.PRESETS:
        preset = dataset_id.split('/', 1)[1]
    if preset is None:
        raise ValueError(f'알 수 없는 데이터예요: {dataset_id}')
    return preset


def read(text):
    text = text.lstrip('﻿')
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        raise ValueError('빈 파일이에요.')
    header = [h.strip() for h in rows[0]]
    if len(set(header)) != len(header) or not all(header):
        raise ValueError('첫 줄은 비어 있지 않고 서로 다른 열 이름이어야 해요.')
    body = [r for r in rows[1:] if any(cell.strip() for cell in r)]
    if any(len(r) != len(header) for r in body):
        raise ValueError('열 개수가 첫 줄과 다른 행이 있어요.')
    return header, body


def _number(value):
    try:
        number = float(value)
    except ValueError:
        return None
    return number if np.isfinite(number) else None


def _blank(cell):
    return cell.strip().lower() in BLANKS


def _arms(values):
    """K when the values are 0 (control) and 1..K (treatments) with none missing, else 0."""
    levels = sorted(set(values))
    if len(levels) < 2 or len(levels) - 1 > MAX_TREATMENTS or levels != list(range(len(levels))):
        return 0
    return len(levels) - 1


def columns(header, body):
    sample = body[:2000]
    out = []
    for i, name in enumerate(header):
        filled = [r[i].strip() for r in sample if not _blank(r[i])]
        values = [_number(cell) for cell in filled]
        numeric = bool(filled) and all(v is not None for v in values)
        distinct = list(dict.fromkeys(filled))  # in file order
        out.append({'name': name, 'numeric': numeric, 'binary': numeric and set(values) <= {0., 1.}, 'arms': _arms(values) if numeric else 0, 'categorical': not numeric and 1 < len(distinct) <= MAX_LEVELS,
                    'missing': len(sample) - len(filled), 'distinct': len(distinct), 'examples': sorted(distinct) if len(distinct) <= 4 else distinct[:4]})
    return out


def guess(cols):
    """A first suggestion from column names: the exact name first, then a word inside it (coupon_cost is a cost, is_treated a treatment)."""
    def pick(names, test):
        usable = [c for c in cols if test(c)]
        return next((c['name'] for c in usable if c['name'].lower() in names),
                    next((c['name'] for c in usable if set(re.split(r'[^a-z0-9]+', c['name'].lower())) & names), None))
    cost = pick(COST_NAMES, lambda c: c['numeric'])
    treatment = pick(TREATMENT_NAMES, lambda c: c['arms'] > 0 and c['name'] != cost)
    outcome = pick(OUTCOME_NAMES, lambda c: c['numeric'] and c['name'] not in (treatment, cost))
    features = [c['name'] for c in cols if (c['numeric'] or c['categorical']) and c['name'] not in (treatment, outcome, cost)
                and c['name'].lower() not in ID_NAMES and c['distinct'] > 1]
    return {'treatment': treatment, 'outcome': outcome, 'cost': cost, 'features': features}


def inspect(text):
    """Column summary, a suggested mapping and a preview, for the upload screen."""
    header, body = read(text)
    cols = columns(header, body)
    return {'rows': len(body), 'header': header, 'columns': cols, 'preview': body[:8], 'mapping': guess(cols), 'minRows': MIN_ROWS}


def _required(name, role, cells):
    values = [_number(cell) for cell in cells]
    if any(v is None for v in values):
        raise ValueError(f'{role} 열 {name}에 숫자가 아닌 값이나 빈 값이 있어요.')
    return np.asarray(values, dtype=np.float64)


def _feature(name, cells):
    """One chosen column as model inputs: numbers stay (blanks become the median), text becomes 0/1 columns per value."""
    filled = [cell.strip() for cell in cells if not _blank(cell)]
    if not filled:
        raise ValueError(f'공변량 열 {name}이 비어 있어요.')
    if all(_number(cell) is not None for cell in filled):
        column = np.asarray([np.nan if _blank(cell) else float(cell) for cell in cells], dtype=np.float64)
        gaps = np.isnan(column)
        column[gaps] = np.median(column[~gaps])
        return [name], column[:, None], int(gaps.sum())
    levels = sorted(set(filled))
    if len(levels) > MAX_LEVELS:
        raise ValueError(f'문자 열 {name}의 고유값이 {len(levels):,}개예요. {MAX_LEVELS}개까지만 공변량으로 쓸 수 있어요. 제외해 주세요.')
    if len(levels) == 2:
        levels = levels[1:]  # one 0/1 column says everything a two-valued column can
    stripped = [cell.strip() for cell in cells]
    return [f'{name}={level}' for level in levels], np.asarray([[cell == level for level in levels] for cell in stripped], dtype=np.float64), 0


def fingerprint(body):
    """Identifies the rows themselves, so a file splits the same way under any name, id, line ending or delimiter."""
    digest = hashlib.blake2b(digest_size=8)
    for row in body:
        digest.update('\x1f'.join(cell.strip() for cell in row).encode())
        digest.update(b'\x1e')
    return digest.hexdigest()


def parse(text, mapping=None):
    header, body = read(text)
    if len(body) < MIN_ROWS:
        raise ValueError(f'{MIN_ROWS:,}행 이상이 필요해요. 지금은 {len(body):,}행이에요.')
    mapping = mapping or guess(columns(header, body))
    index = {h: k for k, h in enumerate(header)}
    for role in ('treatment', 'outcome'):
        if mapping.get(role) not in index:
            raise ValueError(f'{"처치" if role == "treatment" else "결과"} 열을 선택해 주세요.')
    chosen = [f for f in mapping.get('features') or [] if f in index]
    if not chosen:
        raise ValueError('공변량 열을 하나 이상 선택해 주세요.')
    cells = lambda column: [r[index[column]] for r in body]  # noqa: E731
    treatment = _required(mapping['treatment'], '처치', cells(mapping['treatment']))
    if not _arms(np.unique(treatment).tolist()):
        raise ValueError(f'처치 열 {mapping["treatment"]}은 0(대조군)과 1, 2처럼 0부터 이어지는 정수여야 해요. 처치는 {MAX_TREATMENTS}종류까지 쓸 수 있어요.')
    t, y = treatment.astype(np.int64), _required(mapping['outcome'], '결과', cells(mapping['outcome']))
    cost = _required(mapping['cost'], '비용', cells(mapping['cost'])) if mapping.get('cost') else (t > 0).astype(np.float64)  # no cost column: one unit per treated row
    features, parts, filled = [], [], {}
    for column in chosen:
        names, part, gaps = _feature(column, cells(column))
        features += names
        parts.append(part)
        if gaps:
            filled[column] = gaps
    X = np.hstack(parts)
    used = {'treatment': mapping['treatment'], 'outcome': mapping['outcome'], 'cost': mapping.get('cost'), 'features': chosen}
    if t.min() == t.max():
        raise ValueError('처치군과 대조군이 모두 필요해요.')
    return SimpleNamespace(fingerprint=fingerprint(body), X=X, t=t, y=y, cost=cost, features=features, mapping=used, filled=filled)


def quality(X, t, y, cost, features, filled=None):
    """Validity checks for an uploaded experiment log. Passing does not prove the assignment was random."""
    treated, checks = t > 0, []
    share = float(treated.mean())
    K = int(t.max())
    shares = [float((t == k).mean()) for k in range(1, K + 1)]
    balanced_share = .05 <= share <= .95 and min(shares) >= .02
    detail = f' (T=1~{K}: ' + ', '.join(f'{s:.0%}' for s in shares) + ')' if K > 1 else ''
    checks.append({'id': 'share', 'title': '처치 비율', 'level': 'ok' if balanced_share else 'warn',
                   'text': f'처치군 {share:.0%}{detail}, 대조군 {1 - share:.0%}예요.' + ('' if balanced_share else ' 한쪽 표본이 너무 적으면 ATE 추정이 불안정해요.')})
    a, b = X[treated], X[~treated]
    spread = np.sqrt((a.var(0) + b.var(0)) / 2)
    gap = np.divide(np.abs(a.mean(0) - b.mean(0)), spread, out=np.zeros(X.shape[1]), where=spread > 0)
    worst = np.argsort(-gap)[:3]
    top = float(gap[worst[0]])
    if top > .1:
        names = ', '.join(f'{features[j]} {gap[j]:.2f}' for j in worst if gap[j] > .1)
        checks.append({'id': 'balance', 'title': '공변량 균형', 'level': 'bad' if top > .25 else 'warn',
                       'text': f'처치군과 대조군의 공변량 분포가 달라요 (SMD: {names}). 무작위 배정이 아니면 ATE가 편향될 수 있어요.'})
    else:
        checks.append({'id': 'balance', 'title': '공변량 균형', 'level': 'ok',
                       'text': f'처치군과 대조군의 공변량 차이가 작아요 (최대 SMD: {features[worst[0]]} {top:.2f}). 무작위 배정과 어긋나는 신호는 없지만, 무작위 배정을 증명하지는 않아요.'})
    delta = float(cost[treated].mean() - cost[~treated].mean())
    checks.append({'id': 'cost', 'title': '증분 비용', 'level': 'ok' if delta > 0 else 'bad',
                   'text': f'처치군의 평균 비용이 대조군보다 {delta:,.2f} 커요 (ATEᶜ).' if delta > 0 else f'ATEᶜ가 {delta:,.2f}라서 비용 효율을 계산할 수 없어요. 비용 열을 확인해 주세요.'})
    if np.ptp(y) == 0:
        checks.append({'id': 'outcome', 'title': '결과', 'level': 'bad', 'text': '결과 값이 모두 같아 ATE를 추정할 수 없어요.'})
    per_cycle = len(t) // 8
    checks.append({'id': 'size', 'title': '표본 크기', 'level': 'ok' if per_cycle >= 2000 else 'warn',
                   'text': f'8사이클 기준 사이클당 {min(per_cycle, 20000):,}행이에요.' + ('' if per_cycle >= 2000 else ' 표본이 작을수록 관측값의 변동이 커요.')})
    if filled:
        total = sum(filled.values())
        checks.append({'id': 'blanks', 'title': '결측값', 'level': 'ok', 'text': f'공변량 결측값 {total:,}개를 열별 중앙값으로 대체했어요 ({", ".join(filled)}).'})
    return checks


def profile(X, t, y, cost, features, tau_r=None, tau_c=None, filled=None):
    treated = t > 0
    out = {'checks': quality(X, t, y, cost, features, filled), 'rows': int(len(t)), 'treatments': int(t.max()), 'treatedShare': float(treated.mean()), 'outcomeT': float(y[treated].mean()), 'outcomeC': float(y[~treated].mean()),
           'costT': float(cost[treated].mean()), 'costC': float(cost[~treated].mean()), 'features': [], 'preview': {'columns': list(features) + ['t', 'y', 'cost'],
           'rows': [[round(float(v), 3) for v in X[i]] + [int(t[i]), round(float(y[i]), 3), round(float(cost[i]), 3)] for i in range(min(8, len(t)))]}}
    out['ate'] = out['outcomeT'] - out['outcomeC']
    for j, name in enumerate(features):
        col = X[:, j]
        lo, hi = float(col.min()), float(col.max())
        out['features'].append({'name': name, 'min': lo, 'max': hi, 'mean': float(col.mean()),
                                'hist': np.histogram(col, bins=16, range=(lo, hi if hi > lo else lo + 1))[0].tolist()})
    if tau_r is not None:
        out['truth'] = {'tauR': float(tau_r.mean()), 'tauC': float(tau_c.mean())}
    return out


def profile_synthetic(dataset_id, seed=42):
    pop = SyntheticScenario(synthetic_preset(dataset_id), seed=seed).cohort(1)
    idx = np.arange(len(pop))
    t = pop.assign(idx)
    y, cost = pop.outcome(idx, t)
    return profile(pop.X, t, y, cost, SyntheticScenario.features, pop.tau_r, pop.tau_c)


def bundled_path(name):
    """A file under web/data: inside the package (upliftlab/ui/data) or in a source checkout (web/data)."""
    here = Path(__file__).resolve().parent
    for path in (here / 'ui' / name, here.parents[1] / 'web' / name):
        if path.is_file():
            return path
    raise FileNotFoundError(f'{name} 파일이 없어요. 패키지를 다시 설치해 주세요.')


def fetch(dataset_id):
    """Local edition: the CSV text of a public dataset's bundled sample."""
    meta = next((d for d in PUBLIC if d['id'] == dataset_id), None)
    if meta is None:
        raise ValueError(f'없는 공개 데이터예요: {dataset_id}')
    with gzip.open(bundled_path(meta['bundled']), 'rt', encoding='utf-8') as f:
        return f.read()


SAMPLE_NAME = 'upliftlab-예시-쿠폰실험.csv'
SAMPLE_COLUMNS = ['user_id', 'visit_freq', 'days_since_last', 'price_sensitivity', 'avg_order_value', 'treatment', 'retained', 'coupon_cost']


def sample_csv(rows=40000, seed=7):
    """A randomized coupon experiment drawn from the base market and written like a real log, for trying the upload flow.

    Half the users got the coupon at random. Covariates are in everyday units (visits a month, days since the last visit,
    order value in won) and the cost is the redeemed coupon amount in won, so the file reads like an export from a CRM tool.
    """
    scenario, lines, made, cycle = SyntheticScenario('base', seed=seed, pool=20000), [','.join(SAMPLE_COLUMNS)], 0, 1
    while made < rows:
        pop = scenario.cohort(cycle)
        idx = np.arange(min(len(pop), rows - made))
        t = pop.assign(idx)
        y, cost = pop.outcome(idx, t)
        for i, (f, l, p, c) in enumerate(pop.X[idx]):
            lines.append(f'u{made + i + 1:06d},{round(f * 20)},{round(l * 90)},{p:.2f},{round((5000 + c * 45000) / 100) * 100},{int(t[i])},{int(y[i])},{round(cost[i] * 1000)}')
        made, cycle = made + len(idx), cycle + 1
    return '\n'.join(lines) + '\n'
