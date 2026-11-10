"""결과와 처치의 잔차로 CATE를 학습해요(R-Learner). 비용은 보지 않아요.

y − m(x) = (t − e)·τ(x) + ε
m(x)는 2-fold cross-fitting으로 구하고, e는 propensity(상수)예요. τ(x)는 목표 (y − m) / (t − e), 가중치 (t − e)²인 회귀로 풀어요.
회귀 모델은 context.base_learner에 따라 Ridge 또는 Gradient Boosting이에요(scikit-learn).
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'R-Learner'


def base_model(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def r_learner(X, t, y, propensity, seed, kind):
    """τ(x)를 예측하는 모델을 반환해요."""
    m = cross_val_predict(base_model(kind), X, y, cv=KFold(2, shuffle=True, random_state=seed))
    w = t - propensity
    weight = {'sample_weight': w ** 2} if kind == 'tree' else {'ridge__sample_weight': w ** 2}
    return base_model(kind).fit(X, (y - m) / w, **weight)


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        self.taus = []
        for arm in range(1, train.treatments + 1):
            rows = (train.t == arm) | (train.t == 0)
            self.taus.append(r_learner(train.X[rows], (train.t[rows] == arm).astype(float), train.y[rows], train.propensities[arm - 1], context.model_seed, kind))

    def predict(self, X):
        return np.column_stack([tau.predict(X) for tau in self.taus])
