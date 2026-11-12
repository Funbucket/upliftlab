# Web UI v0.26

Uplift 알고리즘 시뮬레이션 화면. 빌드 없이 `web/`을 정적으로 서빙해도 동작한다.

- `index.html`, `app.js`: 헤더(실행 중 표시, 로컬 실행 안내, 실행 환경 팝오버)와 해시 라우터. 화면마다 새 요소에 마운트하고, 떠날 때 `destroy()`로 구독과 문서 리스너를 정리한다.
- `store.js`: 상태와 엔진 호출. 알고리즘(기본 + `localStorage`의 내 알고리즘), 데이터(카탈로그 + IndexedDB에 둔 업로드 파일), 설정 중인 시뮬레이션(`draft`, 페이지를 오가도 유지), 실행 기록(`localStorage`, 최근 12개, row-level 로그는 최근 3개만), 실행 중인 시뮬레이션(사이클 단위 일시정지·중지). `wordsFor`는 데이터셋의 결과·비용 이름을, `planOf`는 엔진과 같은 규칙으로 한 사이클의 구성을 계산한다.
- `views/workspace.js`: 주 화면. 히어로와 계측판(`home.js`), 설정 패널(`launcher.js`), 결과(`results.js`), 한 사이클의 흐름, 로컬 설치를 위에서 아래로 띄운다. 실행을 시작하면 결과로 스크롤한다.
- `views/home.js`: 주 화면 전용 조각. 번들된 예시를 사이클 1~8로 다시 보여 주는 계측판(누적 증분 성과, 순위, 선두와 차이, 마지막에 사진 판정), 사이클을 한 바퀴로 그린 트랙, 설치 탭. 움직임 줄이기 설정이면 마지막 장면만 보여 준다.
- `views/launcher.js`: 설정 패널. 맨 위에 현재 설정 칩, 아래에 데이터(타일), 모델(2열 카드, 최대 8개), 선정 방식과 그 핵심 값(예산 게이지 등)을 펼쳐 두고, 아래 줄에 `비교 시작`. 사이클 수, Explore 비율, 기본 모델, 시드는 `고급 설정`에 접혀 있다.
- `views/results.js`: 실행 정보, 진행 상황, 결론(`verdictPanel`: 박빙 여부를 말하는 제목, Random 대비, 1위와의 차이 forest plot, 순위 카드), 그 아래 순위표·1위가 고른 사용자·사이클별 지표·Row-level 로그·차트를 펼쳐 보여 준다. 시뮬레이션 구조와 지표 정의만 접는다.
- `summary.js`: 실행 결과 읽기. 순위 기준(참값·관측), 알고리즘 목록과 색, 1위의 Exploit 그룹 특성, 결론(`verdictOf`: 선정 방식에 맞춘 한 문장, 핵심 숫자, 기준과 95% CI 문장, 1위와의 차이 목록, Random 대비, 메신저용 텍스트). 화면은 `verdictPanel`, 보고서는 `verdictHtml`로 같은 결론을 그린다.
- `report.js`: 공유용 보고서. 단일 HTML 파일(결론, 순위, 1위가 고른 사용자, 사이클별 효율 개선, Cost Curve, 실험 조건, 읽는 법), 숨은 iframe으로 PDF 인쇄, 요약 복사. 집계 결과만 넣는다.
- `views/results.js`: 소개와 `시뮬레이션 구조`, 1위, 순위(상세 지표에 Qini, Uplift@k), 처치 분포(처치가 여러 종류일 때), Exploit 그룹 특성, 사이클 지표, row-level 로그와 CSV, 사이클별 효율 개선, Cost Curve와 Qini Curve, 지표 정의. 실행 중에는 사이클·알고리즘 진행을 실시간으로 갱신한다.
- `views/algorithms.js`: 코드 보기·복제·편집(CodeMirror), 검사, 빠른 검사, `.py` 내려받기. `알고리즘 추가`는 시작 템플릿(scikit-learn · LightGBM · PyTorch) 메뉴다. 쓰는 라이브러리와 지금 실행 환경에서의 상태를 보여 준다.
- `views/data.js`: 데이터셋 목록, 검사, 요약(공변량 분포, 미리 보기), CSV 업로드와 열 역할 매핑, 공개 데이터 다운로드.
- `charts.js`: 선 차트(한 y축, 십자선 툴팁, 키보드 ←/→), 구간 막대, 1위와의 차이 forest plot(`forestPlot`, 요소의 실제 폭으로 그려 휴대폰에서도 글자 크기가 같다). `lib.js`: 서식, 범주 색, 알고리즘 한 줄 정의(`BRIEF`), 조사(`josa`), 비용 단위(`unitFor`).
- `runtime.js`: `GET api/engine`이 로컬판이면 HTTP(NDJSON 스트림), 아니면 Pyodide 워커. 호출은 순서대로 실행되고 진행 이벤트는 실행 중인 호출에 속한다. 워커는 알고리즘 코드를 다루는 호출(`check`, `try_algorithm`, `run_start`) 전에 그 코드가 import하는 Pyodide 패키지를 불러오고(`loadPackagesFromImports`), PEP 723 블록에 적힌 패키지를 micropip으로 설치한다.
- `styles.css`: 다크 테마 하나. 색은 `:root` 토큰(배경 `--bg`, 면 `--card`/`--raise`, 강조 `--blue`)으로만 쓰고, 상태색은 초록(실행 중), 주황(사진 판정·경고), 빨강(오류)만 쓴다. 글꼴은 한국어 Pretendard, 숫자 Archivo(폭 축), 코드 Geist Mono.
- 생성 파일 · 직접 고치지 않는다: `engine-files.js`(`scripts/bundle-engine.mjs`), `catalog.js`(`scripts/build-catalog.py`, 데이터·알고리즘·시작 틀 목록과 예시 결과), `vendor/editor.js`, `fonts/`, `data/`(Criteo 표본과 라이선스, `scripts/sample-criteo.py`).

## 동작 규칙

- 첫 화면은 미리 계산한 예시 결과다. 엔진은 뒤에서 준비만 하고, 사용자가 `시뮬레이션 실행`을 누르기 전에는 아무것도 실행하지 않는다.
- 실행은 `run_start` 한 번과 `run_cycle` N번이다. 사이클 사이에서만 멈출 수 있어서 중지는 진행 중인 사이클을 마친 뒤 적용된다. 끝나거나 멈춘 실행은 기록에 저장된다.
- 합성 데이터는 참값 기준으로 순위를 매기고, 실험 로그는 관측 기준이다. 1위와의 차이 구간이 0을 포함하면 `유의차 없음`으로 표시한다.
- 라이브러리가 없는 알고리즘은 고를 수 없고, 이유(`로컬판 필요` 또는 `pip install …`)를 보여 준다.
- 업로드 파일은 브라우저 밖으로 나가지 않는다. 저장소를 쓸 수 없는 브라우저에서는 메모리에만 두고 화면에 알린다.

`npm run build`는 단일 HTML `dist/index.html`을 만든다. 이 파일도 Pyodide를 CDN(jsDelivr)에서 불러오므로 네트워크가 필요하다.
