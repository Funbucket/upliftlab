"""처치군과 대조군에 결과 모델을 따로 학습하고, 두 예측의 차이를 CATE로 써요(T-Learner). 비용은 보지 않아요.

τ̂ₖ(x) = μ̂ₖ(x) − μ̂₀(x)        처치가 여러 종류면 처치마다 계산하고, 점수가 가장 큰 처치를 골라요.
μ̂는 context.base_learner에 따라 Ridge 또는 Gradient Boosting이에요(scikit-learn).
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'T-Learner'


def base_model(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        control = train.t == 0
        self.mu0 = base_model(kind).fit(train.X[control], train.y[control])
        self.mu = [base_model(kind).fit(train.X[train.t == arm], train.y[train.t == arm]) for arm in range(1, train.treatments + 1)]

    def predict(self, X):
        base = self.mu0.predict(X)
        return np.column_stack([mu.predict(X) - base for mu in self.mu])
