"""Head-to-head runs: every algorithm runs the same production loop on the same users.

Each cycle a random explore share of the candidates is split into treatment and control. It is identical for every
algorithm: it is the training data and the baseline. Each algorithm's deployed model ranks the remaining candidates, and a
selection rule turns that into its exploit group (see select()). That group is split into treatment and control again so
the online effect can be measured. After the cycle every algorithm retrains on the recent explore window and its new model
serves the next cycle. Cycle 1 has no model yet, so every algorithm starts from the same random selection.
"""
import time

import numpy as np

from . import contract
from .metrics import aucc, cell, cost_curve, qini, uplift_at
from .scenario import SyntheticScenario, seed_of

DRAWS = 200
TRACE_SAMPLE, TRACE_TOP, TRACE_FEATURES = 100, 8, 20  # rows kept per cycle for the row table: a random sample plus each algorithm's top ranks
MODES = ('quantile', 'budget', 'knapsack', 'roi', 'validation')
BUDGET_MODES = ('budget', 'knapsack')
BASE_LEARNERS = ('ridge', 'tree')


def boot(t, yr, yc, seed, draws=DRAWS):
    """Bootstrap draws of (ATEʳ, ATEᶜ), resampling treatment and control separately."""
    rng, means = np.random.default_rng(seed), []
    for mask in (t > 0, t == 0):
        r, c = yr[mask], yc[mask]
        if not len(r):
            return None
        i = rng.integers(0, len(r), (draws, len(r)))
        means.append((r[i].mean(1), c[i].mean(1)))
    (rt, ct), (rc, cc) = means
    return rt - rc, ct - cc


def interval(values):
    v = np.sort(values[np.isfinite(values)])
    return [float(v[int(len(v) * .025)]), float(v[max(0, int(np.ceil(len(v) * .975)) - 1)])] if len(v) > 10 else [None, None]


def relative(top, base):
    with np.errstate(divide='ignore', invalid='ignore'):
        return top / base - 1


def ratio_of(draws):
    """Bootstrap draws of cost effectiveness. A very small group can have no cost difference in a draw; interval() skips those."""
    with np.errstate(divide='ignore', invalid='ignore'):
        return draws[0] / draws[1]


def splits(log, scenario):
    cat = {k: np.concatenate([b[k] for b in log]) for k in ('X', 't', 'y', 'cost', 'split')}
    masks = {'train': cat['split'] < .6, 'validation': (cat['split'] >= .6) & (cat['split'] < .8), 'test': cat['split'] >= .8}
    sets = {k: contract.dataset(cat['X'][m], cat['t'][m], cat['y'][m], cat['cost'][m], scenario.propensity, scenario.features, scenario.treatments, scenario.propensities) for k, m in masks.items()}
    if log[0]['tau_r'] is not None:
        tau_r, tau_c = np.concatenate([b['tau_r'] for b in log]), np.concatenate([b['tau_c'] for b in log])
        sets['test'].tau_r, sets['test'].tau_c = tau_r[masks['test']], tau_c[masks['test']]
    return sets


def _policy(model, data):
    """Scores with the treatment each row would get. Only rows logged as control or as that treatment can be measured."""
    score, _, arm = contract.scores(model, data.X, data.treatments)
    return score, arm, (data.t == 0) | (data.t == arm)


def _truth_of(tau, arm):
    return tau if tau.ndim == 1 else tau[np.arange(len(tau)), arm - 1]


def evaluate(model, test, target):
    score, arm, keep = _policy(model, test)
    curve = cost_curve(score[keep], test.t[keep], test.y[keep], test.cost[keep])
    out = {'n': int(keep.sum()), 'curve': curve, 'aucc': aucc(curve), 'qini': qini(curve), 'upliftAt': uplift_at(score[keep], target, test.t[keep], test.y[keep]), 'upliftK': target,
           'truthCurve': None, 'auccTruth': None, 'qiniTruth': None, 'upliftAtTruth': None}
    if hasattr(test, 'tau_r'):
        tau_r, tau_c = _truth_of(test.tau_r, arm), _truth_of(test.tau_c, arm)
        truth = cost_curve(score, None, None, None, tau_r=tau_r, tau_c=tau_c)
        out.update(truthCurve=truth, auccTruth=aucc(truth), qiniTruth=qini(truth), upliftAtTruth=uplift_at(score, target, tau_r=tau_r))
    return out


def fit(algorithm, sets, seed, cycle, target, device, report, base_learner='ridge'):
    model_type, meta = contract.load(algorithm['code'], f"{algorithm['id']}.py")
    s = seed_of(seed, 'fit', cycle)
    ctx = contract.Context(seed=s, model_seed=s % 2 ** 31, device=device, target_fraction=target, cycle=cycle, segment='all', base_learner=base_learner, treatments=sets['train'].treatments,
                           _emit=lambda m: report({'cycle': cycle, 'arm': algorithm['id'], 'phase': 'train', **m}))
    np.random.seed(ctx.model_seed)
    model = contract.instantiate(model_type)
    started = time.perf_counter()
    contract.fit(model, sets['train'], sets['validation'], ctx)
    ms = (time.perf_counter() - started) * 1000
    v = sets['validation']
    score, _, keep = _policy(model, v)
    val = aucc(cost_curve(score[keep], v.t[keep], v.y[keep], v.cost[keep]))
    return model, {'ms': ms, 'val': val, 'name': meta['name']}


def _ridge(X, y, alpha=1.):
    if len(y) <= X.shape[1]:  # a treatment with almost no rows in the window: fall back to its average
        level = float(y.mean()) if len(y) else 0.
        return lambda A: np.full(len(A), level)
    mean, std = X.mean(0), X.std(0) + 1e-9
    Z = (X - mean) / std
    coef = np.linalg.solve(Z.T @ Z + alpha * np.eye(X.shape[1]), Z.T @ (y - y.mean()))
    return lambda A: y.mean() + ((A - mean) / std) @ coef


def _difference_from_control(log, treatments, field):
    cat = {k: np.concatenate([b[k] for b in log]) for k in ('X', 't', field, 'split')}
    train = cat['split'] < .6
    X, t, value = cat['X'][train], cat['t'][train], cat[field][train]
    control = _ridge(X[t == 0], value[t == 0])
    arms = [_ridge(X[t == k], value[t == k]) for k in range(1, treatments + 1)]
    return lambda A: np.column_stack([arm(A) - control(A) for arm in arms])


def cost_estimator(log, treatments):
    """Expected incremental cost per user and treatment, learned from the shared Explore train rows.

    Every algorithm is held to the same estimate, so a budget constrains them all the same way.
    """
    difference = _difference_from_control(log, treatments, 'cost')

    def estimate(A):
        out = difference(A)
        return np.maximum(out, max(1e-3 * float(np.abs(out).mean()), 1e-12))
    return estimate


def gain_estimator(log, treatments):
    """Expected incremental outcome per user and treatment. It holds every algorithm to the same efficiency estimate, as cost_estimator does."""
    return _difference_from_control(log, treatments, 'y')


def knapsack(value, cost, budget):
    """The multiple-choice knapsack through its Lagrangian dual.

    At price λ each user takes the treatment with the largest value − λ·cost, or none if that is not positive. Bisection finds
    the lowest price the budget can pay for. With one treatment this is the greedy order of value / cost. Returns the treatment
    index per user and that user's value − λ·cost.
    """
    rows = np.arange(len(value))

    def spend(price):
        net = value - price * cost
        best = net.argmax(1)
        return float(cost[rows, best][net[rows, best] > 0].sum())
    price = 0.
    if spend(0.) > budget:
        ratio = value / cost
        low, price = 0., float(ratio[np.isfinite(ratio)].max())
        for _ in range(60):
            middle = (low + price) / 2
            if spend(middle) > budget:
                low = middle
            else:
                price = middle
    net = value - price * cost
    best = net.argmax(1)
    return best, net[rows, best]


def best_cutoff(score, arm, t, y):
    """The share of validation rows, in score order, where the total observed uplift peaks. None without both groups to compare."""
    keep = (t == 0) | (t == arm)
    order = np.argsort(-score[keep], kind='stable')
    treated, outcome = t[keep][order] > 0, y[keep][order]
    if not treated.any() or treated.all():
        return None
    n_t, n_c = np.cumsum(treated), np.cumsum(~treated)
    y_t, y_c = np.cumsum(outcome * treated), np.cumsum(outcome * ~treated)
    both = np.flatnonzero((n_t > 0) & (n_c > 0))
    total = (y_t[both] / n_t[both] - y_c[both] / n_c[both]) * (both + 1)
    grid = np.unique(np.searchsorted(both, np.ceil(np.arange(1, 101) / 100 * len(order)).astype(np.int64) - 1).clip(max=len(both) - 1))  # 1% steps
    return float((both[grid[total[grid].argmax()]] + 1) / len(order))


def select(mode, score, eligible, chosen, matrix, effect, default, unit_cost=None, unit_gain=None, budget=None, efficiency=None, cutoff=None):
    """Who is treated this cycle: the candidates in order, how many from the top, each one's treatment, and the planned cost.

    quantile    the top share by score
    budget      by score, up to the user just before the budget runs out
    knapsack    value − λ·cost > 0, with λ set so that the spend meets the budget; this also picks the treatment
    roi         by value / cost, up to the last user at which the expected efficiency still meets the target
    validation  by score, up to the share where the total uplift peaked on the validation rows

    `effect` says the score is an expected effect. Otherwise knapsack and roi keep the model's order: dividing a random score or
    an effect net of cost by cost has no meaning. Without an estimate yet (cycle 1), every rule takes the default share.
    """
    key = score if eligible is None else np.where(eligible, score, -np.inf)
    take, positive, spend = default, None, None
    if mode == 'validation' and cutoff is not None:
        take = round(cutoff * len(score))
    if unit_cost is not None:
        if effect and mode in ('knapsack', 'roi'):
            value = matrix if eligible is None else np.where(eligible[:, None], matrix, -np.inf)
            if mode == 'knapsack':
                best, key = knapsack(value, unit_cost, budget)
            else:
                ratio = value / unit_cost
                best = ratio.argmax(1)
                key = ratio[np.arange(len(best)), best]
            chosen, positive = best + 1, int((key > 0).sum())
    order = np.argsort(-key, kind='stable')
    if unit_cost is not None:
        spend = np.cumsum(unit_cost[order, chosen[order] - 1])
        if mode in BUDGET_MODES:
            take = int(np.searchsorted(spend, budget, side='right'))
        else:
            reachable = np.flatnonzero(np.cumsum(unit_gain[order, chosen[order] - 1]) >= efficiency * spend)
            take = int(reachable[-1]) + 1 if len(reachable) else 0
    if positive is not None:
        take = min(take, positive)
    if eligible is not None:
        take = min(take, int(eligible.sum()))
    planned = None if spend is None else float(spend[take - 1]) if take else 0.
    return order, take, chosen, planned


def trace(pop, ex, cand, picks, seed, cycle):
    """A sample of one cycle's rows so people can follow them: what each algorithm scored them, and what happened.

    With one treatment, T, outcome and cost are fixed per person, so a row reads the same for every algorithm that selected
    it. With several treatments they depend on the treatment each algorithm chose, so they are kept per algorithm.
    Rows no algorithm selected were never treated or measured; the screen shows them as such.
    """
    n, K = len(pop), pop.treatments
    keep = set(np.random.default_rng(seed_of(seed, 'trace', cycle)).choice(n, size=min(TRACE_SAMPLE, n), replace=False).tolist())
    for order, _, _ in picks.values():
        keep.update(cand[order[:TRACE_TOP]].tolist())
    idx = np.array(sorted(keep))
    t = pop.assign(idx)
    y, cost = pop.outcome(idx, t)
    explore = np.zeros(n, dtype=bool)
    explore[ex] = True
    round3 = lambda a: np.round(np.asarray(a, dtype=np.float64), 3).tolist()  # noqa: E731
    arms = {}
    for arm_id, (order, score, chosen) in picks.items():
        rank, full = np.zeros(n, dtype=np.int64), np.full(n, np.nan)
        rank[cand[order]] = np.arange(1, len(cand) + 1)
        full[cand] = score
        arms[arm_id] = {'rank': [int(r) or None for r in rank[idx]], 'score': [None if np.isnan(v) else float(f'{v:.4g}') for v in full[idx]]}
        if K > 1:
            plan = pop.explore_arm(np.arange(n))
            plan[cand] = chosen
            given = pop.assign(idx, plan[idx])
            yr, yc = pop.outcome(idx, given)
            arms[arm_id].update(arm=[int(a) for a in plan[idx]], t=[int(v) for v in given], y=round3(yr), cost=round3(yc))
            if pop.tau_r is not None:
                tr, tc = pop.truth(idx, plan[idx])
                arms[arm_id].update(tauR=round3(tr), tauC=round3(tc))
    out = {'ids': [pop.ids[i] for i in idx], 'X': np.round(pop.X[idx][:, :TRACE_FEATURES], 3).tolist(), 'explore': explore[idx].tolist(),
           't': [int(v) for v in t], 'y': round3(y), 'cost': round3(cost),
           'split': ['train' if u < .6 else 'validation' if u < .8 else 'test' for u in pop.u_split[idx]], 'arms': arms}
    if pop.tau_r is not None and K == 1:
        out.update(tauR=round3(pop.tau_r[idx]), tauC=round3(pop.tau_c[idx]))
    return out


class Arm:
    def __init__(self, algorithm):
        self.algorithm = {'id': algorithm['id'], 'name': algorithm.get('name') or algorithm['id'], 'code': algorithm['code']}
        self.id, self.name = self.algorithm['id'], self.algorithm['name']
        self.model, self.version, self.rows, self.served = None, 0, [], []


class Run:
    def __init__(self, scenario, algorithms, explore=.2, target=.4, seed=42, window=3, device='cpu', mode='quantile', budget=.4, base_learner='ridge', efficiency=.2):
        if not algorithms:
            raise ValueError('알고리즘을 하나 이상 고르세요.')
        if len({a['id'] for a in algorithms}) != len(algorithms):
            raise ValueError('같은 알고리즘이 두 번 들어 있어요.')
        if not (0 < explore < 1 and 0 < target <= 1 and 0 < budget <= 1):
            raise ValueError('Explore 비율, Exploit 비율, 예산 비율은 0과 1 사이여야 해요.')
        if not 0 <= efficiency <= 5:
            raise ValueError('최소 효율 개선은 0과 5 사이여야 해요.')
        if mode not in MODES:
            raise ValueError(f'알 수 없는 선정 방식이에요: {mode}')
        if base_learner not in BASE_LEARNERS:
            raise ValueError(f'알 수 없는 기본 모델이에요: {base_learner}')
        self.scenario, self.explore, self.target, self.seed, self.window, self.device = scenario, explore, target, seed, window, device
        self.mode, self.budget, self.base_learner, self.efficiency = mode, budget, base_learner, efficiency
        self.arms = [Arm(a) for a in algorithms]
        self.cycle, self.log = 0, []

    @property
    def done(self):
        return self.cycle >= self.scenario.cycles

    @property
    def share(self):
        """The share of candidates that uplift@k and cycle 1 use: q, or the budget share under a budget."""
        return self.budget if self.mode in BUDGET_MODES else self.target

    def plan(self):
        n = self.scenario.pool
        k = round(n * self.explore)
        return {'cycles': self.scenario.cycles, 'pool': n, 'exploreN': k, 'selectedN': round((n - k) * self.share), 'explore': self.explore,
                'target': self.target, 'seed': self.seed, 'window': self.window, 'truth': self.scenario.truth, 'features': list(self.scenario.features),
                'mode': self.mode, 'budget': self.budget, 'efficiency': self.efficiency, 'baseLearner': self.base_learner, 'treatments': self.scenario.treatments, 'labels': list(self.scenario.labels),
                'algorithms': [{'id': a.id, 'name': a.name} for a in self.arms]}

    def step(self, report=lambda message: None):
        if self.done:
            raise ValueError('이미 끝난 실행이에요.')
        self.cycle += 1
        c, pop = self.cycle, self.scenario.cohort(self.cycle)
        n, K = len(pop), pop.treatments
        order = np.argsort(pop.u_explore, kind='stable')
        k = round(n * self.explore)
        ex, cand = order[:k], order[k:]
        t_ex = pop.assign(ex)
        yr_ex, yc_ex = pop.outcome(ex, t_ex)
        explore = cell(t_ex, yr_ex, yc_ex)
        ex_boot = boot(t_ex, yr_ex, yc_ex, seed_of(self.seed, 'boot', 'explore', c))
        truth = pop.tau_r is not None
        ex_truth = None
        if truth:
            ex_tr, ex_tc = pop.truth(ex, pop.explore_arm(ex))
            ex_truth = (float(ex_tr.sum()), float(ex_tc.sum()))
            explore['truthR'] = ex_truth[0] / ex_truth[1]
        m = round(len(cand) * self.share)
        v0 = np.random.default_rng(seed_of(self.seed, 'v0', c)).random(len(cand))
        v0_arm = np.ones(len(cand), dtype=np.int64)
        if K > 1:
            v0_arm = 1 + np.random.default_rng(seed_of(self.seed, 'v0-arm', c)).integers(0, K, len(cand))
        unit_cost, unit_gain, budget_total, efficiency_target, held_out = None, None, None, None, None
        if self.log:  # cycle 1 has no estimate yet, so every rule selects the same share at random
            if self.mode in BUDGET_MODES or self.mode == 'roi':
                unit_cost = cost_estimator(self.log, K)(pop.X[cand])
            if self.mode in BUDGET_MODES:
                budget_total = self.budget * float(unit_cost.mean(1).sum())
            if self.mode == 'roi':
                unit_gain = gain_estimator(self.log, K)(pop.X[cand])
                efficiency_target = (1 + self.efficiency) * max(float(unit_gain.mean(1).sum() / unit_cost.mean(1).sum()), 0.)
            if self.mode == 'validation':
                held_out = {k: np.concatenate([b[k] for b in self.log]) for k in ('X', 't', 'y', 'split')}
                inside = (held_out['split'] >= .6) & (held_out['split'] < .8)
                held_out = {k: v[inside] for k, v in held_out.items()}
        rows, picks = [], {}
        for arm in self.arms:
            report({'cycle': c, 'arm': arm.id, 'phase': 'score'})
            row = {'cycle': c, 'arm': arm.id, 'version': arm.version, 'error': None}
            score, eligible, chosen, matrix, effect, cutoff, started = v0, None, v0_arm, None, False, None, time.perf_counter()
            if arm.model is not None:
                try:
                    score, eligible, chosen, matrix = contract.decide(arm.model, pop.X[cand], K)
                    effect = getattr(arm.model, 'score_is_effect', True)
                    if held_out is not None:
                        v_score, _, v_arm = contract.scores(arm.model, held_out['X'], K)
                        cutoff = best_cutoff(v_score, v_arm, held_out['t'], held_out['y'])
                except Exception as error:  # a model that cannot score falls back to random for this cycle
                    score, eligible, chosen, matrix, effect, cutoff, row['error'] = v0, None, v0_arm, None, False, None, f'predict · {contract.explain(error)}'
            row['scoringMs'] = (time.perf_counter() - started) * 1000
            order_sel, take, chosen, planned = select(self.mode, score, eligible, chosen, matrix, effect, m, unit_cost, unit_gain, budget_total, efficiency_target, cutoff)
            sel, sel_arm = cand[order_sel[:take]], chosen[order_sel[:take]]
            picks[arm.id] = (order_sel, score, chosen)
            t_sel = pop.assign(sel, sel_arm)
            measured = (t_sel == 0) | (t_sel == sel_arm)  # with logged data, a row logged under another treatment says nothing about this one
            t_sel = t_sel[measured]
            yr_sel, yc_sel = pop.outcome(sel[measured], t_sel)
            exploit = cell(t_sel, yr_sel, yc_sel)
            sel_boot = boot(t_sel, yr_sel, yc_sel, seed_of(self.seed, 'boot', arm.id, c))
            row.update(selected=int(take), exploit=exploit, R=exploit['R'], gain=None, ci=[None, None], profile=pop.X[sel].mean(0).tolist() if take else None,
                       incR=None if exploit['ateR'] is None else exploit['ateR'] * take, incC=None if exploit['ateC'] is None else exploit['ateC'] * take, planned=planned, cutoff=cutoff)
            if K > 1:
                row['armCounts'] = np.bincount(sel_arm.astype(np.intp), minlength=K + 1)[1:].tolist()  # the browser's Python is 32-bit: bincount refuses int64 there
            if exploit['R'] is not None and explore['R']:
                row['gain'] = exploit['R'] / explore['R'] - 1
            if sel_boot and ex_boot:
                row['ci'] = interval(relative(ratio_of(sel_boot), ratio_of(ex_boot)))
            if truth:
                tr_v, tc_v = pop.truth(sel, sel_arm)
                tr, tc = float(tr_v.sum()), float(tc_v.sum())
                row.update(truthR=tr / tc if tc else None, truthGain=(tr / tc) / explore['truthR'] - 1 if tc else None, truthIncR=tr, truthIncC=tc)
            if arm.version > 0 and sel_boot and ex_boot:
                arm.served.append({'w': take, 'sel': exploit, 'ex': explore, 'selBoot': sel_boot, 'exBoot': ex_boot,
                                   'truth': (tr, tc, ex_truth[0] / k * take, ex_truth[1] / k * take) if truth else None, 'armCounts': row.get('armCounts')})
            arm.rows.append(row)
            rows.append(row)
        self.log.append({'cycle': c, 'X': pop.X[ex], 't': t_ex, 'y': yr_ex, 'cost': yc_ex, 'split': pop.u_split[ex],
                         'tau_r': pop.tau_r[ex] if truth else None, 'tau_c': pop.tau_c[ex] if truth else None})
        self.log = [b for b in self.log if b['cycle'] > c - self.window]
        sets = splits(self.log, self.scenario)
        for arm, row in zip(self.arms, rows):
            report({'cycle': c, 'arm': arm.id, 'phase': 'train'})
            try:
                model, out = fit(arm.algorithm, sets, self.seed, c, self.share, self.device, report, self.base_learner)
                row['train'] = {**out, **evaluate(model, sets['test'], self.share), 'version': arm.version + 1}
                arm.model, arm.version = model, arm.version + 1
            except Exception as error:  # keep serving the previous model, as production would
                row['train'] = {'error': contract.explain(error)}
            report({'cycle': c, 'arm': arm.id, 'phase': 'done'})
        return {'cycle': c, 'done': self.done, 'n': n, 'candidates': int(len(cand)), 'explore': explore, 'budget': budget_total, 'efficiencyTarget': efficiency_target,
                'pool': {'mean': pop.X[cand].mean(0).tolist(), 'std': pop.X[cand].std(0).tolist()}, 'trace': trace(pop, ex, cand, picks, self.seed, c),
                'window': {'cycles': [b['cycle'] for b in self.log], 'rows': int(sum(len(b['t']) for b in self.log)), 'split': {k: int(len(v.t)) for k, v in sets.items()}},
                'arms': rows, 'summary': self.summary()}

    def summary(self):
        """Pooled over the cycles each algorithm served with its own model (cycle 2 onward).

        A fixed share ranks by efficiency gain, since every algorithm treats as many users. Under a budget every algorithm
        spends about the same, so the rank is how much incremental outcome that spend bought. The roi and validation rules let
        the group size differ too, and also rank by incremental outcome. Under roi an algorithm that missed the efficiency
        target ranks after those that met it.
        """
        out, draws, volume = [], {}, {}
        for arm in self.arms:
            S, trained = arm.served, [r['train'] for r in arm.rows if r.get('train') and 'error' not in r['train']]
            s = {'arm': arm.id, 'name': arm.name, 'cycles': len(S), 'gain': None, 'ci': [None, None], 'incR': None, 'incC': None, 'R': None, 'baseR': None, 'selected': None,
                 'truthGain': None, 'truthIncR': None, 'truthIncC': None, 'truthR': None, 'baseTruthR': None, 'armShare': None,
                 'aucc': None, 'auccTruth': None, 'qini': None, 'qiniTruth': None, 'upliftAt': None, 'upliftAtTruth': None, 'trainMs': None,
                 'failures': sum(1 for r in arm.rows if r.get('error') or 'error' in r.get('train', {})),
                 'lastError': next((r.get('error') or r.get('train', {}).get('error') for r in reversed(arm.rows) if r.get('error') or 'error' in r.get('train', {})), None)}
            if trained:
                s.update(trainMs=float(np.mean([t['ms'] for t in trained])), **{key: _mean(t.get(key) for t in trained) for key in ('aucc', 'auccTruth', 'qini', 'qiniTruth', 'upliftAt', 'upliftAtTruth')})
            if S:
                w = np.array([p['w'] for p in S], dtype=np.float64)
                sel_r, sel_c = np.array([p['sel']['ateR'] for p in S]) @ w, np.array([p['sel']['ateC'] for p in S]) @ w
                ex_r, ex_c = np.array([p['ex']['ateR'] for p in S]) @ w, np.array([p['ex']['ateC'] for p in S]) @ w
                s.update(incR=float(sel_r), incC=float(sel_c), R=float(sel_r / sel_c) if sel_c else None, baseR=float(ex_r / ex_c) if ex_c else None, selected=float(w.mean()))
                pool = lambda key, i: sum(wi * p[key][i] for wi, p in zip(w, S))  # noqa: E731
                volume[arm.id] = pool('selBoot', 0)
                if sel_c and ex_c and ex_r:
                    s['gain'] = float((sel_r / sel_c) / (ex_r / ex_c) - 1)
                    draws[arm.id] = relative(ratio_of((pool('selBoot', 0), pool('selBoot', 1))), ratio_of((pool('exBoot', 0), pool('exBoot', 1))))
                    s['ci'] = interval(draws[arm.id])
                if S[0]['truth']:
                    tr, tc, er, ec = (sum(p['truth'][i] for p in S) for i in range(4))
                    s.update(truthIncR=tr, truthIncC=tc, truthR=tr / tc, baseTruthR=er / ec, truthGain=(tr / tc) / (er / ec) - 1)
                if S[0]['armCounts']:
                    counts = np.sum([p['armCounts'] for p in S], axis=0)
                    s['armShare'] = (counts / max(counts.sum(), 1)).tolist()
            out.append(s)
        by_volume = self.mode != 'quantile'
        key = ('truthIncR' if by_volume else 'truthGain') if self.scenario.truth else ('incR' if by_volume else 'gain')
        gain_key = 'truthGain' if self.scenario.truth else 'gain'
        for s in out:
            s['meets'] = None if self.mode != 'roi' or s[gain_key] is None else s[gain_key] >= self.efficiency
        ranked = sorted(out, key=lambda s: (s[key] is None, s['meets'] is False, -(s[key] or 0)))  # no result ranks last
        for i, s in enumerate(ranked):
            s['rank'], s['vsLeader'] = i + 1, None
        leader = ranked[0]
        spread, field = (volume, 'incR') if by_volume else (draws, 'gain')
        for s in ranked[1:]:  # explore draws are shared, so the baseline noise cancels in the difference
            if s['arm'] in spread and leader['arm'] in spread and s[field] is not None and leader[field] is not None:
                ci = interval(spread[s['arm']] - spread[leader['arm']])
                s['vsLeader'] = {'diff': s[field] - leader[field], 'ci': ci, 'tied': ci[0] is not None and ci[0] <= 0 <= ci[1]}
        return {'by': key, 'leader': leader['arm'], 'arms': out}


def _mean(values):
    values = [v for v in values if v is not None]
    return float(np.mean(values)) if values else None


def quick_check(algorithm, device='cpu', report=lambda message: None, seed=42):
    """Fit once on three cycles of explore data from the base synthetic market, to catch errors before a full run."""
    scenario, log = SyntheticScenario('base', seed=seed, pool=20000, cycles=3), []
    for c in range(1, 4):
        pop = scenario.cohort(c)
        ex = np.argsort(pop.u_explore, kind='stable')[:round(len(pop) * .2)]
        t = pop.assign(ex)
        y, cost = pop.outcome(ex, t)
        log.append({'cycle': c, 'X': pop.X[ex], 't': t, 'y': y, 'cost': cost, 'split': pop.u_split[ex], 'tau_r': pop.tau_r[ex], 'tau_c': pop.tau_c[ex]})
    sets = splits(log, scenario)
    model, out = fit(algorithm, sets, seed, 3, .4, device, report)
    started = time.perf_counter()
    result = evaluate(model, sets['test'], .4)
    return {**out, **result, 'predictMs': (time.perf_counter() - started) * 1000, 'split': {k: int(len(v.t)) for k, v in sets.items()}}
