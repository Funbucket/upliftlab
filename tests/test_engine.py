"""Engine shared by the browser (Pyodide) and the local edition."""
import ast
import importlib.util
import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
if importlib.util.find_spec('sklearn') is None:
    pytest.exit("The built-in algorithms use scikit-learn. Install the dev extras first: pip install -e 'engine[dev]'", returncode=1)
from upliftlab import bridge, contract, datasets  # noqa: E402
from upliftlab.arena import Run, knapsack, select, best_cutoff  # noqa: E402
from upliftlab.arena import cost_estimator  # noqa: E402
from upliftlab.metrics import aucc, cost_curve, qini, uplift_at  # noqa: E402
from upliftlab.scenario import ReplayScenario, SyntheticScenario  # noqa: E402

BUILTINS = {a['id']: {'id': a['id'], 'name': a['name'], 'code': a['code']} for a in bridge.builtins()}
TEMPLATES = {t['id']: t for t in bridge.templates()}


def pick(*ids):
    return [BUILTINS[i] for i in ids]


def call(method, **payload):
    out = json.loads(bridge.call(method, json.dumps(payload)))
    assert out['ok'], out
    return out['result']


def test_every_algorithm_sees_the_same_users_and_explore_group():
    run = Run(SyntheticScenario('base', seed=42, cycles=3), pick('random_baseline', 't_learner'))
    first, second = run.step(), run.step()
    assert first['n'] == 20000 and first['explore']['n'] == 4000 and first['candidates'] == 16000
    a, b = first['arms']
    assert a['version'] == b['version'] == 0 and a['exploit'] == b['exploit'], 'cycle 1 has no model, so both select at random'
    assert a['selected'] == round(16000 * .4) == a['exploit']['n']
    assert abs(first['explore']['nT'] / 4000 - .5) < .03
    a, b = second['arms']
    assert a['version'] == b['version'] == 1 and a['exploit'] != b['exploit']
    assert second['window']['cycles'] == [1, 2] and second['window']['rows'] == 8000


def test_training_uses_only_the_recent_explore_window():
    run = Run(SyntheticScenario('base', seed=7, cycles=5), pick('t_learner'), window=3)
    for _ in range(5):
        out = run.step()
    assert out['window']['cycles'] == [3, 4, 5] and out['window']['rows'] == 3 * 4000
    split = out['window']['split']
    assert sum(split.values()) == 12000 and abs(split['train'] / 12000 - .6) < .02
    assert out['done'] and pytest.raises(ValueError, run.step)


def test_aucc_baselines():
    line = [{'cost': f * 10, 'value': f * 4} for f in (0, .25, .5, .75, 1)]
    assert aucc(line) == .5
    assert aucc([{'cost': 0, 'value': 0}, {'cost': 9, 'value': 1}, {'cost': 10, 'value': 4}]) < .5
    rng = np.random.default_rng(0)
    tau_r, tau_c = rng.random(5000), rng.random(5000) + .1
    assert abs(aucc(cost_curve(rng.random(5000), None, None, None, tau_r=tau_r, tau_c=tau_c)) - .5) < .03
    assert aucc(cost_curve(tau_r / tau_c, None, None, None, tau_r=tau_r, tau_c=tau_c)) > .7


def test_head_to_head_ranks_cost_aware_models_first_and_is_reproducible():
    algorithms = pick('duality_r_learner', 'r_learner', 'random_baseline')
    result = call('run_all', dataset='synthetic/base', algorithms=algorithms, cycles=4)
    again = call('run_all', dataset='synthetic/base', algorithms=algorithms, cycles=4)
    untimed = lambda r: [{k: v for k, v in a.items() if k != 'trainMs'} for a in r['summary']['arms']]  # noqa: E731
    assert untimed(result) == untimed(again)
    s = {a['arm']: a for a in result['summary']['arms']}
    assert result['summary']['by'] == 'truthGain' and result['summary']['leader'] == 'duality_r_learner'
    assert s['duality_r_learner']['truthGain'] > s['r_learner']['truthGain'] > s['random_baseline']['truthGain']
    assert abs(s['random_baseline']['truthGain']) < .05 and s['duality_r_learner']['cycles'] == 3
    for a in s.values():
        lo, hi = a['ci']
        assert lo <= a['gain'] <= hi
    assert s['random_baseline']['vsLeader']['tied'] is False and s['duality_r_learner']['vsLeader'] is None
    last = result['cycles'][-1]['arms'][0]['train']
    assert len(last['curve']) == 21 and 'curve' not in result['cycles'][0]['arms'][0]['train']


def test_builtins_follow_the_contract_in_the_quick_check():
    out = {k: call('try_algorithm', code=a['code'], id=k) for k, a in BUILTINS.items()}
    assert all(r['ok'] for r in out.values()), out
    truth = {k: r['auccTruth'] for k, r in out.items()}
    assert abs(truth['random_baseline'] - .5) < .05
    for k in ('x_learner', 't_learner', 'r_learner'):
        assert truth[k] > truth['random_baseline'], (k, truth)
    assert truth['duality_r_learner'] > truth['r_learner'], truth
    reports = []
    bridge.set_reporter(lambda m: reports.append(json.loads(m)))
    try:
        call('try_algorithm', code=BUILTINS['duality_r_learner']['code'], id='duality_r_learner')
    finally:
        bridge.set_reporter(lambda m: None)
    assert [r['step'] for r in reports if 'step' in r] == [1, 2, 3, 4, 5, 6, 7], 'context.report reaches the screen'


def test_x_learner_weights_both_effect_models_by_propensity():
    assert list(BUILTINS) == ['random_baseline', 'x_learner', 't_learner', 'r_learner', 'dml', 'duality_r_learner']
    rng = np.random.default_rng(1)
    n = 6000
    X = rng.random((n, 3))
    t = (rng.random(n) < .2).astype(np.int64)
    tau = 2 * X[:, 0]
    y = X[:, 1] + t * tau + rng.normal(0, .1, n)
    train = contract.dataset(X, t, y, t * 1., .2, ['a', 'b', 'c'])
    lite = next(a for a in bridge.builtins('lite') if a['id'] == 'x_learner')  # the scikit-learn file, whose parts are visible
    model_type, _ = contract.load(lite['code'], 'x_learner.py')
    model = model_type()
    contract.fit(model, train, train, None)
    tau1, tau0, e = model.arms[0]
    assert e == pytest.approx(.2)
    score = model.predict(X)[:, 0]
    assert np.corrcoef(score, tau)[0, 1] > .99
    assert score == pytest.approx(.2 * tau0.predict(X) + .8 * tau1.predict(X))


def test_user_code_errors_keep_the_previous_model_and_report_lines():
    assert call('check', code='class Model:\n    def fit(self, train, validation, context): pass\n    def predict(self, X): return {"score": X[:, 0]}\n')['ok']
    bad = call('check', code='x = 1\nclass Model(:\n  pass\n')
    assert not bad['ok'] and bad['line'] == 2
    nan = {'id': 'nan', 'name': 'NaN', 'code': 'import numpy as np\nclass Model:\n    def fit(self, *a): pass\n    def predict(self, X):\n        return {"score": np.full(len(X), np.nan)}\n'}
    failed = call('try_algorithm', code=nan['code'], id='nan')
    assert not failed['ok'] and '유한한' in failed['error']
    result = call('run_all', dataset='synthetic/base', algorithms=[nan, BUILTINS['t_learner']], cycles=3)
    rows = [c['arms'][0] for c in result['cycles']]
    assert all('error' in r['train'] for r in rows) and all(r['version'] == 0 for r in rows)
    s = result['summary']['arms'][0]
    assert s['failures'] == 3 and '유한한' in s['lastError'] and s['gain'] is None and s['rank'] == 2


def make_csv(n=12000, seed=3):
    rng = np.random.default_rng(seed)
    x = rng.random((n, 3))
    t = (rng.random(n) < .5).astype(int)
    y = (rng.random(n) < .2 + t * .2 * x[:, 0]).astype(int)
    buf = io.StringIO()
    buf.write('user_id,a,b,c,treatment,converted,cost\n')
    for i in range(n):
        buf.write(f'{i},{x[i, 0]:.4f},{x[i, 1]:.4f},{x[i, 2]:.4f},{t[i]},{y[i]},{t[i] * y[i] * 2.0}\n')
    return buf.getvalue()


def test_uploaded_csv_is_mapped_and_replayed_without_truth():
    text = make_csv()
    seen = call('inspect_csv', csv=text)
    assert seen['rows'] == 12000 and 'adapter' not in seen
    assert seen['mapping'] == {'treatment': 'treatment', 'outcome': 'converted', 'cost': 'cost', 'features': ['a', 'b', 'c']}
    added = call('add_dataset', id='upload/test', csv=text, name='test.csv')
    assert added['profile']['rows'] == 12000 and [f['name'] for f in added['profile']['features']] == ['a', 'b', 'c']
    plan = call('run_start', dataset='upload/test', algorithms=pick('t_learner', 'random_baseline'), cycles=8)
    assert plan['truth'] is False and plan['pool'] == 1500 and plan['cycles'] == 8
    out = call('run_cycle')
    assert 'truthGain' not in out['arms'][0] and out['summary']['by'] == 'gain'
    custom = call('add_dataset', id='upload/custom', csv=text, name='test.csv', mapping={'treatment': 'treatment', 'outcome': 'converted', 'cost': None, 'features': ['a']})
    assert custom['mapping']['cost'] is None and abs(custom['profile']['costT'] - 1) < 1e-9, 'no cost column → one unit per treated row'
    for mapping, message in [({'treatment': 'a', 'outcome': 'converted', 'features': ['b']}, '정수'), ({'treatment': 'treatment', 'outcome': 'converted', 'features': []}, '공변량')]:
        with pytest.raises(ValueError, match=message):
            datasets.parse(text, mapping)
    with pytest.raises(ValueError, match='1,000행'):
        datasets.parse('t,y,x\n' + '\n'.join('1,1,0' for _ in range(500)))


@pytest.mark.parametrize('algorithm', ['duality_r_learner', 'start_sklearn'])
def test_ranking_does_not_depend_on_the_units_of_cost_or_outcome(algorithm):
    code = (BUILTINS.get(algorithm) or TEMPLATES[algorithm])['code']
    text = make_csv()

    def run(cost_unit, outcome_unit):
        data = datasets.parse(text)
        data.cost, data.y = data.cost * cost_unit, data.y * outcome_unit
        run = Run(ReplayScenario(data, seed=42, cycles=4), [{'id': algorithm, 'name': algorithm, 'code': code}], seed=42)
        out = [run.step() for _ in range(4)][-1]
        return out['summary']['arms'][0]['gain'], out['trace']['arms'][algorithm]['rank'], getattr(run.arms[0].model, 'lam', None)
    gain, ranks, lam = run(1, 1)
    for units in [(1000, 1), (.001, 1), (1, 100), (1500, 3)]:
        other_gain, other_ranks, other_lam = run(*units)
        assert other_ranks == ranks and other_lam == lam, units
        assert other_gain == pytest.approx(gain, abs=1e-9), units


def test_qini_and_uplift_at_k_follow_their_definitions():
    line = [{'f': f, 'cost': f * 10, 'value': f * 4} for f in (0, .25, .5, .75, 1)]
    assert qini(line) == pytest.approx(0), 'a straight line is random targeting'
    assert qini([{'f': 0, 'value': 0}, {'f': .5, 'value': 4}, {'f': 1, 'value': 4}]) == pytest.approx(.25)
    assert qini([{'f': 0, 'value': 0}, {'f': 1, 'value': 0}]) is None
    rng = np.random.default_rng(0)
    tau = rng.random(20000)
    good, bad = cost_curve(tau, None, None, None, tau_r=tau, tau_c=np.ones(20000)), cost_curve(-tau, None, None, None, tau_r=tau, tau_c=np.ones(20000))
    assert qini(good) > .1 > 0 > -.1 > qini(bad)
    assert abs(qini(cost_curve(rng.random(20000), None, None, None, tau_r=tau, tau_c=np.ones(20000)))) < .03
    assert uplift_at(tau, .2, tau_r=tau) == pytest.approx(.9, abs=.01)
    assert uplift_at(np.array([3., 2, 1, 0]), .5, np.array([1, 0, 1, 0]), np.array([1., 0, 0, 0])) == 1
    assert uplift_at(np.array([3., 2, 1, 0]), .25, np.array([1, 0, 1, 0]), np.array([1., 0, 0, 0])) is None, 'one arm alone has no effect to measure'
    s = {a['arm']: a for a in call('run_all', dataset='synthetic/base', algorithms=pick('duality_r_learner', 'random_baseline'), cycles=3)['summary']['arms']}
    assert s['duality_r_learner']['qiniTruth'] > s['random_baseline']['qiniTruth'] and abs(s['random_baseline']['qiniTruth']) < .05
    assert s['duality_r_learner']['upliftAtTruth'] > 0 and s['duality_r_learner']['qini'] is not None


def test_a_budget_survives_a_treatment_with_no_rows_in_the_window():
    assert cost_estimator([{'X': np.ones((4, 2)), 't': np.array([0, 0, 1, 1]), 'cost': np.array([0., 0, 2, 2]), 'split': np.zeros(4)}], 2)(np.ones((3, 2))).shape == (3, 2)
    log = [{'X': np.random.default_rng(0).random((200, 2)), 't': np.r_[np.zeros(100, int), np.ones(100, int)], 'cost': np.r_[np.zeros(100), np.ones(100) * 3], 'split': np.zeros(200)}]
    out = cost_estimator(log, 2)(np.random.default_rng(1).random((5, 2)))
    assert out.shape == (5, 2) and np.isfinite(out).all() and (out > 0).all()
    assert out[:, 0] == pytest.approx(3, abs=.01)


def test_a_budget_limits_spend_and_ranks_by_what_it_buys():
    algorithms = pick('duality_r_learner', 'r_learner', 'random_baseline')
    run = Run(SyntheticScenario('base', seed=42, cycles=4), algorithms, mode='budget', budget=.3)
    outs = [run.step() for _ in range(4)]
    assert outs[0]['budget'] is None and outs[0]['arms'][0]['selected'] == round(16000 * .3), 'cycle 1 has no cost estimate yet'
    for out in outs[1:]:
        assert out['budget'] > 0
        for row in out['arms']:
            assert row['planned'] <= out['budget'] and row['planned'] > out['budget'] * .99, 'the budget is used up to the last affordable user'
    by_arm = {r['arm']: r for r in outs[-1]['arms']}
    assert by_arm['duality_r_learner']['selected'] > by_arm['r_learner']['selected'], 'a cost-aware ranking affords more users'
    summary = outs[-1]['summary']
    assert summary['by'] == 'truthIncR' and summary['leader'] == 'duality_r_learner'
    arms = {s['arm']: s for s in summary['arms']}
    assert arms['duality_r_learner']['truthIncR'] > arms['r_learner']['truthIncR']
    assert arms['r_learner']['vsLeader']['diff'] == pytest.approx(arms['r_learner']['incR'] - arms['duality_r_learner']['incR'])
    assert abs(arms['duality_r_learner']['truthIncC'] / arms['r_learner']['truthIncC'] - 1) < .1, 'the same budget buys about the same true spend'
    with pytest.raises(ValueError, match='선정 방식'):
        Run(SyntheticScenario('base'), algorithms, mode='nope')


def test_tree_base_learner_separates_x_from_t():
    algorithms = pick('x_learner', 't_learner', 'r_learner', 'dml', 'duality_r_learner')
    run = Run(SyntheticScenario('base', seed=42, cycles=2, pool=6000), algorithms, base_learner='tree')
    second = [run.step() for _ in range(2)][-1]
    ranks = second['trace']['arms']
    assert ranks['x_learner']['rank'] != ranks['t_learner']['rank']
    scores = np.array([v if v is not None else 0 for v in ranks['x_learner']['score']]), np.array([v if v is not None else 0 for v in ranks['t_learner']['score']])
    assert np.corrcoef(*scores)[0, 1] < .999
    assert all(a['error'] is None and 'error' not in a['train'] for a in second['arms'])
    with pytest.raises(ValueError, match='기본 모델'):
        Run(SyntheticScenario('base'), algorithms, base_learner='nope')


def test_dml_finds_the_effect_under_confounded_assignment():
    rng = np.random.default_rng(2)
    n = 8000
    X = rng.random((n, 3))
    e = .1 + .8 * X[:, 0]
    t = (rng.random(n) < e).astype(np.int64)
    tau = 2 * X[:, 1]
    y = 3 * X[:, 0] + t * tau + rng.normal(0, .1, n)
    train = contract.dataset(X, t, y, t * 1., float(t.mean()), ['a', 'b', 'c'])
    context = contract.Context(model_seed=1, base_learner='ridge', _emit=lambda m: None)
    Model, _ = contract.load(BUILTINS['dml']['code'], 'dml.py')
    model = Model()
    contract.fit(model, train, train, context)
    score = model.predict(X)[:, 0]
    assert np.corrcoef(score, tau)[0, 1] > .98
    assert abs(score.mean() - tau.mean()) < .1, 'a naive treated-minus-control difference would be biased by X[:, 0]'
    assert abs((y[t == 1].mean() - y[t == 0].mean()) - tau.mean()) > .5


def test_several_treatments_run_end_to_end_with_the_chosen_treatment():
    scenario = SyntheticScenario('tiers', seed=42, cycles=4)
    assert scenario.treatments == 3
    pop = scenario.cohort(1)
    idx = np.arange(len(pop))
    t = pop.assign(idx)
    assert set(np.unique(t)) == {0, 1, 2, 3} and abs((t == 0).mean() - .5) < .02 and abs((t == 2).mean() - 1 / 6) < .02
    assert pop.tau_r.shape == (20000, 3) and (pop.tau_c[:, 2] > pop.tau_c[:, 0]).mean() > .99
    forced = pop.assign(idx, np.full(20000, 3))
    assert set(np.unique(forced)) == {0, 3}, 'the engine gives each selected user the treatment the algorithm chose'
    y, cost = pop.outcome(idx, forced)
    assert (cost[forced == 0] == 0).all() and cost[forced == 3].max() > 0
    run = Run(scenario, pick('duality_r_learner', 't_learner', 'x_learner', 'r_learner', 'dml', 'random_baseline'))
    out = [run.step() for _ in range(4)][-1]
    assert run.plan()['treatments'] == 3 and len(run.plan()['labels']) == 3
    by_arm = {r['arm']: r for r in out['arms']}
    assert all(r['error'] is None and 'error' not in r['train'] for r in out['arms']), out['arms'][0]
    assert sum(by_arm['t_learner']['armCounts']) == by_arm['t_learner']['selected']
    summary = {s['arm']: s for s in out['summary']['arms']}
    assert summary['duality_r_learner']['truthGain'] > .3 > summary['t_learner']['truthGain']
    assert summary['t_learner']['armShare'][2] > .9 > summary['duality_r_learner']['armShare'][2], 'ignoring cost favors the largest reward'
    assert summary['t_learner']['truthIncR'] > summary['random_baseline']['truthIncR'], 'the largest reward buys more outcome at a worse cost effectiveness'
    assert abs(sum(summary['duality_r_learner']['armShare']) - 1) < 1e-9 and summary['duality_r_learner']['qiniTruth'] is not None
    row = out['trace']['arms']['t_learner']
    assert len(row['arm']) == len(out['trace']['ids']) == len(row['t']) == len(row['tauR'])
    both = Run(SyntheticScenario('tiers', seed=42, cycles=3, pool=6000), pick('duality_r_learner', 't_learner'), mode='budget', budget=.3)
    spent = {r['arm']: r for r in [both.step() for _ in range(3)][-1]['arms']}
    assert spent['duality_r_learner']['selected'] > spent['t_learner']['selected'], 'cheaper treatments reach more users under one budget'
    assert all(r['planned'] > 0 and 'error' not in r['train'] for r in spent.values())
    plan = call('run_start', dataset='synthetic/tiers', algorithms=pick('t_learner'), cycles=2)
    assert plan['treatments'] == 3 and plan['labels'] == ['보상 ×0.5', '보상 ×1', '보상 ×1.5']
    assert call('describe_dataset', id='synthetic/tiers')['profile']['treatments'] == 3
    single = {'id': 'one', 'name': 'one', 'code': 'import numpy as np\nclass Model:\n    def fit(self, *a): pass\n    def predict(self, X):\n        return X[:, 0]\n'}
    failed = Run(SyntheticScenario('tiers', seed=1, cycles=2, pool=4000), [single])
    last = [failed.step() for _ in range(2)][-1]['arms'][0]
    assert '처치는 3종류' in last['train']['error'] and '처치는 3종류' in last['error'] if last['error'] else '처치는 3종류' in last['train']['error']


def test_an_uploaded_log_can_have_several_treatments():
    rng = np.random.default_rng(4)
    rows = ['user_id,visits,dose,bought,spent']
    for i in range(6000):
        v, dose = rng.random(), int(rng.integers(0, 3))
        y = int(rng.random() < .2 + (.3 * v if dose == 1 else .1 if dose == 2 else 0))
        rows.append(f'{i},{v:.4f},{dose},{y},{dose * y * 2}')
    text = '\n'.join(rows)
    seen = call('inspect_csv', csv=text)
    assert {c['name']: c['arms'] for c in seen['columns']}['dose'] == 2
    assert seen['mapping']['treatment'] == 'dose' and seen['mapping']['outcome'] == 'bought' and seen['mapping']['cost'] == 'spent'
    added = call('add_dataset', id='upload/doses', csv=text, name='doses.csv', mapping={'treatment': 'dose', 'outcome': 'bought', 'cost': 'spent', 'features': ['visits']})
    assert added['profile']['treatments'] == 2 and any('T=1~2' in c['text'] for c in added['profile']['checks'])
    result = call('run_all', dataset='upload/doses', algorithms=pick('t_learner', 'dml', 'duality_r_learner', 'random_baseline'), cycles=4)
    assert result['plan']['treatments'] == 2 and result['summary']['by'] == 'gain'
    last = result['cycles'][-1]['arms'][0]
    assert last['exploit']['n'] < last['selected'], 'rows logged under the other treatment cannot be measured'
    assert all('error' not in a['train'] for a in result['cycles'][-1]['arms'])
    gaps = '\n'.join(['t,y,x'] + [f'{i % 3 * 2},{i % 2},{i % 5}' for i in range(1200)])
    with pytest.raises(ValueError, match='정수'):
        datasets.parse(gaps, {'treatment': 't', 'outcome': 'y', 'features': ['x']})


def test_the_same_file_and_seed_reproduce_the_same_result():
    text = make_csv()
    algorithms = pick('t_learner', 'duality_r_learner', 'random_baseline')

    def run(dataset_id, csv, seed=42, mapping=None):
        call('add_dataset', id=dataset_id, csv=csv, name=dataset_id, mapping=mapping)
        result = call('run_all', dataset=dataset_id, algorithms=algorithms, cycles=3, seed=seed)
        arms = [{k: v for k, v in a.items() if k != 'trainMs'} for a in result['summary']['arms']]
        last = result['cycles'][-1]
        return arms, [i for i, explore in zip(last['trace']['ids'], last['trace']['explore']) if explore], last['explore']
    first = run('upload/first', text)
    assert run('upload/second', text) == first, 'a new upload of the same file is the same experiment'
    assert run('upload/crlf', text.replace('\n', '\r\n')) == first, 'line endings are not data'
    assert run('upload/semicolon', text.replace(',', ';')) == first, 'nor is the delimiter'
    assert run('upload/first', text, seed=7)[0] != first[0], 'another seed is another split'
    assert run('upload/changed', make_csv(seed=4))[0] != first[0], 'other rows are another experiment'
    narrower = run('upload/narrow', text, mapping={'treatment': 'treatment', 'outcome': 'converted', 'cost': 'cost', 'features': ['a', 'b']})
    assert narrower[1:] == first[1:], 'choosing other covariates keeps the same Explore group'


def test_each_cycle_keeps_rows_people_can_follow():
    algorithms = pick('t_learner', 'duality_r_learner')
    run = Run(SyntheticScenario('base', seed=42, cycles=2), algorithms)
    first, second = run.step(), run.step()
    trace = second['trace']
    n = len(trace['ids'])
    assert 100 <= n <= 116 and len(trace['X']) == len(trace['t']) == len(trace['y']) == len(trace['cost']) == len(trace['split']) == len(trace['tauR']) == n
    assert trace['ids'] != first['trace']['ids'], 'every cycle brings new people'
    for arm in second['arms']:
        ranks = trace['arms'][arm['arm']]['rank']
        assert all((rank is None) == explore for rank, explore in zip(ranks, trace['explore'])), 'explore rows are not ranked'
        assert sorted(r for r in ranks if r)[:8] == list(range(1, 9)), "each algorithm's top ranks are kept"
        chosen = [i for i, r in enumerate(ranks) if r and r <= arm['selected']]
        assert chosen and all(0 <= trace['t'][i] <= 1 for i in chosen)
    a, b = (trace['arms'][k]['rank'] for k in ('t_learner', 'duality_r_learner'))
    assert a != b, 'the same people, ranked differently'
    assert json.dumps(bridge.clean(trace)) and second['pool']['mean'] and len(second['arms'][0]['profile']) == 4
    picked, pool = second['arms'][1]['profile'], second['pool']['mean']
    assert picked[1] > pool[1], 'long-absent users have the largest effect on the base market'
    summary = {s['arm']: s for s in second['summary']['arms']}['duality_r_learner']
    assert abs(summary['R'] / summary['baseR'] - 1 - summary['gain']) < 1e-9
    assert abs(summary['truthR'] / summary['baseTruthR'] - 1 - summary['truthGain']) < 1e-9


def confounded_csv(n=6000, seed=9):
    rng = np.random.default_rng(seed)
    x = rng.random(n)
    t = (rng.random(n) < .2 + .6 * x).astype(int)
    y = (rng.random(n) < .2 + .2 * x + .1 * t).astype(int)
    return 'x,z,t,y,cost\n' + '\n'.join(f'{x[i]:.4f},{rng.random():.4f},{t[i]},{y[i]},{t[i] * y[i]}' for i in range(n))


def test_common_column_names_are_recognized():
    guess = lambda header, row: call('inspect_csv', csv=header + '\n' + '\n'.join(row(i) for i in range(1200)))['mapping']  # noqa: E731
    named = guess('user_id,visits,coupon,returned,coupon_cost', lambda i: f'{i},{i % 7},{i % 2},{i % 3 == 0:d},{(i % 2) * 1500}')
    assert named == {'treatment': 'coupon', 'outcome': 'returned', 'cost': 'coupon_cost', 'features': ['visits']}
    words = guess('age,is_treated,has_purchased', lambda i: f'{i % 60},{i % 2},{i % 5 == 0:d}')
    assert words['treatment'] == 'is_treated' and words['outcome'] == 'has_purchased' and words['cost'] is None and words['features'] == ['age']
    unknown = guess('a,b', lambda i: f'{i % 2},{i % 3}')
    assert unknown['treatment'] is None and unknown['features'] == ['a', 'b'], 'a name it cannot read is left for the user to choose'


def test_upload_checks_say_what_can_go_wrong():
    levels = lambda profile: {c['id']: c['level'] for c in profile['checks']}  # noqa: E731
    clean = call('add_dataset', id='upload/clean', csv=make_csv(), name='clean.csv')['profile']
    assert levels(clean)['balance'] == 'ok' and levels(clean)['cost'] == 'ok' and levels(clean)['size'] == 'warn'
    biased = call('add_dataset', id='upload/biased', csv=confounded_csv(), name='biased.csv')['profile']
    assert levels(biased)['balance'] == 'bad' and any('x ' in c['text'] for c in biased['checks'] if c['id'] == 'balance')


def test_text_columns_become_features_and_blanks_are_filled():
    rng = np.random.default_rng(11)
    rows = ['user_id,city,plan,visits,t,y,memo']
    for i in range(1500):
        rows.append(f"{i},{['Seoul', 'Busan', 'Jeju'][i % 3]},{['free', 'paid'][i % 2]},{'' if i % 50 == 0 else rng.integers(0, 30)},{rng.integers(0, 2)},{rng.integers(0, 2)},note {i}")
    text = '\n'.join(rows)
    seen = call('inspect_csv', csv=text)
    by_name = {c['name']: c for c in seen['columns']}
    assert by_name['city']['categorical'] and not by_name['memo']['categorical'] and by_name['visits']['numeric'] and by_name['visits']['missing'] == 30
    assert seen['mapping']['features'] == ['city', 'plan', 'visits'] and seen['mapping']['treatment'] == 't'
    added = call('add_dataset', id='upload/text', csv=text, name='text.csv')
    names = [f['name'] for f in added['profile']['features']]
    assert names == ['city=Busan', 'city=Jeju', 'city=Seoul', 'plan=paid', 'visits'] and added['mapping']['features'] == ['city', 'plan', 'visits']
    assert any(c['id'] == 'blanks' and '30개' in c['text'] for c in added['profile']['checks'])
    again = call('add_dataset', id='upload/text', csv=text, name='text.csv', mapping=added['mapping'])
    assert [f['name'] for f in again['profile']['features']] == names, 'a saved mapping loads the same way after a reload'
    with pytest.raises(ValueError, match='memo'):
        datasets.parse(text, {'treatment': 't', 'outcome': 'y', 'features': ['memo']})
    with pytest.raises(ValueError, match='처치 열'):
        datasets.parse(text.replace(',1,0,note 5', ',,0,note 5').replace(',0,0,note 5', ',,0,note 5').replace(',1,1,note 5', ',,1,note 5').replace(',0,1,note 5', ',,1,note 5'), {'treatment': 't', 'outcome': 'y', 'features': ['visits']})


def test_algorithm_files_import_only_common_libraries():
    """Built-ins and templates are files a data scientist can copy anywhere: no engine imports, nothing hidden."""
    imports = lambda code: {n.split('.')[0] for node in ast.walk(ast.parse(code)) for n in ([x.name for x in node.names] if isinstance(node, ast.Import) else [node.module or ''] if isinstance(node, ast.ImportFrom) else [])}  # noqa: E731
    for a in bridge.builtins('lite'):
        assert imports(a['code']) <= {'numpy', 'sklearn'}, ('the browser runs these, so no EconML', a['id'])
    for a in [*bridge.builtins('econml'), *bridge.builtins('lite'), *TEMPLATES.values()]:
        modules = imports(a['code'])
        assert modules <= {'numpy', 'sklearn', 'econml', 'lightgbm', 'torch'}, (a['id'], modules)
        assert a['name'] and a['summary'] and all(l['package'] != 'upliftlab' for l in a['libraries'])
    assert {l['package'] for l in TEMPLATES['start_lightgbm']['libraries']} == {'lightgbm', 'numpy'}
    assert importlib.util.find_spec('upliftlab.tools') is None


def test_check_names_libraries_and_says_what_to_do_when_one_is_missing():
    ok = call('check', code='import numpy as np\nfrom sklearn.linear_model import Ridge\nclass Model:\n    def fit(self, train, validation): pass\n    def predict(self, X): return X[:, 0]\n')
    assert ok['ok'] and [(l['package'], l['status']) for l in ok['libraries']] == [('numpy', 'ok'), ('scikit-learn', 'ok')]
    gone = call('check', code='import json\n\nimport not_a_real_package_xyz\nclass Model: pass\n', id='mine')
    assert not gone['ok'] and gone['line'] == 3 and 'pip install not_a_real_package_xyz' in gone['error']
    assert [(l['package'], l['status']) for l in gone['libraries']] == [('not_a_real_package_xyz', 'missing')], 'standard library is not listed'
    engine = call('check', code='import numpy as np\nfrom upliftlab.tools import ridge\nclass Model: pass\n')
    assert not engine['ok'] and engine['line'] == 2 and 'upliftlab' in engine['error']
    no_model = call('check', code='class Modle:\n    pass\n')
    assert not no_model['ok'] and 'class Model' in no_model['error']
    with pytest.raises(AssertionError, match='not_a_real_package_xyz'):
        call('run_start', dataset='synthetic/base', algorithms=[{'id': 'mine', 'name': '내 코드', 'code': 'import not_a_real_package_xyz\n'}])


def test_pep723_dependencies_are_read_without_running_the_file():
    code = '# /// script\n# requires-python = ">=3.10"\n# dependencies = [\n#   "scikit-uplift>=0.5",\n#   \'econml\',\n# ]\n# ///\nimport sklift\n'
    assert contract.requirements(code) == ['scikit-uplift>=0.5', 'econml']
    assert contract.describe(code)['imports'] == ['sklift'] and contract.package_of('sklift') == 'scikit-uplift'
    assert contract.pending([code]) == ['scikit-uplift>=0.5'] + ([] if importlib.util.find_spec('econml') else ['econml'])
    assert contract.pending(['# /// script\n# dependencies = ["numpy"]\n# ///\n']) == [], 'already installed'
    assert contract.requirements('import numpy\n') == []


def test_fit_may_skip_context_and_predict_may_return_a_plain_array():
    code = 'import numpy as np\nNAME = "두 인자"\nclass Model:\n    def fit(self, train, validation):\n        self.j = int(np.argmax(np.abs(np.corrcoef(train.X.T, train.y)[-1, :-1])))\n        assert train.features == validation.features and len(train.features) == train.X.shape[1]\n    def predict(self, X):\n        return list(X[:, self.j])\n'
    out = call('try_algorithm', code=code, id='two')
    assert out['ok'] and out['name'] == '두 인자' and out['auccTruth'] is not None


@pytest.mark.parametrize('key', ['start_sklearn', 'start_lightgbm', 'start_pytorch'])
def test_templates_pass_the_quick_check(key):
    template = TEMPLATES[key]
    for l in template['libraries']:
        if importlib.util.find_spec(l['module']) is None:
            pytest.skip(f"{l['package']} is not installed")
    out = call('try_algorithm', code=template['code'], id=key, name=template['name'])
    assert out['ok'], out
    assert out['auccTruth'] > .55, 'each starter should beat random on the base market'
    assert out['qiniTruth'] is not None and out['upliftAtTruth'] > 0 and out['upliftK'] == .4


@pytest.mark.parametrize('key', ['start_sklearn', 'start_lightgbm', 'start_pytorch'])
def test_templates_run_with_several_treatments(key):
    template = TEMPLATES[key]
    for l in template['libraries']:
        if importlib.util.find_spec(l['module']) is None:
            pytest.skip(f"{l['package']} is not installed")
    run = Run(SyntheticScenario('tiers', seed=1, cycles=3, pool=6000), [{'id': key, 'name': key, 'code': template['code']}])
    out = [run.step() for _ in range(3)][-1]
    row, summary = out['arms'][0], out['summary']['arms'][0]
    assert row['error'] is None and 'error' not in row['train'], (key, row)
    assert sum(row['armCounts']) == row['selected']
    assert summary['truthGain'] > .1 and summary['armShare'][2] < .9, 'every starter weighs cost, so it does not put everyone on the largest reward'


def test_knapsack_with_one_treatment_is_the_greedy_order_of_value_per_cost():
    rng = np.random.default_rng(3)
    value, cost = rng.normal(.5, 1, (500, 1)), rng.uniform(.2, 3, (500, 1))
    best, net = knapsack(value, cost, 60.)
    picked = net > 0
    order = np.argsort(-(value / cost)[:, 0])
    order = order[value[order, 0] > 0]
    take = int(np.searchsorted(np.cumsum(cost[order, 0]), 60., side='right'))
    assert set(np.flatnonzero(picked).tolist()) == set(order[:take].tolist()) and cost[picked, 0].sum() <= 60. and (best == 0).all()


def test_knapsack_picks_among_treatments_and_stays_within_the_budget():
    value, cost = np.array([[1., 1.5], [.2, .25], [-1., -2.]]), np.array([[1., 3.], [1., 1.2], [1., 1.]])
    best, net = knapsack(value, cost, 100.)
    assert best[:2].tolist() == [1, 1] and net[0] > 0 and net[1] > 0 and net[2] <= 0, 'with money to spare each user takes the largest effect'
    best, net = knapsack(value, cost, 1.)
    assert best[0] == 0 and net[0] > 0 and net[1] <= 0, 'a tight budget buys the cheaper treatment and drops the weakest user'


def test_rules_that_weigh_cost_keep_the_order_of_a_score_that_is_not_an_effect():
    score, one, cost, gain = np.array([.9, .5, .1]), np.ones(3, dtype=np.int64), np.array([[3.], [1.], [1.]]), np.array([[1.], [1.], [1.]])
    for mode, extra in (('knapsack', {'budget': 3.5}), ('roi', {'efficiency': .1})):
        assert select(mode, score, None, one, score[:, None], False, 1, cost, gain, **extra)[0].tolist() == [0, 1, 2]
        assert select(mode, score, None, one, score[:, None], True, 1, cost, gain, **extra)[0].tolist() == [1, 0, 2], 'an effect is read per unit of cost'
    assert select('roi', score, None, one, score[:, None], True, 1, cost, gain, efficiency=.75)[1] == 1, 'cumulative efficiency 1, .5, .6: only the first user keeps .75'
    assert select('roi', score, None, one, score[:, None], True, 1, cost, gain, efficiency=.55)[1] == 3, 'the group ends at the last user that keeps the target, not the first miss'
    assert select('roi', score, None, one, score[:, None], True, 1, cost, gain, efficiency=9.)[1] == 0, 'no user reaches the target, so nobody is treated'
    assert select('validation', score, None, one, None, True, 1, cutoff=.67)[1] == 2
    assert select('validation', score, None, one, None, True, 1)[1] == 1, 'no cutoff yet means the default share'


def test_best_cutoff_finds_where_the_total_uplift_peaks():
    n = 400
    score, t, arm = np.arange(n, 0, -1, dtype=np.float64), np.arange(n) % 2, np.ones(n, dtype=np.int64)
    y = t * np.where(np.arange(n) < n // 2, 1., -1.)
    assert best_cutoff(score, arm, t, y) == pytest.approx(.5, abs=.02)
    assert best_cutoff(score, arm, np.zeros(n, dtype=np.int64), y) is None


def test_a_knapsack_spends_the_same_budget_better_when_the_score_is_an_effect():
    runs = {}
    for mode in ('budget', 'knapsack'):
        run = Run(SyntheticScenario('tiers', seed=42, cycles=4), pick('t_learner', 'duality_r_learner', 'random_baseline'), mode=mode, budget=.4)
        runs[mode] = [run.step() for _ in range(4)]
    assert runs['knapsack'][0]['arms'][0]['selected'] == round(16000 * .4), 'cycle 1 has no cost estimate yet'
    for out in runs['knapsack'][1:]:
        for row in out['arms']:
            assert row['planned'] <= out['budget'] and row['planned'] > out['budget'] * .98
    arms = {m: {s['arm']: s for s in r[-1]['summary']['arms']} for m, r in runs.items()}
    assert arms['knapsack']['t_learner']['truthIncR'] > arms['budget']['t_learner']['truthIncR'] * 1.2
    assert runs['knapsack'][-1]['summary']['by'] == 'truthIncR'
    assert arms['knapsack']['duality_r_learner']['truthIncR'] == arms['budget']['duality_r_learner']['truthIncR'], 'its score already holds cost, so it keeps its order'
    assert arms['knapsack']['random_baseline']['truthIncR'] == arms['budget']['random_baseline']['truthIncR'], 'the baseline stays random'


def test_an_efficiency_target_sizes_the_group_and_ranks_those_who_met_it_first():
    outs = {}
    for target in (.2, .5):
        run = Run(SyntheticScenario('base', seed=42, cycles=4), pick('t_learner', 'random_baseline'), mode='roi', efficiency=target)
        outs[target] = [run.step() for _ in range(4)]
    last = {k: {s['arm']: s for s in v[-1]['summary']['arms']} for k, v in outs.items()}
    assert outs[.2][0]['arms'][0]['selected'] == round(16000 * .4) and outs[.2][0]['efficiencyTarget'] is None
    assert outs[.2][1]['efficiencyTarget'] < outs[.5][1]['efficiencyTarget']
    assert last[.5]['t_learner']['selected'] < last[.2]['t_learner']['selected'], 'a higher target buys a smaller group'
    assert last[.2]['t_learner']['meets'] is True and last[.2]['t_learner']['rank'] == 1
    assert last[.2]['t_learner']['truthGain'] == pytest.approx(.2, abs=.05), 'the shared estimate holds the realized efficiency near the target'
    assert last[.2]['random_baseline']['selected'] < 100, 'a random order cannot keep the target'
    tiers = Run(SyntheticScenario('tiers', seed=42, cycles=4), pick('t_learner', 'random_baseline'), mode='roi', efficiency=.5)
    summary = [tiers.step() for _ in range(4)][-1]['summary']
    ranked = sorted(summary['arms'], key=lambda s: s['rank'])
    assert ranked[-1]['truthIncR'] is None and ranked[0]['meets'] is False and summary['leader'] == 't_learner', 'no result ranks after a missed target'


def test_validation_cutoff_is_reported_and_applied():
    run = Run(SyntheticScenario('base', seed=42, cycles=3), pick('t_learner', 'random_baseline'), mode='validation', target=.3)
    outs = [run.step() for _ in range(3)]
    assert all(r['cutoff'] is None and r['selected'] == round(16000 * .3) for r in outs[0]['arms'])
    for row in outs[1]['arms']:
        assert 0 < row['cutoff'] <= 1 and row['selected'] == round(row['cutoff'] * 16000)
    assert outs[-1]['summary']['by'] == 'truthIncR'
    with pytest.raises(ValueError, match='효율'):
        Run(SyntheticScenario('base'), pick('t_learner'), mode='roi', efficiency=9)



def test_example_log_reads_like_a_real_export_and_passes_the_checks():
    out = bridge.sample_csv()
    info = datasets.inspect(out['csv'])
    assert out['name'].endswith('.csv') and info['rows'] == 40000
    assert info['mapping'] == {'treatment': 'treatment', 'outcome': 'retained', 'cost': 'coupon_cost',
                               'features': ['visit_freq', 'days_since_last', 'price_sensitivity', 'avg_order_value']}, 'the upload screen guesses every role'
    added = bridge.add_dataset('upload/example', out['csv'], 'example', info['mapping'])
    assert all(c['level'] == 'ok' for c in added['profile']['checks'])
    assert 0.45 < added['profile']['treatedShare'] < 0.55 and added['profile']['ate'] > 0
    assert bridge.sample_csv()['csv'] == out['csv'], 'the same file every time'


def test_local_ui_is_the_web_folder(tmp_path):
    from upliftlab import server
    assert server.ui_root().name == 'web', 'a source checkout serves web/'
    (tmp_path / 'index.html').write_text('<!doctype html>')
    assert server.ui_root(str(tmp_path)) == tmp_path.resolve()
    with pytest.raises(SystemExit):
        server.ui_root(str(tmp_path / 'missing'))


def test_the_package_ships_every_file_the_ui_loads():
    """pyproject.toml installs web/ as upliftlab.ui, so `pip install git+…` serves the same screen. A new file or folder in
    web/ that the globs miss would be missing from the local edition."""
    import re
    root = Path(__file__).resolve().parents[1]
    block = re.search(r'"upliftlab\.ui" = \[(.*?)\]', (root / 'pyproject.toml').read_text().split('[tool.setuptools.package-data]')[1]).group(1)
    globs = re.findall(r'"([^"]+)"', block)
    shipped = {p for g in globs for p in (root / 'web').glob(g) if p.is_file()}
    present = {p for p in (root / 'web').rglob('*') if p.is_file() and p.name != 'README.md'}
    assert present - shipped == set(), sorted(str(p.relative_to(root)) for p in present - shipped)
    assert (root / 'web' / 'index.html') in shipped and (root / 'web' / 'views' / 'results.js') in shipped


def test_each_builtin_has_an_econml_file_and_a_lite_file_with_the_same_name():
    """Locally the built-ins are EconML; the browser has no EconML and runs the scikit-learn files in algorithms/lite."""
    econml, lite = bridge.builtins('econml'), bridge.builtins('lite')
    assert [a['id'] for a in econml] == [a['id'] for a in lite] == list(BUILTINS)
    for full, small in zip(econml, lite):
        assert full['name'] == small['name']
        if full['id'] == 'random_baseline':
            assert full['file'] == small['file'] == 'upliftlab/algorithms/random_baseline.py'
            continue
        assert 'econml' in {l['module'] for l in full['libraries']} and full['file'] == f"upliftlab/algorithms/{full['id']}.py"
        assert small['file'] == f"upliftlab/algorithms/lite/{small['id']}.py" and '경량판' in small['code']
    expected = 'econml' if importlib.util.find_spec('econml') else 'lite'
    assert bridge.implementation() == expected and {a['implementation'] for a in bridge.builtins()} == {expected}


def test_criteo_sample_is_bundled_mapped_and_still_randomized():
    """The 200k-row Criteo sample ships with the site and the package; it was drawn by treatment only, so it stays an RCT."""
    meta = next(d for d in datasets.PUBLIC if d['id'] == 'public/criteo')
    data = datasets.parse(datasets.fetch('public/criteo'), meta['mapping'])
    assert len(data.t) == meta['rows'] == 199837 and data.features == [f'f{i}' for i in range(12)]
    assert abs(data.t.mean() - .5) < .01 and set(np.unique(data.y)) == {0., 1.} and np.all(data.cost == data.t)
    ate = data.y[data.t == 1].mean() - data.y[data.t == 0].mean()
    assert .008 < ate < .012, 'the visit uplift of the full Criteo data is about +1.0%p'
    checks = {c['id']: c['level'] for c in datasets.quality(data.X, data.t, data.y, data.cost, data.features)}
    assert set(checks.values()) == {'ok'}, checks
    assert [d['id'] for d in datasets.catalog()] == ['public/criteo'], 'the app lists the public experiment; synthetic data stays engine-only'
    assert call('describe_dataset', id='synthetic/base')['profile']['truth'], 'the quick check and the CLI still use the synthetic experiment'
    bridge.state.update(runtime='local')
    try:
        assert bridge.fetch_dataset('public/criteo')['mapping']['outcome'] == 'visit'
    finally:
        bridge.state.update(runtime='browser')

