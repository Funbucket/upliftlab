# 사용 안내

README보다 자세한 내용이에요. 처음이라면 [uplift-lab.vercel.app](https://uplift-lab.vercel.app)에서 `예시 실험 파일로 해 보기`부터 눌러 보세요.

## 어떻게 비교하나요

사이클마다 후보 사용자를 세 그룹으로 나눠요.

| 그룹 | 고르는 방법 | 쓰는 곳 |
|---|---|---|
| Explore (기본 20%) | 무작위 | 모델 학습과 오프라인 평가. 모든 알고리즘이 같은 Explore 그룹을 써요 |
| Exploit | 알고리즘의 점수와 선정 방식 | 그룹 안에서도 처치군과 대조군을 나눠, 두 군의 차이로 증분 성과를 재요 |
| 미선정 | 나머지 | 처치하지 않아요 |

사이클이 끝나면 최근 3사이클의 Explore 데이터로 재학습하고, 다음 사이클에 새 모델을 써요. 사이클 1은 학습된 모델이 없어서 순위 합산에서 빼요.

## 기본 알고리즘

로컬에서는 `upliftlab/algorithms/`의 EconML 파일을, 웹에서는 `upliftlab/algorithms/lite/`의 scikit-learn 파일을 실행해요. 브라우저용 Python(Pyodide)에 EconML이 쓰는 numba가 없어서예요. 두 파일은 같은 방법을 구현하지만 cross-fitting 방식 같은 세부가 달라서 숫자가 조금 다를 수 있어요. 결과 화면과 보고서에 어느 쪽으로 돌렸는지 나와요.

EconML은 Linux x86_64, macOS, Windows x86_64용 휠이 있어서 `pip install`로 함께 설치돼요. 휠이 없는 ARM Linux와 ARM Windows에서는 EconML 없이 설치되고 경량판이 돌아가요. 컴파일러가 있으면 Python 3.11 이상에서 `pip install econml`로 직접 빌드할 수 있어요.

## 데이터

- **Criteo 광고 실험**(기본): Criteo AI Lab의 Uplift Prediction Dataset v2.1(1,398만 명, 처치 85%)에서 처치군 100,000명과 대조군 99,837명을 뽑은 표본이에요. 뽑을 확률이 처치 여부에만 달려 있어서 표본도 무작위 배정 실험이고, 처치 비율만 50%가 돼요. 결과는 `visit`(사이트 방문), 공변량은 `f0`–`f11`이고 비용 열은 없어요(처치 1건당 1). 라이선스는 [CC BY-NC-SA 4.0](../web/data/LICENSE-criteo.md)이에요.
- **Hillstrom 이메일 실험**: 64,000명. 명시된 라이선스가 없어 함께 배포하지 않아요. 로컬은 원본에서 자동으로 받고, 웹은 받은 CSV를 올리면 형식을 알아서 바꿔요.
- **합성 쿠폰 실험**: 공변량 4개로 만든 단순한 식이에요. 쿠폰 없이 돌아올 확률, 쿠폰으로 늘어나는 확률, 쿠폰 비용이 공변량에 따라 정해지고([scenario.py](../engine/upliftlab/scenario.py)), 사용자마다 실제 효과를 알아서 참값으로 순위를 매겨요.

## 선정 방식

| 방식 | 규칙 | 순위 기준 |
|---|---|---|
| 예산 · 점수 순 (기본) | 점수 순으로 더하다가 예상 증분 비용이 예산을 넘기 직전에 멈춰요 | 같은 예산에서의 증분 성과 |
| 상위 q% | 점수 상위 q%를 골라요 | 같은 인원에서의 비용 효율 개선 |
| 예산 · Knapsack | 효과 − λ·비용이 양수인 사용자를 고르고, λ를 예산에 맞춰요 | 증분 성과 |
| 효율 제약 · ROI | 효과 ÷ 비용 순으로 더하다가 예상 효율이 기준 아래로 내려가기 전에 멈춰요 | 기준을 지킨 알고리즘 중 증분 성과 |
| validation 최적 비율 | validation 행에서 총 증분 성과가 가장 큰 비율까지 골라요 | 증분 성과 |

예산이 정해져 있다면 `예산 · 점수 순`으로 비교하세요. 상위 q%는 알고리즘마다 쓰는 비용이 달라서, 같은 돈으로 몇 명을 더 남기는지는 알 수 없어요.

## 실험 로그 형식

| 예시 열 | 역할 | 값 |
|---|---|---|
| `treatment` | 처치 · 필수 | 0 = 대조군, 1 = 처치. 처치가 여러 종류면 1, 2, 3… (8종류까지) |
| `retained` | 결과 · 필수 | 전환, 구매, 리텐션처럼 늘리고 싶은 값. 0/1이나 금액 |
| `coupon_cost` | 비용 · 선택 | 처치로 쓴 비용. 없으면 처치 1건당 1로 계산해요 |
| `visit_freq`, … | 공변량 · 1개 이상 | 처치 **전에** 측정한 사용자 특성. 문자 열은 범주로 바꿔요 |
| `user_id` | 제외 | ID 열은 모델에 넣지 않아요 |

- 처치는 무작위로 배정했어야 해요. 올리면 처치군과 대조군의 공변량 균형을 검사해서, 무작위 배정과 어긋나는 신호가 있으면 경고해요.
- 1,000행 이상이어야 하고, 사이클 수는 행 수에 맞춰 줄어들어요(사이클당 400행 이상).
- 웹에서는 100MB까지 올릴 수 있어요. 더 큰 파일은 로컬에서 실행하세요.

## 결과 읽는 법

- **참값과 관측**: 합성 데이터는 사용자마다 처치했을 때와 안 했을 때의 결과를 모두 알아서, 실제 효과(참값)로 순위를 매겨요. 실험 로그는 운영처럼 처치군과 대조군의 차이(관측)로 매겨요.
- **95% CI**: 처치군과 대조군을 각각 200번 다시 뽑아(부트스트랩) 구해요. 2위와 차이의 구간이 0을 포함하면 확실한 차이로 보지 않아요.
- **실험 로그의 한계**: 이미 진행한 실험 안에서 사용자를 다시 고른 결과예요. 로그에 없는 사용자나 다른 시기에는 다를 수 있으니, 집행 전에 작은 A/B 테스트로 확인하세요.

## 로컬 실행

```bash
pip install git+https://github.com/Funbucket/upliftlab
upliftlab                      # 화면을 열어요. upliftlab serve와 같아요
```

- `Successfully installed UNKNOWN-0.0.0`이 나오면 pip이 오래된 거예요(Ubuntu 22.04 기본 pip 22.0). `python3 -m pip install -U pip`으로 올린 뒤 다시 설치하세요.
- 4180 포트가 쓰이고 있으면 다음 빈 포트를 써요. `upliftlab serve --port 8080 --no-browser`처럼 바꿀 수 있어요.
- 127.0.0.1에만 열리고, 다른 출처의 요청은 거절해요. 내 코드를 내 컴퓨터에서 돌리는 도구예요.
- 알고리즘은 `upliftlab`을 실행한 Python 환경의 패키지를 그대로 써요. PyTorch가 있고 CUDA를 쓸 수 있으면 `context.device`가 `cuda:0`이 돼요.

### 명령줄

```bash
upliftlab run                                          # Criteo 표본, 기본 알고리즘 6개, 예산 40%
upliftlab run --data my_experiment.csv --out result.json
upliftlab run --data synthetic/base --algorithm my_model.py --mode quantile --target .3
upliftlab check my_model.py                            # 쓰는 라이브러리 확인 + 합성 데이터로 한 번 학습
```

`run`은 순위표와 결론 한 줄을 출력해요. `--out`으로 저장한 결과 JSON은 화면의 `실행 기록 → 결과 JSON 열기`로 열어서 보고서를 만들 수 있어요. 모든 옵션은 `upliftlab run --help`에 있어요.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--data` | `public/criteo` | `public/criteo`, `public/hillstrom`, `synthetic/base`, 또는 CSV 경로 |
| `--algorithms` | `all` | 기본 알고리즘 id를 쉼표로 |
| `--algorithm` | | 내 알고리즘 파일 (여러 번 쓸 수 있어요) |
| `--mode` | `budget` | `budget`, `quantile`, `knapsack`, `roi`, `validation` |
| `--budget` | `.4` | 후보 전원을 처치할 때의 예상 증분 비용 대비 예산 비율 |
| `--cycles` | `8` | 사이클 수 |
| `--explore` | `.2` | Explore 비율 ε |
| `--base-learner` | `ridge` | 기본 알고리즘의 회귀 모델. `tree`는 Gradient Boosting |
