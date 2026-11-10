"""처치군과 대조군의 결과 모델로 사용자별 처치 효과를 대체(impute)하고, 두 효과 모델을 propensity로 가중 평균해요(X-Learner). 비용은 보지 않아요.

EconML의 XLearner예요. Dᵀ = y − μ̂₀(x), Dᶜ = μ̂₁(x) − y로 효과 모델 τ̂ᵀ, τ̂ᶜ를 학습하고 τ̂(x) = e(x)·τ̂ᶜ(x) + (1 − e(x))·τ̂ᵀ(x)로 합쳐요.
모델은 context.base_learner에 따라 Ridge·로지스틱 회귀 또는 Gradient Boosting이에요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from econml.metalearners import XLearner

NAME = 'X-Learner'


def regressor(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def classifier(kind):
    if kind == 'tree':
        return HistGradientBoostingClassifier(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        self.est = XLearner(models=regressor(kind), propensity_model=classifier(kind)).fit(train.y, train.t, X=train.X)

    def predict(self, X):
        return np.asarray(self.est.const_marginal_effect(X)).reshape(len(X), -1)
