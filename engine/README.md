# UpliftLab engine

브라우저(Pyodide)와 로컬이 같은 파일을 실행하는 Python 엔진이다. 엔진 자체는 NumPy만 쓰고, 기본 알고리즘은 scikit-learn을 쓴다.

## 로컬

```bash
git clone https://github.com/Funbucket/upliftlab && cd upliftlab
pip install -e "engine[dev]"                 # numpy, scikit-learn, pytest, lightgbm
upliftlab serve                              # http://127.0.0.1:4180 을 브라우저로 열어요 (--no-browser로 끄기)
upliftlab check my_model.py                  # 쓰는 라이브러리 확인 + 합성 데이터로 한 번 학습
upliftlab run --data synthetic/base --algorithms all --cycles 8 --out result.json
upliftlab run --data public/hillstrom --algorithm my_model.py   # 공개 데이터는 원본에서 받아 ~/.cache/upliftlab에 둬요
upliftlab run --data my_experiment.csv --mode budget --budget .3
```

`upliftlab`은 `python -m upliftlab`과 같아요. `run`은 화면 없이 비교를 돌려 순위표를 출력하고, `--out` 결과 파일은 화면의 `실행 기록 → 결과 JSON 열기`로 볼 수 있어요. 선정 방식의 기본값은 `--mode budget`(예산 안에서 점수 순)이에요.

- 화면은 소스 체크아웃의 `web/`을 서빙하고, 체크아웃이 없으면 패키지에 든 단일 파일(`upliftlab/ui/index.html`, `npm run build`가 복사)을 서빙해요. `GET /api/engine`이 응답하면 화면이 자동으로 로컬 엔진을 써요. 학습 진행은 `POST /api/engine/<method>`의 NDJSON 줄로 흘러와요.
- 127.0.0.1에만 바인딩하고, 다른 출처의 POST는 거절해요. 사용자가 신뢰하는 자기 코드를 자기 컴퓨터에서 실행하는 모델이고, 공개 서버용 격리는 아니에요.
- 알고리즘은 `serve`를 실행한 Python 환경의 패키지를 그대로 써요. 가상환경을 쓰면 그 환경을 활성화한 상태에서 실행해요.
- PyTorch가 설치되어 있고 CUDA를 쓸 수 있으면 `context.device`가 `cuda:0`이 돼요. GPU를 쓸지는 알고리즘 코드가 정해요.

## 알고리즘 계약

알고리즘은 `class Model` 하나를 담은 완결된 Python 파일이다. upliftlab을 import하지 않는다(엔진 모듈 import는 검사에서 막는다). 필요한 함수는 파일 안에 두고, 라이브러리는 평소처럼 import한다.

```python
class Model:
    def fit(self, train, validation, context): ...   # context는 빼도 된다: fit(self, train, validation)
    def predict(self, X): return scores               # (행 수,) 배열. 처치가 K종류면 (행 수, K) 배열
    # 또는 {"score": scores, "eligible": bool 배열, "arm": 처치 번호 배열}
```

| 이름 | 내용 |
|---|---|
| `train`, `validation` | `X` (n×d NumPy 배열), `t` (0 = 대조군, 1~K = 처치), `y` (결과), `cost`, `propensity`, `treatments` (처치 수 K), `propensities` (처치별 P(T=k \| T∈{0,k})), `features` (열 이름). 최근 학습 창(기본 3사이클)의 explore 행을 60/20/20으로 나눈 학습·검증 부분 |
| `context` | `seed`, `model_seed`, `device`, `target_fraction`(q 또는 예산 비율), `cycle`, `base_learner`(`ridge` 또는 `tree`), `treatments`, `report(**metrics)` |
| `score` | 클수록 먼저 처치. 상위 q%, 또는 예산이 소진될 때까지 Exploit 대상. 입력 행 수와 같은 길이의 유한한 1차원 배열(NumPy 배열, 리스트, PyTorch 텐서). 처치가 K종류면 (행 수, K) 배열을 반환하고, 행마다 점수가 가장 큰 처치를 고른다. `arm`으로 직접 정할 수도 있다 |
| `report` | `step`, `total`, `loss` 같은 숫자를 보내면 실행 진행과 빠른 검사 화면에 그려진다 |

테스트 셋은 알고리즘에 전달하지 않는다. 엔진이 학습 뒤 검증 AUCC와 테스트 Cost Curve·AUCC를 계산한다. 하이퍼파라미터는 파일 맨 위 상수로 두는 것을 권장한다.

### 라이브러리

| 실행 위치 | 쓸 수 있는 것 |
|---|---|
| 브라우저 | Pyodide v0.27.7에 들어 있는 패키지는 import하면 처음 쓸 때 불러온다: NumPy 2.0, SciPy 1.14, pandas 2.2, scikit-learn 1.6, LightGBM 4.5, XGBoost 2.1, statsmodels 0.14, polars 등. 그 밖의 PyPI 순수 Python 패키지는 아래 PEP 723 블록에 적으면 실행 전에 micropip으로 설치한다. PyTorch처럼 브라우저용 빌드가 없는 패키지는 쓸 수 없다 |
| 로컬 | 실행한 Python 환경에 설치된 모든 패키지. PyTorch·CUDA, econml, causalml 등. 없는 패키지는 `pip install` 후 다시 검사한다 |

```python
# /// script
# dependencies = ["scikit-uplift"]
# ///
import sklift
```

검사(`check`)는 파일을 실행하지 않고 import와 의존성을 읽어 라이브러리마다 상태(설치됨 · 처음 쓸 때 불러옴 · PyPI에서 설치 · 로컬 필요 · 없음)를 돌려주고, 그다음 파일 맨 위를 실행해 `class Model`을 확인한다. 라이브러리가 없으면 그 줄 번호와 할 일(`pip install …` 또는 로컬에서 실행)을 알려 준다. 비교 실행도 시작 전에 모든 파일을 불러와 보고, 불러오지 못하면 시작하지 않는다.

### 노트북에서 돌려 보기

내려받은 `.py`는 엔진 없이 돈다.

```python
from types import SimpleNamespace
import numpy as np
from my_model import Model

def data(X, t, y, cost, features):
    K = int(t.max())
    return SimpleNamespace(X=X, t=t, y=y, cost=cost, propensity=np.full(len(t), (t > 0).mean()), features=features, treatments=K,
                           propensities=[(t == k).sum() / ((t == k) | (t == 0)).sum() for k in range(1, K + 1)])

context = SimpleNamespace(seed=0, model_seed=0, device='cpu', target_fraction=.4, cycle=1, base_learner='ridge', report=lambda **m: print(m))
model = Model()
model.fit(data(X_tr, t_tr, y_tr, c_tr, cols), data(X_va, t_va, y_va, c_va, cols), context)
scores = model.predict(X_new)
```

### 기본 알고리즘과 시작 틀

- `upliftlab/algorithms/`: 기본 알고리즘 6개. X-Learner, T-Learner, R-Learner, DML, Duality R-Learner는 scikit-learn, Random은 NumPy를 쓴다. 회귀 모델은 `context.base_learner`에 따라 Ridge 또는 HistGradientBoosting(`max_depth=3`, 100 iterations)이고, 다른 모델을 쓰려면 파일의 `base_model()`을 바꾼다. Ridge에서는 X-Learner와 T-Learner의 점수가 거의 같고(상관 0.99999), Gradient Boosting에서는 갈린다(기본 시장 상관 약 0.93). Duality R-Learner는 정규화한 성과와 비용의 CATE를 각각 학습한 뒤 τ̂ʳ − λ·τ̂ᶜ에서 λ를 고른다. Ridge는 목표에 선형이므로 Yᴱ = y/σ_y − λ·cost/σ_c를 λ마다 다시 학습한 결과와 같고, 단위를 바꿔도 순위가 같다. DML은 ê(x)도 3-fold로 추정해 처치가 공변량에 따라 달라져도 효과를 분리하고, 무작위 배정 데이터에서는 R-Learner와 거의 같다. 처치가 K종류면 모두 T=k와 T=0 행으로 처치마다 학습한다. 이전 알고리즘(Constrained Ranking, Direct Ranking, Ratio T-Learner, Response)은 `legacy/algorithms-v0.18/`에 있다.
- `upliftlab/templates/`: 화면의 `새 알고리즘`에서 고르는 시작 파일. scikit-learn T-Learner, LightGBM T-Learner(검증 셋 조기 종료), PyTorch 순위 모델(autograd, GPU). 목록은 `bridge.py`의 `TEMPLATES`.
- 기본 알고리즘을 추가하려면 `upliftlab/algorithms/<id>.py`를 만들고 `algorithms/__init__.py`의 `ORDER`에 id를 넣은 뒤, 저장소 루트에서 `npm run bundle:engine`으로 `web/engine-files.js`와 `web/catalog.js`를 다시 만든다. 이 명령은 예시 결과를 다시 계산하므로 scikit-learn이 설치된 Python이 필요하다.

## 비교 실행 (arena.py)

- 한 사이클: 후보 풀 → 무작위 Explore ε(모든 알고리즘 공통, 처치/대조 반씩) → 알고리즘마다 배포된 모델로 나머지 후보 점수 → 상위 q% 또는 예산 안에서 Exploit(처치/대조) → 결과 관측 → Explore 행만 학습 창(최근 3사이클)에 쌓기 → 알고리즘마다 `fit()` → 테스트 평가 → 배포. 사이클 1은 모델이 없어서 모두 같은 무작위 순서로 고른다.
- 예산 제약(`mode='budget'`): 이전 사이클까지의 Explore train 행으로 처치별 증분 비용 τ̂ᶜ를 Ridge로 추정한다(모든 알고리즘 공통, 양수로 자른다). 예산 = 예산 비율 × 후보 전원의 평균 τ̂ᶜ 합이다. 점수 순으로 τ̂ᶜ를 누적해 예산을 넘기 직전까지 선정한다. 비용 추정치가 없는 사이클 1은 후보의 예산 비율만큼 무작위로 선정한다.
- 다중 처치: Explore는 처치 K종류를 무작위로 배정하고(합성 데이터는 대조군 50%, 처치 50%를 K등분), Exploit의 처치군은 알고리즘이 고른 처치를 받는다. 실험 기록 재생에서는 기록된 처치가 고른 처치나 대조군인 행만 측정한다. 처치가 1종류면 난수 흐름이 그대로라 결과가 같다.
- 같은 시드면 사이클별 사용자, Explore 그룹, 학습 데이터 분할, 학습 초기값이 알고리즘과 무관하게 같다. 알고리즘 사이의 차이는 Exploit 선택에서만 생긴다.
- `fit()`이 실패하면 그 알고리즘은 이전 모델을 계속 쓰고(처음부터 실패하면 무작위), `predict()`가 실패한 사이클은 무작위로 고른다. 실패 횟수와 마지막 오류가 요약에 남는다.
- 요약(사이클 2부터, 각자 자기 모델로 고른 사이클): 사이클별 증분 결과·비용을 선정 인원으로 가중 합산해 R = 증분 결과 / 증분 비용, 효율 개선 = R_exploit / R_explore − 1. 처치·대조를 따로 부트스트랩(200회)해 95% 구간을 내고, 1위와의 차이는 같은 Explore 부트스트랩을 공유해 기준선 잡음을 상쇄한다. 합성 데이터는 고른 집단의 실제 효과(참값)로 순위를 매기고, 실험 데이터는 관측값으로 매긴다. 순위 기준은 상위 q%면 효율 개선, 예산 제약이면 증분 성과다(`summary.by`). 테스트 지표 AUCC, Qini, Uplift@k는 학습마다 계산해 평균한다.
- `quick_check`: 합성 기본 시장 3사이클 Explore 데이터로 한 번 학습·평가한다. 화면의 빠른 검사.

사이클 결과에는 화면이 쓰는 값도 들어 있다. `pool`(후보 풀의 공변량 평균·표준편차), 알고리즘별 `profile`(Exploit 그룹의 공변량 평균), `trace`(무작위 100행과 알고리즘별 점수 상위 8행의 X, T, Yʳ, Yᶜ, score, rank). 처치가 여러 종류면 `trace.arms[id]`에 알고리즘별 처치와 T, Yʳ, Yᶜ, τ가, 요약에 `armShare`가 들어 있다. 예산 제약이면 사이클의 `budget`과 알고리즘별 `planned`가 있다. 요약의 `baseR`·`baseTruthR`은 Exploit 인원으로 가중한 Explore의 R이다.

## 데이터 (scenario.py, datasets.py)

- 합성 시장 `synthetic/base`, `synthetic/loyal`, `synthetic/premium`, `synthetic/tiers`: 특성 4개, 사이클마다 2만 명. 모든 사용자의 처치했을 때와 안 했을 때 결과를 알고 있어 참값을 계산한다. `tiers`는 처치가 3종류다(보상 ×0.5, ×1, ×1.5). 효과는 ×0.55, ×1, ×1.3으로 포화되고 비용은 보상에 비례해서, 가장 큰 보상의 비용 효율이 가장 낮다.
- 실험 기록 재생: 무작위 배정 실험 CSV(1,000행 이상). 열 역할(처치 0 = 대조군, 1~K = 처치(8종류까지), 결과, 비용, 특성)은 이름으로 추측하고(`coupon`, `returned`, `coupon_cost`처럼 이름 안의 단어도 본다) 화면에서 바꿀 수 있다. 비용 열이 없으면 처치 1건당 1로 계산한다. 범주형 열은 고유값 20개까지 one-hot 인코딩하고, 공변량 결측값은 중앙값으로 대체한다. `quality()`가 처치 비율, 공변량 균형(SMD), ATEᶜ, 결과, 표본 크기를 검사해 `profile.checks`로 돌려준다. 행을 섞어 사이클마다 겹치지 않는 풀(최대 2만 행, 사이클마다 400행 이상)로 나누고(분할은 파일 내용과 시드로만 정해진다), Explore·Exploit 안의 처치/대조는 기록된 값을 그대로 쓴다. 기록된 처치가 무작위 배정이 아니면 결과를 인과 효과로 해석할 수 없다.
- 공개 데이터 `public/hillstrom`: 라이선스가 명시되지 않아 파일을 함께 배포하지 않는다. 로컬은 원본에서 받아 캐시에 두고, 브라우저에서는 사용자가 받은 파일을 올리면 형식을 알아보고 변환한다(이메일 발송 = 처치, visit = 결과, 지역·채널 0/1 특성).
- AUCC: 점수 상위 f%마다 n₁·(Ȳ처치 − Ȳ대조)를 이은 곡선을 최대 비용·결과로 정규화한 면적. 무작위 순위가 약 0.5이며 0.5는 하한이 아니다. 테스트 셋이 작으면 크게 흔들린다.
- Qini: 처치 대상 비율 f에 따른 증분 성과 곡선과 무작위 대각선 사이 넓이를 전체 처치 시 증분 성과로 나눈 값. 무작위 순위가 약 0이다. Uplift@k: 점수 상위 k의 ATEʳ(k는 q 또는 예산 비율). 둘 다 비용을 보지 않는다.

## 검증

`npm test`(= `python3 -m pytest tests/test_engine.py`, 먼저 `pip install -e "engine[dev]"`)가 공유되는 사용자·Explore 그룹, 학습 창, AUCC 기준선, 나란히 비교의 순위와 재현성, 1위와 차이 구간, 기본 알고리즘의 빠른 검사, 코드 오류 처리, CSV 매핑, Hillstrom 변환, 알고리즘 파일이 엔진을 import하지 않는지, 라이브러리 검사와 안내, PEP 723 의존성, 시작 틀의 빠른 검사(설치되지 않은 라이브러리의 틀은 건너뜀), Qini·Uplift@k 정의, 예산 소진과 예산 제약 순위, Gradient Boosting에서 X와 T의 차이, 처치가 공변량에 달린 로그에서 DML의 효과 추정, 다중 처치의 합성·업로드 실행을 확인한다.
