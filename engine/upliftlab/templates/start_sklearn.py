"""가장 가벼운 시작 템플릿이에요. scikit-learn Ridge T-Learner로 증분 성과와 증분 비용을 추정하고, 성과 − λ·비용 순으로 정렬해요.

regressor()를 다른 scikit-learn 모델로 바꾸거나 COST_WEIGHT를 조정해 보세요.
"""
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'scikit-learn T-Learner'
COST_WEIGHT = 0.4  # λ: 표준편차로 정규화한 비용의 가중치. 비용의 단위와 무관해요.


def regressor():
    # 예: from sklearn.ensemble import HistGradientBoostingRegressor → HistGradientBoostingRegressor(max_depth=3)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


class TLearner:
    """target의 증분 효과 τ̂(x) = μ̂₁(x) − μ̂₀(x). arm은 비교할 처치 번호예요."""

    def fit(self, X, t, target, arm=1):
        self.mu1 = regressor().fit(X[t == arm], target[t == arm])
        self.mu0 = regressor().fit(X[t == 0], target[t == 0])
        return self

    def predict(self, X):
        return self.mu1.predict(X) - self.mu0.predict(X)


class Model:
    def fit(self, train, validation, context):
        # train.X (n×d 배열) · t (0/1) · y (결과) · cost (비용) · propensity · features (열 이름)
        # pandas가 편하면 pd.DataFrame(train.X, columns=train.features)로 바꿔 써요.
        # 처치가 여러 종류면 train.treatments가 그 수예요(t = 1..K). 처치마다 모델을 따로 학습해요.
        arms = range(1, train.treatments + 1)
        self.gain = [TLearner().fit(train.X, train.t, train.y, arm) for arm in arms]
        self.cost = [TLearner().fit(train.X, train.t, train.cost, arm) for arm in arms]
        self.scale = (train.y.std() or 1) / (train.cost.std() or 1)

    def predict(self, X):
        # 점수가 높을수록 먼저 처치해요. 처치가 여러 종류면 (행 수, 처치 수) 배열을 반환하고, 사용자마다 점수가 가장 큰 처치를 줘요.
        return np.column_stack([gain.predict(X) - COST_WEIGHT * self.scale * cost.predict(X) for gain, cost in zip(self.gain, self.cost)])
