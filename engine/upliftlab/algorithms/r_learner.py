"""결과와 처치의 잔차로 CATE를 학습해요(R-Learner). 비용은 보지 않아요.

EconML의 NonParamDML이에요. y − m̂(x) = (t − ê(x))·τ(x) + ε에서 m̂, ê를 2-fold cross-fitting으로 구하고,
τ(x)는 목표 (y − m̂) / (t − ê), 가중치 (t − ê)²인 회귀로 풀어요. 처치가 여러 종류면 처치마다 대조군과 따로 학습해요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from econml.dml import NonParamDML

NAME = 'R-Learner'


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


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        self.taus = []
        for arm in range(1, train.treatments + 1):
            rows = (train.t == 0) | (train.t == arm)
            est = NonParamDML(model_y=regressor(kind), model_t=classifier(kind), model_final=final(kind), discrete_treatment=True, cv=2, random_state=context.model_seed)
            self.taus.append(est.fit(train.y[rows], (train.t[rows] == arm).astype(int), X=train.X[rows]))

    def predict(self, X):
        return np.column_stack([np.ravel(est.const_marginal_effect(X)) for est in self.taus])
