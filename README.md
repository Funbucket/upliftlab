# upliftlab

실험 데이터를 넣으면, **어떤 모델로 대상을 고를 때 같은 예산에서 증분 성과가 가장 큰지** 운영 환경처럼 시뮬레이션하고, 결과를 보고서로 팀에 공유하는 도구예요.

**바로 써 보기: https://uplift-lab.vercel.app** · 설치가 필요 없고, 데이터는 브라우저 밖으로 나가지 않아요.

## 어떤 문제를 푸나요

쿠폰이나 리워드를 줄 대상을 uplift 모델로 고를 때, Qini나 AUUC 같은 오프라인 지표에서 1등인 모델이 실제 운영에서도 1등이라는 보장은 없어요. 운영에서는 이런 일이 함께 일어나요.

- 무작위로 고른 Explore 그룹으로 모델을 학습하고, 그 모델이 나머지 후보 중 Exploit 그룹을 골라요.
- Exploit 그룹 안에서도 처치군과 대조군을 나눠 증분 효과를 재고, 사이클마다 다시 학습해요.
- 쿠폰에는 비용이 들고, 대상은 예산이나 인원 같은 선정 규칙으로 정해요.

upliftlab은 모든 모델에게 같은 사용자와 같은 Explore 그룹을 주고 이 과정을 사이클마다 반복해요. 그래서 모델 사이의 차이는 Exploit을 어떻게 골랐는지에서만 생겨요.

## 누가 쓰나요

| 사용자 | 하는 일 |
|---|---|
| 현업 분석가·마케터 | 웹에서 실험 로그 CSV를 올리고, 기본 제공 모델을 비교하고, HTML·PDF 보고서나 요약을 팀에 공유해요. |
| 데이터 과학자 | 내 알고리즘을 Python 파일로 추가해 같은 조건에서 비교해요. 큰 데이터나 GPU가 필요하면 로컬에서 실행해요. |

## 웹에서 쓰기

1. **데이터셋과 알고리즘을 골라요.** 합성 시장 4개가 있고, 직접 실험한 로그 CSV를 올릴 수 있어요. 처음이면 업로드 화면의 `예시 파일로 해 보기`로 시작하세요.
2. **시뮬레이션을 실행해요.** 기본 8사이클이고, 브라우저 안의 Python(Pyodide)에서 10–20초쯤 걸려요.
3. **결과를 공유해요.** 1위와 그 근거(증분 성과, Random 대비, 2위 대비, 95% CI)를 확인하고, `보고서 공유`에서 HTML 보고서, PDF, 요약 복사를 골라요. 보고서에는 집계 결과만 들어가요.

### 실험 로그 형식

처치를 **무작위로 배정한** 실험 로그여야 하고, 1,000행 이상이어야 해요. 열 이름은 자유이고, 올린 뒤 열마다 역할을 골라요.

| 예시 열 | 역할 | 값 |
|---|---|---|
| `treatment` | 처치 · 필수 | 0 = 대조군, 1 = 처치. 처치가 여러 종류면 1, 2, 3… (8종류까지) |
| `retained` | 결과 · 필수 | 전환, 구매, 리텐션처럼 늘리고 싶은 값. 0/1이나 금액 |
| `coupon_cost` | 비용 · 선택 | 처치로 쓴 비용. 없으면 처치 1건당 1로 계산해요 |
| `visit_freq`, … | 공변량 · 1개 이상 | 처치 **전에** 측정한 사용자 특성. 문자 열은 범주로 바꿔요 |
| `user_id` | 제외 | ID 열은 모델에 넣지 않아요 |

### 선정 방식

| 방식 | 규칙 | 순위 기준 |
|---|---|---|
| 예산 · 점수 순 (기본) | 점수 순으로 더하다가 예상 증분 비용이 예산을 넘기 직전에 멈춰요 | 같은 예산에서의 증분 성과 |
| 상위 q% | 점수 상위 q%를 골라요 | 같은 인원에서의 비용 효율 개선 |
| 예산 · Knapsack | 효과 − λ·비용이 양수인 사용자를 고르고, λ를 예산에 맞춰요 | 증분 성과 |
| 효율 제약 · ROI | 효과 ÷ 비용 순으로 더하다가 예상 효율이 기준 아래로 내려가기 전에 멈춰요 | 기준을 지킨 알고리즘 중 증분 성과 |
| validation 최적 비율 | validation 행에서 총 증분 성과가 가장 큰 비율까지 골라요 | 증분 성과 |

## 로컬에서 쓰기

같은 화면과 엔진을 내 컴퓨터의 Python에서 실행해요. 설치된 패키지와 GPU를 모두 쓸 수 있어요.

```bash
git clone https://github.com/Funbucket/upliftlab
cd upliftlab
pip install -e engine        # NumPy, scikit-learn
upliftlab serve              # http://127.0.0.1:4180 이 브라우저로 열려요
```

화면 없이 비교만 돌리고 결과 JSON을 만들 수도 있어요. 결과 JSON은 화면의 `실행 기록 → 결과 JSON 열기`로 열어요.

```bash
upliftlab run --data my_experiment.csv --out result.json
upliftlab run --data synthetic/base --algorithm my_model.py --mode budget --budget .3
upliftlab check my_model.py  # 쓰는 라이브러리 확인 + 합성 데이터로 한 번 학습
```

## 내 알고리즘 추가하기

알고리즘은 `class Model` 하나를 담은 평범한 Python 파일이에요. upliftlab을 import하지 않고, scikit-learn, LightGBM, PyTorch 같은 라이브러리를 그대로 써요. 점수가 높은 순서로 Exploit 그룹을 골라요.

```python
class Model:
    def fit(self, train, validation, context):   # train.X, train.t, train.y, train.cost
        ...
    def predict(self, X):                         # 사용자마다 점수 하나 (처치가 K종류면 (n, K))
        ...
```

웹에서는 `알고리즘 추가`에서 시작 틀(scikit-learn, LightGBM, PyTorch)을 골라 편집하고, 로컬에서는 `--algorithm my_model.py`로 넘겨요. 자세한 계약은 [engine/README.md](engine/README.md)에 있어요.

## 개발

```bash
pip install -e "engine[dev]"   # numpy, scikit-learn, pytest, lightgbm
npm ci
npm test                       # 엔진 테스트 (pytest)
npm run dev                    # 로컬판: http://127.0.0.1:4180
npm run dev:browser            # 정적 서버. 엔진은 브라우저 Pyodide로 실행
npm run bundle:engine          # engine/을 고친 뒤 web/engine-files.js와 web/catalog.js를 다시 만들어요
npm run build                  # 단일 파일 dist/index.html과 패키지용 engine/upliftlab/ui/index.html
```

```text
engine/upliftlab/        공통 Python 엔진 (브라우저와 로컬이 같은 파일을 실행)
  arena.py               운영 루프 · 선정 방식 · 요약 · 부트스트랩 구간
  scenario.py            합성 시장과 실험 로그 replay
  datasets.py            CSV 해석·열 매핑·데이터 검사 · 예시 실험 로그
  metrics.py             Cost Curve · AUCC · Qini · Uplift@k
  algorithms/ templates/ 기본 알고리즘과 새 알고리즘 시작 틀
  bridge.py server.py    JSON 호출 규약 · 로컬 서버 · __main__.py (upliftlab 명령)
web/                     화면: app.js, store.js, summary.js(결론), report.js(보고서), views/
scripts/                 빌드와 예시 결과 생성
tests/                   엔진 테스트
```

변경 기록은 [CHANGELOG.md](CHANGELOG.md)에 있어요.

## 라이선스

[MIT](LICENSE). 함께 배포하는 Noto Sans KR 글꼴은 SIL Open Font License(`web/fonts/LICENSE`), 편집기 번들의 라이선스는 `web/vendor/LICENSES.txt`를 따라요.
