"""JSON entry points shared by the browser worker (Pyodide) and the local server."""
import importlib.util
import json
import math
import platform
import sys
import traceback
from pathlib import Path

import numpy as np

from . import __version__, contract, datasets
from .algorithms import ORDER
from .arena import Run, quick_check
from .scenario import ReplayScenario, SyntheticScenario

state = {'run': None, 'data': {}, 'report': lambda message: None, 'runtime': 'browser', 'device': 'cpu', 'devices': ['cpu']}
ALGORITHM_DIR = Path(__file__).parent / 'algorithms'
TEMPLATE_DIR = Path(__file__).parent / 'templates'
TEMPLATES = ['start_sklearn', 'start_lightgbm', 'start_pytorch']  # starting files for a new algorithm, in menu order


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    return value


def set_reporter(fn):
    state['report'] = fn


def report(message):
    state['report'](json.dumps(clean(message)))


def _files(paths):
    """Algorithm files with what they declare, read without running them (so listing never needs their libraries)."""
    out = []
    for key, path in paths:
        code = path.read_text(encoding='utf-8')
        meta = contract.describe(code, f'{key}.py')
        out.append({'id': key, 'name': meta['name'] or key, 'summary': meta['summary'], 'code': code, 'file': path.relative_to(ALGORITHM_DIR.parent.parent).as_posix(),
                    'libraries': contract.libraries(meta['imports'], meta['requires'])})
    return out


def implementation():
    """'econml' where EconML is installed (the local edition), else 'lite': the scikit-learn versions in algorithms/lite."""
    return 'econml' if not contract.BROWSER and importlib.util.find_spec('econml') is not None else 'lite'


def builtins(impl=None):
    impl = impl or implementation()
    lite = ALGORITHM_DIR / 'lite'
    paths = [(key, lite / f'{key}.py' if impl == 'lite' and (lite / f'{key}.py').exists() else ALGORITHM_DIR / f'{key}.py') for key in ORDER]
    return [{**a, 'builtin': True, 'implementation': impl} for a in _files(paths)]


def templates():
    return _files([(key, TEMPLATE_DIR / f'{key}.py') for key in TEMPLATES])


def info():
    return {'engine': __version__, 'python': platform.python_version(), 'numpy': np.__version__, 'runtime': state['runtime'],
            'device': state['device'], 'devices': state['devices'], 'implementation': implementation(), 'algorithms': builtins(), 'templates': templates(),
            'libraries': contract.libraries(contract.COMMON), 'datasets': datasets.catalog()}


def check(code, id='algorithm'):
    """Reads the file, then runs its top level (imports included) and checks class Model. Missing libraries say what to do."""
    filename = f'{id}.py'
    try:
        meta = contract.describe(code, filename)
    except SyntaxError as error:
        return {'ok': False, 'error': f'SyntaxError: {error.msg}', 'line': error.lineno, 'libraries': []}
    out = {'name': meta['name'], 'summary': meta['summary'], 'requires': meta['requires'], 'libraries': contract.libraries(meta['imports'], meta['requires'])}
    try:
        contract.load(code, filename)
        return {'ok': True, **out}
    except Exception as error:
        return {'ok': False, **out, 'error': contract.explain(error), 'line': contract.line(error, filename)}


def requirements(codes):
    """PEP 723 dependencies of these files that are not installed yet."""
    return contract.pending(codes)


async def prepare(codes):
    """Browser only: install declared PEP 723 dependencies with micropip. Failures are kept and shown by check()."""
    import micropip
    for requirement in contract.pending(codes):
        package = contract.distribution(requirement)
        try:
            await micropip.install(requirement)
            contract.install_errors.pop(package, None)
        except Exception as error:
            contract.install_errors[package] = str(error).strip().splitlines()[0][:160]


def try_algorithm(code, id='algorithm', name=None):
    """Quick check on the base synthetic market. Errors come back with the line in the user's file."""
    try:
        return {'ok': True, **quick_check({'id': id, 'name': name or id, 'code': code}, state['device'], report)}
    except Exception as error:
        return {'ok': False, 'error': contract.explain(error), 'line': contract.line(error, f'{id}.py')}


def inspect_csv(csv):
    return datasets.inspect(csv)


def add_dataset(id, csv, name, mapping=None):
    data = datasets.parse(csv, mapping)
    state['data'][id] = data
    return {'id': id, 'name': name, 'mapping': data.mapping, 'profile': datasets.profile(data.X, data.t, data.y, data.cost, data.features, filled=data.filled)}


def sample_csv():
    """The example experiment log offered on the upload screen."""
    return {'name': datasets.SAMPLE_NAME, 'csv': datasets.sample_csv()}


def fetch_dataset(id):
    """Local edition: a bundled sample or a download from the source. The browser loads bundled files itself (add_dataset)."""
    if state['runtime'] != 'local':
        raise ValueError('원본 사이트가 브라우저 다운로드를 막고 있어요. 파일을 받아 업로드하거나 로컬에서 실행해 주세요.')
    meta = next(d for d in datasets.PUBLIC if d['id'] == id)
    return add_dataset(id, datasets.fetch(id), meta['name'], meta.get('mapping'))


def describe_dataset(id, seed=42):
    if id.startswith('synthetic/'):
        return {'id': id, 'profile': datasets.profile_synthetic(id, seed)}
    data = state['data'].get(id)
    if data is None:
        return {'id': id, 'loaded': False}
    return {'id': id, 'loaded': True, 'mapping': data.mapping, 'profile': datasets.profile(data.X, data.t, data.y, data.cost, data.features, filled=data.filled)}


def run_start(dataset, algorithms, cycles=8, explore=.2, target=.4, seed=42, window=3, mode='quantile', budget=.4, base_learner='ridge', efficiency=.2):
    cycles = int(min(12, max(2, cycles)))
    if dataset.startswith('synthetic/'):
        scenario = SyntheticScenario(datasets.synthetic_preset(dataset), seed=seed, cycles=cycles)
    elif dataset in state['data']:
        scenario = ReplayScenario(state['data'][dataset], seed=seed, cycles=cycles)
    else:
        raise LookupError(f'데이터를 먼저 불러와 주세요: {dataset}')
    for a in algorithms:  # a file that cannot even load (a missing library, a syntax error) stops the run before it starts
        try:
            contract.load(a['code'], f"{a['id']}.py")
        except Exception as error:
            raise ValueError(f"{a.get('name') or a['id']} · {contract.explain(error)}") from None
    state['run'] = Run(scenario, algorithms, explore=explore, target=target, seed=seed, window=window, device=state['device'], mode=mode, budget=budget, base_learner=base_learner, efficiency=efficiency)
    uses = {m for a in algorithms for m in contract.describe(a['code'], f"{a['id']}.py")['imports']}
    return {**state['run'].plan(), 'dataset': dataset, 'engine': __version__, 'runtime': state['runtime'], 'device': state['device'],
            'implementation': 'econml' if 'econml' in uses else 'lite'}


def run_cycle():
    if state['run'] is None:
        raise ValueError('시작한 실행이 없어요.')
    return state['run'].step(report)


def record(plan, cycles):
    """The saved form of a run: per-cycle results, the final summary, and cost curves only for the last cycle."""
    rows = []
    for i, c in enumerate(cycles):
        c = {k: v for k, v in c.items() if k != 'summary'}
        if i < len(cycles) - 1:
            c['arms'] = [{**a, 'train': {k: v for k, v in (a.get('train') or {}).items() if k not in ('curve', 'truthCurve')}} for a in c['arms']]
        rows.append(c)
    return {'plan': plan, 'cycles': rows, 'summary': cycles[-1]['summary'] if cycles else None}


def run_all(dataset, algorithms, cycles=8, explore=.2, target=.4, seed=42, mode='quantile', budget=.4, base_learner='ridge', efficiency=.2):
    plan, out = run_start(dataset, algorithms, cycles, explore, target, seed, mode=mode, budget=budget, base_learner=base_learner, efficiency=efficiency), []
    while not state['run'].done:
        out.append(run_cycle())
    return clean(record(plan, out))


METHODS = {f.__name__: f for f in (info, check, requirements, try_algorithm, inspect_csv, add_dataset, sample_csv, fetch_dataset, describe_dataset, run_start, run_cycle, run_all)}


def call(method, payload='{}'):
    """Returns a JSON string: {"ok": true, "result": …} or {"ok": false, "error": traceback}."""
    try:
        if method not in METHODS:
            raise ValueError(f'unknown method {method}')
        return json.dumps({'ok': True, 'result': clean(METHODS[method](**json.loads(payload)))}, ensure_ascii=False)
    except Exception as error:
        tb = traceback.format_exc(limit=6)
        return json.dumps({'ok': False, 'error': f'{type(error).__name__}: {error}', 'trace': tb[-4000:]}, ensure_ascii=False)


if sys.platform == 'emscripten':
    state['runtime'] = 'browser'
