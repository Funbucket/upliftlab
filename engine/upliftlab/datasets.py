"""Datasets: one synthetic experiment with known effects, public experiments, and uploaded CSV files.

Criteo ships as a 200k-row sample (web/data, CC BY-NC-SA 4.0) so the web and the local edition start from the same real
experiment.
"""
import csv
import gzip
import hashlib
import io
import os
import re
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from .i18n import tr
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
    'license': 'CC BY-NC-SA 4.0 · 비상업적으로만 쓰고 출처를 밝혀요. 표본은 웹 사이트와 GitHub 저장소에 두고, pip 패키지는 처음 쓸 때 한 번 내려받아요.',
    'sha256': '2245c103df7668117272acf7f19f59c3296fff41bc871ded29fa3956d0103003',
    'treatment': '광고 대상 = 1, 대조군 = 0', 'outcome': 'visit · 사이트 방문 (0/1)', 'cost': '열 없음 · 처치 1건당 1',
    'mapping': {'treatment': 'treatment', 'outcome': 'visit', 'cost': None, 'features': [f'f{i}' for i in range(12)]},
}

PUBLIC = [CRITEO]

TREATMENT_NAMES = {'t', 'treatment', 'treated', 'treat', 'w', 'group', 'coupon', 'voucher', 'promo', 'promotion', 'reward', 'offer', 'campaign', 'email', 'exposed', 'sent', 'dose', 'arm', 'variant'}
OUTCOME_NAMES = {'y', 'outcome', 'conversion', 'converted', 'convert', 'retained', 'retention', 'yr', 'visit', 'visited', 'return', 'returned', 'response', 'purchase', 'purchased', 'bought', 'order', 'ordered', 'click', 'clicked', 'revenue', 'target', 'label'}
COST_NAMES = {'cost', 'yc', 'spend', 'spent', 'expense'}
ID_NAMES = {'id', 'user_id', 'userid', 'customer_id', 'index', 'row', 'uid'}
# Korean names run words together (쿠폰지급여부 holds 쿠폰 and 지급), so these are looked for anywhere in a name. AWAY holds
# words that point away from a role: a treatment is not what was used or spent, and an outcome is not a history
# (누적구매액, last_order are covariates).
KOREAN = {
    'treatment': ('처치', '실험군', '쿠폰', '지급', '발송', '발급', '노출', '배정', '그룹', '집단', '캠페인', '프로모션', '혜택', '할인', '푸시', '메일', '문자', '알림', '광고'),
    'outcome': ('구매', '전환', '결제', '주문', '매출', '방문', '유지', '리텐션', '잔존', '클릭', '응답', '가입', '반응', '성과', '결과', '거래'),
    'cost': ('비용', '원가', '지출', '사용액', '할인액', '할인금액', '지급액', '혜택금액'),
}
AWAY = {
    'treatment': ('사용', '비용', '금액', '액', 'used', 'redeem', 'redeemed', 'amount', 'cost'),
    'outcome': ('누적', '이전', '과거', '최근', '평균', '전월', '지난', '직전', '사전', '기존', '일수', '경과',
                'prev', 'previous', 'past', 'last', 'avg', 'mean', 'history', 'since', 'before', 'pre', 'lifetime'),
    'cost': (),
}
ID_TOKENS = {'id', 'uid', 'uuid', 'no', 'idx', 'index', 'key', 'seq', 'name', 'email', 'phone', 'mobile', 'address'}
ID_KOREAN = ('번호', '아이디', '순번', '일련', '이름', '성명', '전화', '휴대폰', '연락처', '이메일', '주소')
CONTROL_WORDS = {'control', 'ctrl', 'holdout', 'hold-out', 'baseline', '대조', '대조군', '통제', '통제군', '비교군', '미지급', '미발송', '미발급', '미노출', '비노출', '미처치', '미적용', '미대상', '비대상'}
BOOLEANS = {'true': 1., 'false': 0., 'yes': 1., 'no': 0., 'y': 1., 'n': 0., '예': 1., '아니오': 0., '아니요': 0., 'o': 1., 'x': 0.}
TOTAL_WORDS = {'합계', '총계', '소계', '총합', 'total', 'sum', 'subtotal', 'grand total'}
GROUPED = re.compile(r'\d{1,3}(,\d{3})+(\.\d*)?')
MIN_ROWS = 1000
MAX_LEVELS = 20  # a text column with more distinct values than this cannot become a feature
MAX_TREATMENTS = 8
BLANKS = {'', 'na', 'n/a', 'nan', 'null', 'none', '-'}


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
        raise ValueError(tr(f'알 수 없는 데이터예요: {dataset_id}', f'Unknown data: {dataset_id}'))
    return preset


def _letter(j):
    """A spreadsheet's column letter: 0 → A, 26 → AA."""
    out = ''
    j += 1
    while j:
        j, rest = divmod(j - 1, 26)
        out = chr(65 + rest) + out
    return out


def _total(row):
    first = next((cell.strip().lower() for cell in row if cell.strip()), '')
    return first in TOTAL_WORDS


def read(text):
    """The header and rows of a CSV text, tidied the way a sheet saved from Excel needs. Title lines above the header, total
    lines at the bottom and columns with neither a name nor a value are dropped. A column with values but no name is named
    by its letter (A, B, …), and a repeated name gets a number."""
    text = text.lstrip('﻿')
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(cell.strip() for cell in r)]
    if not rows:
        raise ValueError(tr('빈 파일이에요.', 'The file is empty.'))
    start = next((i for i, r in enumerate(rows) if sum(1 for cell in r if cell.strip()) >= 2), None)
    if start is None:
        raise ValueError(tr('열 이름이 두 개 이상 있는 표가 아니에요. 첫 줄에 열 이름이 있어야 해요.', 'This is not a table with two or more named columns. The first line needs the column names.'))
    header, body = [h.strip() for h in rows[start]], rows[start + 1:]
    while body and _total(body[-1]):
        body.pop()
    width = len(header)
    if any(len(r) > width and any(cell.strip() for cell in r[width:]) for r in body):
        raise ValueError(tr('열 이름보다 값이 많은 행이 있어요. 따옴표 없이 쉼표가 들어간 값이 있는지 확인해 주세요.', 'Some rows have more values than there are column names. Check for values with a comma and no quotes.'))
    keep = [j for j in range(width) if header[j] or any(j < len(r) and r[j].strip() for r in body)]
    names, seen = [], set()
    for j in keep:
        base = header[j] or _letter(j)
        name, k = base, 1
        while name in seen:
            k += 1
            name = f'{base} ({k})'
        seen.add(name)
        names.append(name)
    if keep != list(range(width)) or any(len(r) != width for r in body):
        body = [[r[j] if j < len(r) else '' for j in keep] for r in body]
    return names, body


def _loose(text):
    """A number as a spreadsheet shows it: 12,000 · ₩3,000 (￦ in CP949) · 3,000원 · 12% · -1,250.5, and yes/no words as 1 and 0. A comma
    only counts as a thousands separator in groups of three, so 1,5 (a decimal comma) is not read as 15."""
    text = text.strip()
    word = BOOLEANS.get(text.lower())
    if word is not None:
        return word
    scale, sign = 1., ''
    if text.endswith('%'):
        text, scale = text[:-1].strip(), .01
    if text[:1] in ('-', '+'):
        sign, text = text[0], text[1:]
    text = text.lstrip('₩￦$€£¥ ').removesuffix('원').strip()
    if GROUPED.fullmatch(text):
        text = text.replace(',', '')
    try:
        return float(sign + text) * scale
    except ValueError:
        return None


def _number(value):
    try:
        number = float(value)
    except ValueError:
        number = _loose(value)
        if number is None:
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


def _levels(distinct):
    """Codes for a treatment column written in words: the one value that names the control group (대조군, control, 미지급)
    is 0, and the others are 1, 2, … in sorted order. None unless exactly one value reads as control."""
    if not 2 <= len(distinct) <= MAX_TREATMENTS + 1:
        return None
    control = [v for v in distinct if v.lower() in CONTROL_WORDS or v.lower().startswith(('control', '대조', '통제'))]
    if len(control) != 1:
        return None
    return {control[0]: 0, **{v: k + 1 for k, v in enumerate(sorted(v for v in distinct if v != control[0]))}}


def _sample(body, size=5000):
    """Rows spread evenly over the file, so a file sorted by group (every control row first) still shows both groups."""
    if len(body) <= size:
        return body
    step = (len(body) - 1) / (size - 1)
    return [body[round(i * step)] for i in range(size)]


def _tokens(name):
    return {t for t in re.split(r'[^a-z0-9]+', name.lower()) if t}


def _named_id(name):
    return name.lower() in ID_NAMES or bool(_tokens(name) & ID_TOKENS) or any(word in name for word in ID_KOREAN)


def columns(header, sample):
    """What each column holds, from a sample of its rows (see _sample)."""
    out = []
    for i, name in enumerate(header):
        cells = [r[i].strip() for r in sample]
        filled = [cell for cell in cells if not _blank(cell)]
        values = [_number(cell) for cell in filled]
        numeric = bool(filled) and all(v is not None for v in values)
        distinct = list(dict.fromkeys(filled))  # in file order
        levels = None if numeric else _levels(distinct)
        counter = numeric and len(values) >= 100 and len(distinct) == len(cells) and all(v == int(v) for v in values) and all(b > a for a, b in zip(values, values[1:]))
        out.append({'name': name, 'numeric': numeric, 'binary': numeric and set(values) <= {0., 1.}, 'arms': _arms(values) if numeric else len(levels) - 1 if levels else 0,
                    'levels': levels, 'categorical': not numeric and 1 < len(distinct) <= MAX_LEVELS, 'id': _named_id(name) or counter,
                    'missing': len(cells) - len(filled), 'distinct': len(distinct), 'examples': sorted(distinct) if len(distinct) <= 4 else distinct[:4]})
    return out


def _score(name, role):
    """How strongly a name suggests a role: an exact English name wins, then each word that fits, less each word that points away."""
    english = {'treatment': TREATMENT_NAMES, 'outcome': OUTCOME_NAMES, 'cost': COST_NAMES}[role]
    if name.lower() in english:
        return 100
    tokens = _tokens(name)
    hits = len(tokens & english) + sum(word in name for word in KOREAN[role])
    away = len(tokens & {w for w in AWAY[role] if w.isascii()}) + sum(w in name for w in AWAY[role] if not w.isascii())
    return 10 * hits - 15 * away if hits else 0


def _cells(sample, j):
    return [r[j].strip() for r in sample]


def _vector(cells):
    """Numbers of a column, NaN where a cell is blank or not a number."""
    return np.asarray([np.nan if (v := _number(cell)) is None else v for cell in cells], dtype=np.float64)


def _notes(cols, header, sample, mapping):
    """Why a usable column is left out of the suggested covariates: it is an ID, it varies only among treated rows (recorded
    after treatment, like whether the coupon was used), or it moves with the outcome (구매금액 next to 구매여부)."""
    notes = {c['name']: ('id', tr('ID 같은 열이라 제외했어요.', 'Looks like an ID, so it is skipped.')) for c in cols if c['id']}
    if sample is None or not mapping['treatment']:
        return notes
    index, by_name = {h: j for j, h in enumerate(header)}, {c['name']: c for c in cols}
    levels = by_name[mapping['treatment']]['levels']
    t = [levels.get(v) if levels else _number(v) for v in _cells(sample, index[mapping['treatment']])]
    control = [i for i, v in enumerate(t) if v == 0]
    treated = [i for i, v in enumerate(t) if v is not None and v > 0]
    y = _vector(_cells(sample, index[mapping['outcome']])) if mapping['outcome'] else None
    roles = (mapping['treatment'], mapping['outcome'], mapping['cost'])
    for c in cols:
        name = c['name']
        if name in notes or name in roles or not (c['numeric'] or c['categorical']):
            continue
        cells = _cells(sample, index[name])
        before = {cells[i] for i in control if not _blank(cells[i])}
        if len(before) <= 1 and control and treated:
            base = next(iter(before), '')
            differs = sum(1 for i in treated if (cells[i] if not _blank(cells[i]) else '') != base) / len(treated)
            if differs >= .02 and differs * len(control) >= 10:  # a pre-treatment value would differ in about this many control rows too
                notes[name] = ('after', tr('대조군에서는 값이 모두 같아요. 쿠폰 사용 여부처럼 처치 뒤에 생긴 값이면 결과가 부풀려져서 제외했어요.',
                                           'Every control row has the same value. A value recorded after treatment, like whether the coupon was used, inflates the result, so it is skipped.'))
                continue
        if y is None or not c['numeric']:
            continue
        x = _vector(cells)
        ok = ~np.isnan(x) & ~np.isnan(y)
        xs, ys = x[ok], y[ok]
        if len(xs) < 100 or np.ptp(xs) == 0 or np.ptp(ys) == 0:
            continue
        pos = ys != 0
        same_zeros = pos.sum() >= 20 and (~pos).sum() >= 20 and (xs[pos] != 0).mean() >= .95 and (xs[~pos] == 0).mean() >= .95
        if abs(np.corrcoef(xs, ys)[0, 1]) >= .9 or same_zeros:
            notes[name] = ('outcome', tr(f'결과 열 {mapping["outcome"]}과 거의 같이 움직여요. 결과를 미리 알려 주는 값이면 비교가 틀려져서 제외했어요.',
                                         f'It moves almost exactly with the outcome {mapping["outcome"]}. A value that gives the outcome away breaks the comparison, so it is skipped.'))
    return notes


def guess(cols, header=None, sample=None):
    """A first suggestion for each role. A name decides treatment, outcome and cost: an exact English name, a word inside
    it (coupon_cost is a cost, is_treated a treatment) or a Korean word anywhere in it (쿠폰지급여부 is a treatment). The
    covariates are the other usable columns, less IDs and, given the rows, values recorded after treatment or that move
    with the outcome. Each column left out that way gets a `note` saying why."""
    def pick(role, test, taken=()):
        best, top = None, 0
        for c in cols:
            score = _score(c['name'], role) if c['name'] not in taken and test(c) else 0
            score += score > 0 and role == 'outcome' and c['binary']  # 구매여부 before 구매금액: a conversion is the usual outcome
            if score > top:
                best, top = c['name'], score
        return best
    cost = pick('cost', lambda c: c['numeric'])
    treatment = pick('treatment', lambda c: c['arms'] > 0, (cost,))
    outcome = pick('outcome', lambda c: c['numeric'], (treatment, cost))
    mapping = {'treatment': treatment, 'outcome': outcome, 'cost': cost}
    notes = _notes(cols, header, sample, mapping)
    for c in cols:
        if c['name'] in notes:
            kind, text = notes[c['name']]
            c['note'] = {'kind': kind, 'text': text}
    mapping['features'] = [c['name'] for c in cols if (c['numeric'] or c['categorical']) and c['name'] not in (treatment, outcome, cost)
                           and c['name'] not in notes and c['distinct'] > 1]
    levels = next((c['levels'] for c in cols if c['name'] == treatment), None)
    if levels:
        mapping['levels'] = levels
    return mapping


def inspect(text):
    """Column summary, a suggested mapping and a preview, for the upload screen."""
    header, body = read(text)
    sample = _sample(body)
    cols = columns(header, sample)
    mapping = guess(cols, header, sample)
    return {'rows': len(body), 'header': header, 'columns': cols, 'preview': body[:8], 'mapping': mapping, 'minRows': MIN_ROWS}


def _required(name, role, cells):
    values = [_number(cell) for cell in cells]
    if any(v is None for v in values):
        raise ValueError(tr(f'{role} 열 {name}에 숫자가 아닌 값이나 빈 값이 있어요.', f'The {role} column {name} has blank or non-numeric values.'))
    return np.asarray(values, dtype=np.float64)


def _feature(name, cells):
    """One chosen column as model inputs: numbers stay (blanks become the median), text becomes 0/1 columns per value."""
    filled = [cell.strip() for cell in cells if not _blank(cell)]
    if not filled:
        raise ValueError(tr(f'공변량 열 {name}이 비어 있어요.', f'The covariate column {name} is empty.'))
    if all(_number(cell) is not None for cell in filled):
        column = np.asarray([np.nan if _blank(cell) else _number(cell) for cell in cells], dtype=np.float64)
        gaps = np.isnan(column)
        column[gaps] = np.median(column[~gaps])
        return [name], column[:, None], int(gaps.sum())
    levels = sorted(set(filled))
    if len(levels) > MAX_LEVELS:
        raise ValueError(tr(f'문자 열 {name}의 고유값이 {len(levels):,}개예요. {MAX_LEVELS}개까지만 공변량으로 쓸 수 있어요. 제외해 주세요.', f'The text column {name} has {len(levels):,} distinct values; a covariate can have up to {MAX_LEVELS}. Skip it.'))
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
        raise ValueError(tr(f'{MIN_ROWS:,}행 이상이 필요해요. 지금은 {len(body):,}행이에요.', f'At least {MIN_ROWS:,} rows are needed; this has {len(body):,}.'))
    if not mapping:
        sample = _sample(body)
        mapping = guess(columns(header, sample), header, sample)
    index = {h: k for k, h in enumerate(header)}
    for role in ('treatment', 'outcome'):
        if mapping.get(role) not in index:
            raise ValueError(tr(f'{"처치" if role == "treatment" else "결과"} 열을 선택해 주세요.', f'Pick the {role} column.'))
    chosen = [f for f in mapping.get('features') or [] if f in index]
    if not chosen:
        raise ValueError(tr('공변량 열을 하나 이상 선택해 주세요.', 'Pick at least one covariate column.'))
    cells = lambda column: [r[index[column]] for r in body]  # noqa: E731
    levels = mapping.get('levels')
    if levels:  # a treatment written in words: 대조군 → 0, 실험군 → 1
        words = [cell.strip() for cell in cells(mapping['treatment'])]
        unknown = next((w for w in words if w not in levels), None)
        if unknown is not None:
            raise ValueError(tr(f'처치 열 {mapping["treatment"]}에 ‘{unknown}’ 값이 있어요. {", ".join(levels)} 중 하나여야 해요.',
                                f'The treatment column {mapping["treatment"]} has the value ‘{unknown}’. It must be one of {", ".join(levels)}.'))
        treatment = np.asarray([levels[w] for w in words], dtype=np.float64)
    else:
        treatment = _required(mapping['treatment'], tr('처치', 'treatment'), cells(mapping['treatment']))
    if not _arms(np.unique(treatment).tolist()):
        raise ValueError(tr(f'처치 열 {mapping["treatment"]}은 0(대조군)과 1, 2처럼 0부터 이어지는 정수여야 해요. 처치는 {MAX_TREATMENTS}종류까지 쓸 수 있어요.', f'The treatment column {mapping["treatment"]} must hold consecutive integers from 0 (control): 1, 2, and so on, up to {MAX_TREATMENTS} treatments.'))
    t, y = treatment.astype(np.int64), _required(mapping['outcome'], tr('결과', 'outcome'), cells(mapping['outcome']))
    cost = _required(mapping['cost'], tr('비용', 'cost'), cells(mapping['cost'])) if mapping.get('cost') else (t > 0).astype(np.float64)  # no cost column: one unit per treated row
    features, parts, filled = [], [], {}
    for column in chosen:
        names, part, gaps = _feature(column, cells(column))
        features += names
        parts.append(part)
        if gaps:
            filled[column] = gaps
    X = np.hstack(parts)
    used = {'treatment': mapping['treatment'], 'outcome': mapping['outcome'], 'cost': mapping.get('cost'), 'features': chosen, **({'levels': levels} if levels else {})}
    if t.min() == t.max():
        raise ValueError(tr('처치군과 대조군이 모두 필요해요.', 'Both a treatment and a control group are needed.'))
    return SimpleNamespace(fingerprint=fingerprint(body), X=X, t=t, y=y, cost=cost, features=features, mapping=used, filled=filled)


def quality(X, t, y, cost, features, filled=None):
    """Validity checks for an uploaded experiment log. Passing does not prove the assignment was random."""
    treated, checks = t > 0, []
    share = float(treated.mean())
    K = int(t.max())
    shares = [float((t == k).mean()) for k in range(1, K + 1)]
    balanced_share = .05 <= share <= .95 and min(shares) >= .02
    detail = f' (T=1~{K}: ' + ', '.join(f'{s:.0%}' for s in shares) + ')' if K > 1 else ''
    checks.append({'id': 'share', 'title': tr('처치 비율', 'Treated share'), 'level': 'ok' if balanced_share else 'warn',
                   'text': tr(f'처치군 {share:.0%}{detail}, 대조군 {1 - share:.0%}예요.', f'Treated {share:.0%}{detail}, control {1 - share:.0%}.') + ('' if balanced_share else tr(' 한쪽 표본이 너무 적으면 ATE 추정이 불안정해요.', ' When one side is too small, the ATE estimate is unstable.'))})
    a, b = X[treated], X[~treated]
    spread = np.sqrt((a.var(0) + b.var(0)) / 2)
    gap = np.divide(np.abs(a.mean(0) - b.mean(0)), spread, out=np.zeros(X.shape[1]), where=spread > 0)
    worst = np.argsort(-gap)[:3]
    top = float(gap[worst[0]])
    if top > .1:
        names = ', '.join(f'{features[j]} {gap[j]:.2f}' for j in worst if gap[j] > .1)
        checks.append({'id': 'balance', 'title': tr('공변량 균형', 'Covariate balance'), 'level': 'bad' if top > .25 else 'warn',
                       'text': tr(f'처치군과 대조군의 공변량 분포가 달라요 (SMD: {names}). 무작위 배정이 아니면 ATE가 편향될 수 있어요.', f'Covariates differ between treatment and control (SMD: {names}). If assignment was not random, the ATE may be biased.')})
    else:
        checks.append({'id': 'balance', 'title': tr('공변량 균형', 'Covariate balance'), 'level': 'ok',
                       'text': tr(f'처치군과 대조군의 공변량 차이가 작아요 (최대 SMD: {features[worst[0]]} {top:.2f}). 무작위 배정과 어긋나는 신호는 없지만, 무작위 배정을 증명하지는 않아요.', f'Covariates differ little between treatment and control (largest SMD: {features[worst[0]]} {top:.2f}). Nothing contradicts random assignment, though this does not prove it.')})
    delta = float(cost[treated].mean() - cost[~treated].mean())
    checks.append({'id': 'cost', 'title': tr('증분 비용', 'Incremental cost'), 'level': 'ok' if delta > 0 else 'bad',
                   'text': tr(f'처치군의 평균 비용이 대조군보다 {delta:,.2f} 커요 (ATEᶜ).', f'Treated mean cost is {delta:,.2f} above control (ATEᶜ).') if delta > 0 else tr(f'ATEᶜ가 {delta:,.2f}라서 비용 효율을 계산할 수 없어요. 비용 열을 확인해 주세요.', f'ATEᶜ is {delta:,.2f}, so cost effectiveness can’t be computed. Check the cost column.')})
    if np.ptp(y) == 0:
        checks.append({'id': 'outcome', 'title': tr('결과', 'Outcome'), 'level': 'bad', 'text': tr('결과 값이 모두 같아 ATE를 추정할 수 없어요.', 'Every outcome value is the same, so the ATE can’t be estimated.')})
    per_cycle = len(t) // 8
    checks.append({'id': 'size', 'title': tr('표본 크기', 'Sample size'), 'level': 'ok' if per_cycle >= 2000 else 'warn',
                   'text': tr(f'8사이클 기준 사이클당 {min(per_cycle, 20000):,}행이에요.', f'{min(per_cycle, 20000):,} rows per cycle over 8 cycles.') + ('' if per_cycle >= 2000 else tr(' 표본이 작을수록 관측값의 변동이 커요.', ' The smaller the sample, the noisier the observed values.'))})
    if filled:
        total = sum(filled.values())
        checks.append({'id': 'blanks', 'title': tr('결측값', 'Missing values'), 'level': 'ok', 'text': tr(f'공변량 결측값 {total:,}개를 열별 중앙값으로 대체했어요 ({", ".join(filled)}).', f'Filled {total:,} missing covariate values with column medians ({", ".join(filled)}).')})
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


RAW = 'https://raw.githubusercontent.com/Funbucket/upliftlab/main/web/'


def cache_dir():
    """Where downloaded samples live: $UPLIFTLAB_CACHE, else the user cache folder (~/.cache/upliftlab, %LOCALAPPDATA% on Windows)."""
    if os.environ.get('UPLIFTLAB_CACHE'):
        return Path(os.environ['UPLIFTLAB_CACHE'])
    base = os.environ.get('LOCALAPPDATA') if os.name == 'nt' else os.environ.get('XDG_CACHE_HOME')
    return Path(base or Path.home() / '.cache') / 'upliftlab'


def bundled_path(name, sha256=None):
    """A file under web/data: in a source checkout (web/data), in a package that carries it (upliftlab/ui/data), or downloaded once
    from the GitHub repository into the user cache. The pip package leaves the Criteo sample out because of its non-commercial
    license, so its first use fetches it, checks the SHA-256 and keeps it."""
    here = Path(__file__).resolve().parent
    cached = cache_dir() / name
    for path in (here.parents[1] / 'web' / name, here / 'ui' / name, cached):
        if path.is_file():
            return path
    if not sha256:
        raise FileNotFoundError(tr(f'{name} 파일이 없어요. 패키지를 다시 설치해 주세요.', f'{name} is missing. Reinstall the package.'))
    import sys
    import urllib.request
    print(tr(f'Criteo 표본을 처음 한 번 내려받아요 → {cached}', f'Downloading the Criteo sample once → {cached}'), file=sys.stderr, flush=True)
    try:
        with urllib.request.urlopen(RAW + name, timeout=60) as response:
            data = response.read()
    except OSError as error:
        raise FileNotFoundError(tr(f'{name} 파일을 내려받지 못했어요 ({error}). 네트워크를 확인하거나 {RAW + name} 을 {cached} 에 직접 두세요.', f'Could not download {name} ({error}). Check the network, or put {RAW + name} at {cached} yourself.')) from error
    if hashlib.sha256(data).hexdigest() != sha256:
        raise FileNotFoundError(tr(f'내려받은 {name} 파일의 SHA-256이 달라요. 잠시 뒤 다시 시도해 주세요.', f'The downloaded {name} has the wrong SHA-256. Try again in a moment.'))
    cached.parent.mkdir(parents=True, exist_ok=True)
    partial = cached.with_name(cached.name + '.part')
    partial.write_bytes(data)
    partial.replace(cached)
    return cached


def fetch(dataset_id):
    """Local edition: the CSV text of a public dataset's bundled sample."""
    meta = next((d for d in PUBLIC if d['id'] == dataset_id), None)
    if meta is None:
        raise ValueError(tr(f'없는 공개 데이터예요: {dataset_id}', f'No such public data: {dataset_id}'))
    with gzip.open(bundled_path(meta['bundled'], meta.get('sha256')), 'rt', encoding='utf-8') as f:
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
