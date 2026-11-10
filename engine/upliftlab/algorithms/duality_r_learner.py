"""성과와 비용의 CATE를 R-Learner로 학습하고 τ̂ʳ − λ·τ̂ᶜ 순으로 정렬해요. λ는 validation AUCC가 가장 높은 값으로 정해요.

τ̂ʳ, τ̂ᶜ는 y / σ_y, cost / σ_c의 CATE이고, EconML의 NonParamDML(R-Learner)로 학습해요.
σ_y, σ_c는 train의 표준편차예요. 정규화하므로 성과와 비용의 단위가 바뀌어도 순위가 같아요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from econml.dml import NonParamDML

NAME = 'Duality R-Learner'
LAMBDAS = [0, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6]  # 정규화한 성과와 비용 사이의 가중치


def regressor(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def classifier(kind):
    if kind == 'tree':
        return HistGradientBoostingClassifier(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))


def final(kind):
    """마지막 단계 회귀. EconML이 sample_weight를 넘기므로 파이프라인이 아닌 모델을 써요."""
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return Ridge(alpha=1.0)


def r_learner(X, t, y, seed, kind):
    est = NonParamDML(model_y=regressor(kind), model_t=classifier(kind), model_final=final(kind), discrete_treatment=True, cv=2, random_state=seed)
    return est.fit(y, t, X=X)


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
            t = (train.t[rows] == arm).astype(int)
            self.arms.append((r_learner(train.X[rows], t, y[rows], context.model_seed, kind), r_learner(train.X[rows], t, cost[rows], context.model_seed, kind)))
        best = None
        for i, lam in enumerate(LAMBDAS):
            values = []
            for arm, (gain, spend) in enumerate(self.arms, 1):
                rows = (validation.t == arm) | (validation.t == 0)
                X = validation.X[rows]
                score = np.ravel(gain.const_marginal_effect(X)) - lam * np.ravel(spend.const_marginal_effect(X))
                values.append(aucc(score, validation.t[rows], validation.y[rows], validation.cost[rows]))
            values = [v for v in values if v is not None]
            val = float(np.mean(values)) if values else None
            context.report(step=i + 1, total=len(LAMBDAS), lam=lam, val=val if val is not None else 0)
            if best is None or (val is not None and (best[0] is None or val > best[0])):
                best = (val, lam)
        self.lam = best[1]

    def predict(self, X):
        return np.column_stack([np.ravel(gain.const_marginal_effect(X)) - self.lam * np.ravel(spend.const_marginal_effect(X)) for gain, spend in self.arms])
