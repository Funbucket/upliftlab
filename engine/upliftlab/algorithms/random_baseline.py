"""무작위 점수로 정렬해요. 비교 기준선(baseline)이고, Cost Curve는 대각선에 가까워요."""
import numpy as np

NAME = 'Random'


class Model:
    score_is_effect = False  # 점수가 무작위라서 효과로 읽지 않아요. Knapsack과 효율 제약 선정에서 이 순서를 그대로 써요.

    def fit(self, train, validation, context):
        self.rng = np.random.default_rng(context.seed)
        self.treatments = train.treatments

    def predict(self, X):
        return self.rng.random((len(X), self.treatments))
