"""처치군과 대조군의 결과 모델로 사용자별 처치 효과를 대체(impute)하고, 두 효과 모델을 propensity로 가중 평균해요(X-Learner). 비용은 보지 않아요.

Dᵀ = y − μ̂₀(x)  (처치군)        Dᶜ = μ̂₁(x) − y  (대조군)
τ̂(x) = e·τ̂ᶜ(x) + (1 − e)·τ̂ᵀ(x)
μ̂와 τ̂는 context.base_learner에 따라 Ridge 또는 Gradient Boosting이고(scikit-learn), e는 propensity예요.
Ridge에서는 T-Learner와 거의 같은 점수가 나와요. 두 방법의 차이는 비선형 모델과 처치 비율이 불균형할 때 커져요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'X-Learner'


def base_model(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        control = train.t == 0
        X0, y0 = train.X[control], train.y[control]
        mu0 = base_model(kind).fit(X0, y0)
        self.arms = []
        for arm in range(1, train.treatments + 1):
            treated = train.t == arm
            X1, y1 = train.X[treated], train.y[treated]
            mu1 = base_model(kind).fit(X1, y1)
            tau1 = base_model(kind).fit(X1, y1 - mu0.predict(X1))
            tau0 = base_model(kind).fit(X0, mu1.predict(X0) - y0)
            self.arms.append((tau1, tau0, float(train.propensities[arm - 1])))

    def predict(self, X):
        return np.column_stack([e * tau0.predict(X) + (1 - e) * tau1.predict(X) for tau1, tau0, e in self.arms])
