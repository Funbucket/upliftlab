# 개발 참여

## 준비

```bash
git clone https://github.com/Funbucket/upliftlab && cd upliftlab
pip install -e ".[dev]"        # 엔진 + numpy, scikit-learn, pytest, lightgbm
npm ci                         # 편집기 번들, 글꼴, esbuild
```

## 자주 쓰는 명령

```bash
npm test                       # 엔진 테스트 (pytest)
npm run check                  # 화면 JavaScript 문법 검사
npm run dev                    # 로컬판: http://127.0.0.1:4180, 엔진은 내 Python
npm run dev:browser            # 정적 서버: http://127.0.0.1:4173, 엔진은 브라우저 Pyodide
npm run bundle:engine          # engine/을 고친 뒤: web/engine-files.js와 web/catalog.js를 다시 만들어요
npm run build                  # 웹 배포용 단일 파일 dist/index.html
```

- `web/`은 빌드 없이 그대로 돌아가는 ES 모듈이에요. 로컬판 패키지도 `web/` 폴더를 그대로 담아요(`pyproject.toml`의 `upliftlab.ui`).
- 화면 파일을 고치면 모든 import의 `?v=` 값을 함께 올려요. 값이 섞이면 같은 모듈이 두 번 로드돼요.
- `web/engine-files.js`, `web/catalog.js`, `web/vendor/`, `web/fonts/`는 생성 파일이라 직접 고치지 않아요.

## 폴더 구조

```text
engine/upliftlab/        Python 엔진. 브라우저와 로컬이 같은 파일을 실행해요
  arena.py               운영 루프, 선정 방식, 요약, 부트스트랩 구간
  scenario.py            합성 시장과 실험 로그 replay
  datasets.py            CSV 해석, 열 매핑, 데이터 검사, 예시 실험 로그
  metrics.py             Cost Curve, AUCC, Qini, Uplift@k
  algorithms/            기본 알고리즘 (파일마다 class Model 하나)
  templates/             새 알고리즘 시작 틀
  bridge.py server.py    JSON 호출 규약, 로컬 서버, __main__.py (upliftlab 명령)
web/                     화면: app.js, store.js, summary.js(결론), report.js(보고서), views/
scripts/                 빌드와 예시 결과 생성
tests/                   엔진 테스트
docs/                    사용 안내와 README 이미지
```

## 바꾸기 전에

- 결론 문장과 숫자는 `web/summary.js` 한 곳에서 만들어요. 화면과 보고서가 같은 문장을 써요.
- 새 선정 방식이나 지표를 넣으면 `tests/test_engine.py`에 테스트를 더하고, [사용 안내](docs/guide.md)와 [변경 기록](CHANGELOG.md)을 함께 고쳐요.
