# Criteo 업리프트 데이터 표본

`criteo-uplift-sample.csv.gz`는 Criteo AI Lab이 공개한 Criteo Uplift Prediction Dataset v2.1(13,979,592행)에서 뽑은 표본이에요. 이 파일만 upliftlab의 MIT 라이선스가 아니라 원본 라이선스를 따라요.

- 원본: Criteo AI Lab, <https://ailab.criteo.com/criteo-uplift-prediction-dataset/>, 배포본 <https://huggingface.co/datasets/criteo/criteo-uplift>
- 라이선스: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). 비상업적으로만 쓰고, 출처를 밝히고, 바꾼 자료는 같은 라이선스로 배포해야 해요.
- 인용: Diemert, Betlei, Renaudin, Amini. *A Large Scale Benchmark for Uplift Modeling.* AdKDD 2018.

## 바꾼 점

- 처치군과 대조군에서 약 10만 행씩 무작위로 뽑았어요(처치군 100,000행, 대조군 99,837행). 뽑을 확률이 처치 여부에만 달려 있어서 처치는 여전히 공변량과 독립인 무작위 배정이고, 처치 비율만 85%에서 50%로 바뀌어요.
- 공변량 `f0`–`f11`은 소수점 셋째 자리까지 반올림했어요. `exposure` 열은 처치 뒤에 정해지는 값이라 뺐어요.
- `user_id`는 원본 파일의 행 번호예요.
- 만드는 방법은 [`scripts/sample-criteo.py`](../../scripts/sample-criteo.py)에 있어요.
