"""성과와 비용의 CATE를 R-Learner로 학습하고 τ̂ʳ − λ·τ̂ᶜ 순으로 정렬해요. λ는 validation AUCC가 가장 높은 값으로 정해요.

경량판: 브라우저에는 EconML이 없어서 웹에서는 같은 방법을 scikit-learn으로 직접 구현한 이 파일을 실행해요.
로컬(upliftlab)에서는 EconML로 쓴 upliftlab/algorithms/duality_r_learner.py를 실행해요.

score = τ̂ʳ(x) − λ·τ̂ᶜ(x)        τ̂ʳ, τ̂ᶜ는 y / σ_y, cost / σ_c의 CATE예요.
σ_y, σ_c는 train의 표준편차예요. 정규화하므로 성과와 비용의 단위가 바뀌어도 순위가 같아요.
회귀 모델은 context.base_learner에 따라 Ridge 또는 Gradient Boosting이에요(scikit-learn).
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'Duality R-Learner'
LAMBDAS = [0, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6]  # 정규화한 성과와 비용 사이의 가중치


def base_model(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def r_learner(X, t, y, propensity, seed, kind):
    m = cross_val_predict(base_model(kind), X, y, cv=KFold(2, shuffle=True, random_state=seed))
    w = t - propensity
    weight = {'sample_weight': w ** 2} if kind == 'tree' else {'ridge__sample_weight': w ** 2}
    return base_model(kind).fit(X, (y - m) / w, **weight)


def aucc(score, t, y, cost, points=20):
    """점수 순으로 상위 S를 골랐을 때 (증분 비용, 증분 성과) 곡선 아래 넓이를 0–1로 맞춘 값. 무작위 순서 ≈ 0.5."""
    order = np.argsort(-score, kind='stable')
    cut = np.round(np.arange(1, points + 1) * len(order) / points).astype(int) - 1
    T = (t[order] > 0).astype(float)
    nT, nC = np.cumsum(T)[cut], np.cumsum(1 - T)[cut]
    ok = (nT > 0) & (nC > 0)

    def lift(v):
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.where(ok, nT * (np.cumsum(v[order] * T)[cut] / nT - np.cumsum(v[order] * (1 - T))[cut] / nC), 0.)
    gain, spend = np.r_[0., lift(y)], np.r_[0., lift(cost)]
    if gain.max() <= 0 or spend.max() <= 0:
        return None
    x, h = spend / spend.max(), gain / gain.max()
    return float(np.sum(np.diff(x) * (h[1:] + h[:-1]) / 2))


class Model:
    score_is_effect = False  # 점수에 비용이 이미 들어 있어서 효과로 읽지 않아요. Knapsack과 효율 제약 선정에서 이 순서를 그대로 써요.

    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        y, cost = train.y / (train.y.std() or 1), train.cost / (train.cost.std() or 1)
        self.arms = []
        for arm in range(1, train.treatments + 1):
            rows = (train.t == arm) | (train.t == 0)
            t = (train.t[rows] == arm).astype(float)
            e = train.propensities[arm - 1]
            self.arms.append((r_learner(train.X[rows], t, y[rows], e, context.model_seed, kind), r_learner(train.X[rows], t, cost[rows], e, context.model_seed, kind)))
        best = None
        for i, lam in enumerate(LAMBDAS):
            values = []
            for arm, (gain, spend) in enumerate(self.arms, 1):
                rows = (validation.t == arm) | (validation.t == 0)
                values.append(aucc(gain.predict(validation.X[rows]) - lam * spend.predict(validation.X[rows]), validation.t[rows], validation.y[rows], validation.cost[rows]))
            values = [v for v in values if v is not None]
            val = float(np.mean(values)) if values else None
            context.report(step=i + 1, total=len(LAMBDAS), lam=lam, val=val if val is not None else 0)
            if best is None or (val is not None and (best[0] is None or val > best[0])):
                best = (val, lam)
        self.lam = best[1]

    def predict(self, X):
        return np.column_stack([gain.predict(X) - self.lam * spend.predict(X) for gain, spend in self.arms])
