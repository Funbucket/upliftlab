"""Y와 T의 잔차를 cross-fitting으로 구하고, 그 관계로 CATE를 추정해요(Double Machine Learning). 비용은 보지 않아요.

ỹ = y − m̂(x)        t̃ = t − ê(x)        τ̂(x) = θ₀ + θ'x        θ = argmin Σ (ỹ − t̃·τ(x))²
m̂와 ê는 3-fold cross-fitting으로 구해요. 모델은 context.base_learner에 따라 Ridge·로지스틱 회귀 또는 Gradient Boosting이에요(scikit-learn).
R-Learner와 달리 propensity ê(x)도 추정해서, 처치가 공변량에 따라 달라지는 로그에서도 쓸 수 있어요.
무작위 배정 데이터에서는 ê(x)가 상수에 가까워 R-Learner와 비슷한 결과가 나와요.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NAME = 'DML'
FOLDS = 3


def outcome_model(kind):
    if kind == 'tree':
        return HistGradientBoostingRegressor(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def treatment_model(kind):
    if kind == 'tree':
        return HistGradientBoostingClassifier(max_depth=3, max_iter=100, early_stopping=False, random_state=0)
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))


def design(scaler, X):
    return np.column_stack([np.ones(len(X)), scaler.transform(X)])


class Model:
    def fit(self, train, validation, context):
        kind = getattr(context, 'base_learner', 'ridge')
        self.scaler = StandardScaler().fit(train.X)
        self.finals = []
        for arm in range(1, train.treatments + 1):
            rows = (train.t == arm) | (train.t == 0)
            X, y, t = train.X[rows], train.y[rows], (train.t[rows] == arm).astype(int)
            folds = KFold(FOLDS, shuffle=True, random_state=context.model_seed)
            y_res = y - cross_val_predict(outcome_model(kind), X, y, cv=folds)
            t_res = t - np.clip(cross_val_predict(treatment_model(kind), X, t, cv=folds, method='predict_proba')[:, 1], .01, .99)
            self.finals.append(Ridge(alpha=1.0, fit_intercept=False).fit(design(self.scaler, X) * t_res[:, None], y_res))

    def predict(self, X):
        Z = design(self.scaler, X)
        return np.column_stack([final.predict(Z) for final in self.finals])
