"""The algorithm contract. An algorithm is one self-contained Python file that defines `class Model`:

    class Model:
        def fit(self, train, validation, context): ...   # context is optional: fit(self, train, validation)
        def predict(self, X): return scores                # or {"score": scores, "eligible": bool mask}

The file imports nothing from upliftlab, so it also runs in a notebook. It may import any library the runtime has.
In the browser, packages that Pyodide ships (NumPy, SciPy, pandas, scikit-learn, LightGBM, XGBoost, statsmodels, …)
load on first import, and other pure-Python packages from PyPI install when the file declares them (PEP 723):

    # /// script
    # dependencies = ["scikit-uplift"]
    # ///

The local edition uses whatever is installed in the Python that runs it, PyTorch on a GPU included.

`train` / `validation` have X (n×d float array), t (0 = control, 1..K = treatment), y (outcome), cost, propensity,
treatments (K), propensities (P(T = k | T in {0, k}) per treatment) and features (column names).
Higher score = treat first. With K treatments, predict returns an n×K array of scores, and each user gets the treatment
with the highest score. `context` has seed, model_seed, device ('cpu' or 'cuda:0'), target_fraction, cycle, base_learner
('ridge' or 'tree'), treatments and report(**metrics).

The knapsack and efficiency selections read the score as an expected effect in outcome units and weigh it against cost.
A model whose score is something else (a rank, or an effect that already subtracts cost) sets `score_is_effect = False`
on the class, and those selections keep its order as it is.
"""
import ast
import importlib.metadata
import importlib.util
import inspect
import re
import sys
import traceback
from types import SimpleNamespace

import numpy as np

BROWSER = sys.platform == 'emscripten'
# Import name → the package name to install, where they differ.
PACKAGES = {'sklearn': 'scikit-learn', 'sklift': 'scikit-uplift', 'cv2': 'opencv-python', 'PIL': 'pillow', 'yaml': 'pyyaml',
            'skimage': 'scikit-image', 'bs4': 'beautifulsoup4', 'dateutil': 'python-dateutil'}
# Common libraries that Pyodide v0.27.7 ships (web/runtime.js pins that version). Used only to describe a file before
# its imports are loaded; the worker loads any Pyodide package a file imports, listed here or not.
PYODIDE = {'numpy': '2.0.2', 'scipy': '1.14.1', 'pandas': '2.2.3', 'sklearn': '1.6.1', 'lightgbm': '4.5.0', 'xgboost': '2.1.2',
           'statsmodels': '0.14.4', 'polars': '1.18.0', 'pyarrow': '18.1.0', 'networkx': '3.4.2'}
# Compiled libraries with no browser build and no pure-Python wheel: only the local edition can run them.
LOCAL_ONLY = {'torch', 'tensorflow', 'jax', 'jaxlib', 'catboost', 'econml', 'causalml', 'cupy'}
COMMON = ['numpy', 'scipy', 'pandas', 'sklearn', 'lightgbm', 'xgboost', 'statsmodels', 'torch']
ENGINE = '알고리즘 파일에서는 upliftlab을 import할 수 없어요. 필요한 코드는 파일 안에 두거나 NumPy, scikit-learn 같은 라이브러리를 써 주세요.'
BLOCK = re.compile(r'(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\s(?P<content>(^#(| .*)$\s)+)^# ///$')
install_errors = {}  # package → why micropip could not install it (browser only)


class ContractError(ValueError):
    def __init__(self, message, lineno=None):
        super().__init__(message)
        self.lineno = lineno


def dataset(X, t, y, cost, propensity, features, treatments=1, propensities=None):
    return SimpleNamespace(X=X, t=t.astype(np.int64), y=y.astype(np.float64), cost=cost.astype(np.float64),
                           propensity=np.full(len(t), propensity), features=list(features), treatments=treatments,
                           propensities=np.full(treatments, float(propensity)) if propensities is None else np.asarray(propensities, dtype=np.float64))


class Context(SimpleNamespace):
    """Passed to fit(). report() streams numeric metrics (step, total, loss, …) to the screen."""

    def report(self, **metrics):
        self._count = getattr(self, '_count', 0) + 1
        if self._count > 2000:  # a chatty algorithm must not flood the screen
            return
        values = {str(k)[:32]: float(v) for k, v in list(metrics.items())[:12] if isinstance(v, (int, float, np.floating, np.integer)) and np.isfinite(v)}
        self._emit(values)


def package_of(module):
    return PACKAGES.get(module, module)


def normalize(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def requirements(code):
    """Dependencies declared in a PEP 723 `# /// script` block."""
    for match in BLOCK.finditer(code):
        if match.group('type') != 'script':
            continue
        content = ''.join(line[2:] if line.startswith('# ') else line[1:] for line in match.group('content').splitlines(keepends=True))
        try:
            import tomllib
            return [str(d) for d in tomllib.loads(content).get('dependencies', [])]
        except ModuleNotFoundError:  # Python 3.10: read the list without a TOML parser
            listed = re.search(r'(?ms)^dependencies\s*=\s*\[(.*?)\]', content)
            return re.findall(r'["\']([^"\']+)["\']', listed.group(1)) if listed else []
    return []


def distribution(requirement):
    return re.match(r'\s*([A-Za-z0-9][A-Za-z0-9._-]*)', requirement).group(1)


def installed(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def pending(codes):
    """Declared dependencies that are not installed yet (the browser worker installs them with micropip)."""
    out = []
    for code in codes:
        for requirement in requirements(code):
            if not installed(distribution(requirement)) and requirement not in out:
                out.append(requirement)
    return out


def describe(code, filename='algorithm.py'):
    """What a file declares, read without running it: NAME, the docstring summary, imports and PEP 723 dependencies."""
    tree = ast.parse(code, filename)
    doc = ast.get_docstring(tree) or ''
    name = next((node.value.value for node in tree.body if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
                 and isinstance(node.value.value, str) and any(isinstance(t, ast.Name) and t.id == 'NAME' for t in node.targets)), None)
    modules, lines = [], {}
    for node in ast.walk(tree):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module else []
        for full in names:
            top = full.split('.')[0]
            if top not in lines:
                modules.append(top)
                lines[top] = node.lineno
    return {'name': name, 'summary': doc.split('\n\n')[0].replace('\n', ' ') if doc else '', 'imports': modules, 'lines': lines, 'requires': requirements(code)}


def libraries(modules, requires=()):
    """Third-party imports and whether this runtime has them: ok (installed), auto (the browser loads it on first use),
    declared (PEP 723, installed before running), local (no browser build), missing, or failed (micropip could not install it)."""
    declared = {normalize(distribution(r)) for r in requires}
    out = []
    for module in modules:
        if module in sys.stdlib_module_names or module in ('__future__', 'upliftlab'):
            continue
        package = package_of(module)
        entry = {'module': module, 'package': package, 'version': None, 'status': 'missing'}
        if importlib.util.find_spec(module) is not None:
            entry.update(status='ok', version=installed(package))
        elif BROWSER and module in PYODIDE:
            entry.update(status='auto', version=PYODIDE[module])
        elif package in install_errors:
            entry.update(status='failed', note=install_errors[package])
        elif BROWSER and module in LOCAL_ONLY:
            entry['status'] = 'local'
        elif BROWSER and normalize(package) in declared:
            entry['status'] = 'declared'
        out.append(entry)
    return out


def missing(module):
    package = package_of(module)
    if BROWSER and module in LOCAL_ONLY:
        return f'브라우저용 빌드가 없는 라이브러리예요 · {package}. 로컬(python -m upliftlab serve)에서 실행해 주세요.'
    if BROWSER:
        why = f' ({install_errors[package]})' if package in install_errors else ''
        return (f'브라우저에 없는 라이브러리예요 · {package}{why}. PyPI의 순수 Python 패키지라면 파일 맨 위 # /// script 블록의 '
                f'dependencies에 적어 주세요. 컴파일이 필요한 패키지는 로컬에서 실행해요.')
    return f'설치되지 않은 라이브러리예요 · {package}. 실행 중인 Python 환경에서 pip install {package} 후 다시 검사해 주세요.'


def explain(error):
    """One line for the screen. A missing library comes with what to do about it in this runtime."""
    if isinstance(error, ModuleNotFoundError) and error.name:
        return f'ModuleNotFoundError: {missing(error.name.split(".")[0])}'
    if isinstance(error, ContractError):
        return str(error)
    return f'{type(error).__name__}: {error}'


def line(error, filename):
    """The line in the user's file where the error happened, if it happened there."""
    found = getattr(error, 'lineno', None)
    if found is None:
        frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == filename]
        found = frames[-1].lineno if frames else None
    return found


def load(code, filename='algorithm.py'):
    meta = describe(code, filename)
    if 'upliftlab' in meta['lines']:
        raise ContractError(ENGINE, meta['lines']['upliftlab'])
    namespace = {'__name__': 'algorithm'}
    exec(compile(code, filename, 'exec'), namespace)
    model_type = namespace.get('Model')
    if not inspect.isclass(model_type):
        raise ContractError('class Model을 정의해 주세요.')
    for method in ('fit', 'predict'):
        if not callable(getattr(model_type, method, None)):
            raise ContractError(f'class Model에 {method}() 메서드가 필요해요.')
    return model_type, meta


def instantiate(model_type):
    return model_type({}) if len(inspect.signature(model_type).parameters) else model_type()


def fit(model, train, validation, context):
    """fit(train, validation, context), or fit(train, validation) for code that does not report progress."""
    params = inspect.signature(model.fit).parameters.values()
    takes_context = len(params) >= 3 or any(p.kind == p.VAR_POSITIONAL for p in params)
    return model.fit(train, validation, context) if takes_context else model.fit(train, validation)


def scores(model, X, treatments=1):
    """What a model decides for each row: its score, whether it may be selected, and which treatment (1..K) it would get."""
    return decide(model, X, treatments)[:3]


def decide(model, X, treatments=1):
    """scores(), plus the n×K score of every treatment. A model that names one treatment per row has a score for that one only."""
    out = model.predict(X)
    eligible, arm, matrix = None, None, None
    if isinstance(out, dict):
        if 'score' not in out:
            raise ValueError('predict(X)는 점수 배열이나 {"score": 배열}을 반환해야 해요.')
        score, eligible, arm = out['score'], out.get('eligible'), out.get('arm')
    else:
        score = out
    if hasattr(score, 'detach'):  # a torch tensor
        score = score.detach().cpu().numpy()
    score = np.asarray(score, dtype=np.float64)
    if score.ndim == 2 and score.shape[1] == treatments and arm is None:
        matrix = score
        arm = score.argmax(1) + 1
        score = score.max(1)
    elif treatments > 1 and arm is None:
        raise ValueError(f'이 데이터셋의 처치는 {treatments}종류예요. predict는 (행 수, {treatments}) 배열이나 {{"score": 배열, "arm": 처치 번호}}를 반환해야 해요.')
    score = score.reshape(-1)
    if score.shape != (len(X),) or not np.isfinite(score).all():
        raise ValueError('score는 입력 행 수와 같은 길이의 유한한 배열이어야 해요.')
    if eligible is not None:
        eligible = np.asarray(eligible)
        if eligible.shape != (len(X),) or eligible.dtype.kind != 'b':
            raise ValueError('eligible은 입력 행 수와 같은 길이의 불리언 배열이어야 해요.')
    arm = np.ones(len(X), dtype=np.int64) if arm is None else np.asarray(arm, dtype=np.int64).reshape(-1)
    if arm.shape != (len(X),) or arm.min() < 1 or arm.max() > treatments:
        raise ValueError(f'arm은 입력 행 수와 같은 길이의 처치 번호(1~{treatments}) 배열이어야 해요.')
    if matrix is None or not np.isfinite(matrix).all():
        matrix = np.full((len(X), treatments), -np.inf)
        matrix[np.arange(len(X)), arm - 1] = score
    return score, eligible, arm, matrix
