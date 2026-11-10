"""Where each cycle's candidates come from: a synthetic market with known effects, or a logged randomized experiment.

`t` is 0 for control and 1..K for the K treatments. Most datasets have one treatment, so K = 1 and t is the usual 0/1.
"""
import hashlib

import numpy as np

REDEEM = 0.85


def seed_of(*parts):
    return int.from_bytes(hashlib.blake2b('|'.join(map(str, parts)).encode(), digest_size=8).digest(), 'little')


class Population:
    """One cycle's candidates. `assign` and `outcome` hide whether outcomes are simulated or replayed."""

    def __init__(self, ids, X, u_explore, u_split, assign, outcome, tau_r=None, tau_c=None, explore_arm=None, treatments=1):
        self.ids, self.X, self.u_explore, self.u_split = ids, X, u_explore, u_split
        self.assign, self.outcome, self.tau_r, self.tau_c = assign, outcome, tau_r, tau_c
        self.explore_arm, self.treatments = explore_arm or (lambda idx: np.ones(len(idx), dtype=np.int64)), treatments

    def __len__(self):
        return len(self.X)

    def truth(self, idx, arm):
        """True incremental outcome and cost of giving treatment `arm` to the rows `idx`."""
        if self.tau_r.ndim == 1:
            return self.tau_r[idx], self.tau_c[idx]
        return self.tau_r[idx, arm - 1], self.tau_c[idx, arm - 1]


class SyntheticScenario:
    """A simple coupon experiment with four covariates in [0, 1]: visit frequency f, days since the last visit l, price
    sensitivity p and order value c.

        retention without a coupon   p₀ = logistic(−0.55 + 2.4f − 1.9l + 0.25c)
        retention with a coupon      p₁ = p₀ + 0.02 + 0.22·l·(1 − 0.65f) + 0.08p + 0.07c
        coupon cost when redeemed    0.8 + 3.6c   (85% of retained users redeem it)

    Lapsed users respond most, frequent users would return anyway, and high spenders respond but cost more. Every user has
    both potential outcomes, so the true effect of any selection is known exactly. The 'tiers' preset (three coupon
    sizes) exists for the multi-treatment tests and is not listed in the app.
    """
    kind = 'synthetic'
    truth = True
    propensity = .5
    features = ['최근 이용 빈도', '이용 공백', '가격 민감도', '평균 결제액']
    PRESETS = {'base': (0, 0, 0, 0), 'tiers': (0, 0, 0, 0)}
    # Treatment levels of a market: how much a reward costs relative to the base reward, and how much of the base effect it buys.
    # The effect saturates, so the largest reward is rarely the most cost-effective one.
    LEVELS = {'tiers': {'cost': (.5, 1., 1.5), 'effect': (.55, 1., 1.3), 'labels': ['보상 ×0.5', '보상 ×1', '보상 ×1.5']}}
    SINGLE = {'cost': (1.,), 'effect': (1.,), 'labels': ['보상 지급']}

    def __init__(self, preset='base', seed=42, pool=20000, cycles=8):
        if preset not in self.PRESETS:
            raise ValueError(f'알 수 없는 합성 시나리오예요: {preset}')
        self.preset, self.seed, self.pool, self.cycles = preset, seed, int(pool), int(cycles)
        self.levels = self.LEVELS.get(preset, self.SINGLE)
        self.treatments = len(self.levels['cost'])
        self.labels = self.levels['labels']
        self.propensities = np.full(self.treatments, 1 / (self.treatments + 1))  # P(T = k | T in {0, k}): half the users are control

    @staticmethod
    def potential(X):
        f, l, p, c = X.T
        p0 = 1 / (1 + np.exp(-(-.55 + 2.4 * f - 1.9 * l + .25 * c)))
        p1 = np.clip(p0 + .02 + .22 * l * (1 - .65 * f) + .08 * p + .07 * c, 0, .97)
        value = .8 + 3.6 * c
        return p0, p1, value

    def cohort(self, cycle):
        rng = np.random.default_rng(seed_of(self.seed, 'cohort', self.preset, cycle))
        n, shift, K = self.pool, np.asarray(self.PRESETS[self.preset]), self.treatments
        X = np.clip((rng.random((n, 4)) + rng.random((n, 4))) / 2 + shift + (rng.random((n, 4)) - .5) * .24, 0, 1)
        p0, p1, value = self.potential(X)
        u_explore, u_t, u_y, u_redeem, u_split = rng.random((5, n))
        P = np.column_stack([p0] + [p1 if r == 1 else np.clip(p0 + (p1 - p0) * r, 0, .97) for r in self.levels['effect']])  # (n, K + 1)
        unit = value[:, None] * np.asarray(self.levels['cost'])  # (n, K)
        arms = np.ones(n, dtype=np.int64)
        if K > 1:
            arms = 1 + np.floor(np.random.default_rng(seed_of(self.seed, 'arm', self.preset, cycle)).random(n) * K).astype(np.int64)

        def explore_arm(idx):
            return arms[idx]

        def assign(idx, arm=None):
            """Half the rows stay control. The rest get `arm`, or their random Explore treatment when none is given."""
            return (u_t[idx] < .5).astype(np.int64) * (arms[idx] if arm is None else np.asarray(arm, dtype=np.int64))

        def outcome(idx, t):
            yr = (u_y[idx] < P[idx, t]).astype(np.float64)
            return yr, (t > 0) * yr * (u_redeem[idx] < REDEEM) * unit[idx, np.maximum(t, 1) - 1]

        ids = [f'c{cycle}-{i + 1:05d}' for i in range(n)]
        tau_r, tau_c = P[:, 1:] - p0[:, None], P[:, 1:] * REDEEM * unit
        if K == 1:
            tau_r, tau_c = tau_r[:, 0], tau_c[:, 0]
        return Population(ids, X, u_explore, u_split, assign, outcome, tau_r=tau_r, tau_c=tau_c, explore_arm=explore_arm, treatments=K)


class ReplayScenario:
    """A logged randomized experiment: rows are split into disjoint per-cycle pools and their logged T is reused.

    Any selection's effect can still be estimated because T was random inside every subset; there is no ground truth.
    With several treatments only rows whose logged T is control or the treatment the algorithm chose can be measured.
    The split depends only on the file's rows and the seed, so the same file and seed reproduce the same result.
    """
    kind = 'replay'
    truth = False

    def __init__(self, data, seed=42, cycles=8, pool=20000):
        n = len(data.t)
        self.data, self.seed = data, seed
        self.cycles = int(max(1, min(cycles, n // 400)))
        self.pool = int(min(pool, n // self.cycles))
        if self.pool < 200:
            raise ValueError('행이 너무 적어요. 사이클마다 최소 200행이 필요해요.')
        self.order = np.random.default_rng(seed_of(seed, 'replay', data.fingerprint)).permutation(n)
        self.treatments = int(data.t.max())
        self.propensity = float((data.t > 0).mean())
        self.propensities = np.array([float((data.t == k).sum() / ((data.t == k) | (data.t == 0)).sum()) for k in range(1, self.treatments + 1)])
        self.labels = [f'T={k}' for k in range(1, self.treatments + 1)] if self.treatments > 1 else ['처치']
        self.features = data.features

    def cohort(self, cycle):
        d, rows = self.data, self.order[(cycle - 1) * self.pool:cycle * self.pool]
        u_explore, u_split = np.random.default_rng(seed_of(self.seed, 'replay', d.fingerprint, cycle)).random((2, len(rows)))
        return Population([f'row{r + 1}' for r in rows], d.X[rows], u_explore, u_split,
                          lambda idx, arm=None: d.t[rows[idx]], lambda idx, t: (d.y[rows[idx]], d.cost[rows[idx]]),
                          explore_arm=lambda idx: np.maximum(d.t[rows[idx]], 1), treatments=self.treatments)
