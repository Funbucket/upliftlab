"""트리 모델로 공변량의 비선형 관계를 학습하는 T-Learner예요. 모델 4개가 각자 validation으로 조기 종료하고, 성과 − λ·비용 순으로 정렬해요.

모델 네 개 = 성과·비용 × 처치군·대조군. PARAMS를 바꿔 트리 크기와 학습률을 조정해요.
"""
import lightgbm as lgb
import numpy as np

NAME = 'LightGBM T-Learner'
COST_WEIGHT = 0.4  # λ: 표준편차로 정규화한 비용의 가중치. 비용의 단위와 무관해요.
# 수천 행에서는 스레드 하나가 가장 빨라요(n_jobs=1). 데이터가 크면 늘려 보세요.
PARAMS = dict(n_estimators=400, learning_rate=0.05, num_leaves=15, min_child_samples=50, subsample=0.8, subsample_freq=1, n_jobs=1, verbose=-1)


class Model:
    def fit(self, train, validation, context):
        self.models = {}
        self.scale = (train.y.std() or 1) / (train.cost.std() or 1)
        self.treatments = train.treatments
        arms = [*range(1, train.treatments + 1), 0]  # t = 1..K는 처치, 0은 대조군이에요
        for target in ('y', 'cost'):
            for arm in arms:
                rows, val = train.t == arm, validation.t == arm
                model = lgb.LGBMRegressor(**PARAMS, random_state=context.model_seed)
                model.fit(train.X[rows], getattr(train, target)[rows],
                          eval_set=[(validation.X[val], getattr(validation, target)[val])],
                          callbacks=[lgb.early_stopping(30, verbose=False)])
                self.models[target, arm] = model
                context.report(step=len(self.models), total=2 * len(arms), trees=model.best_iteration_)

    def uplift(self, target, X, arm):
        return self.models[target, arm].predict(X) - self.models[target, 0].predict(X)

    def predict(self, X):
        return np.column_stack([self.uplift('y', X, arm) - COST_WEIGHT * self.scale * self.uplift('cost', X, arm) for arm in range(1, self.treatments + 1)])
