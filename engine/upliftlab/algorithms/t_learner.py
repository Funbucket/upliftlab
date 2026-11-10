"""처치군과 대조군에 결과 모델을 따로 학습하고, 두 예측의 차이를 CATE로 써요(T-Learner). 비용은 보지 않아요.

EconML의 TLearner예요. τ̂ₖ(x) = μ̂ₖ(x) − μ̂₀(x)이고, 처치가 여러 종류면 처치마다 계산해 점수가 가장 큰 처치를 골라요.
μ̂는 context.base_learner에 따라 Ridge 또는 Gradient Boosting이에요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from econml.metalearners import TLearner

NAME = 'T-Learner'


def regressor(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        self.est = TLearner(models=regressor(kind)).fit(train.y, train.t, X=train.X)

    def predict(self, X):
        return np.asarray(self.est.const_marginal_effect(X)).reshape(len(X), -1)
