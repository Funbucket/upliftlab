"""Y와 T의 잔차를 cross-fitting으로 구하고, 그 관계로 CATE를 추정해요(Double Machine Learning). 비용은 보지 않아요.

EconML의 LinearDML이에요. ỹ = y − m̂(x), t̃ = t − ê(x)를 3-fold cross-fitting으로 구하고 τ̂(x) = θ₀ + θ'x를 ỹ ≈ t̃·τ(x)로 맞춰요.
R-Learner와 달리 마지막 단계가 선형이라 해석하기 쉽고, 처치가 공변량에 따라 달라지는 로그에서도 ê(x)로 보정해요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from econml.dml import LinearDML

NAME = 'DML'


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
        self.est = LinearDML(model_y=regressor(kind), model_t=classifier(kind), discrete_treatment=True, cv=3, random_state=context.model_seed)
        self.est.fit(train.y, train.t, X=train.X)

    def predict(self, X):
        return np.asarray(self.est.const_marginal_effect(X)).reshape(len(X), -1)
