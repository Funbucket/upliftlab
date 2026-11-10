# Tests

`npm test`(`python3 -m pytest tests/test_engine.py -q`)는 브라우저 Pyodide와 로컬판이 같이 쓰는 엔진을 확인해요. 기본 알고리즘이 scikit-learn을 쓰므로 먼저 저장소 루트에서 `pip install -e ".[dev]"`를 실행하세요.

확인하는 것: 모든 알고리즘이 같은 사용자·같은 Explore 그룹을 쓰는지, 최근 3사이클 학습 창, AUCC 기준선, 비용을 보는 알고리즘이 앞서는 순위와 재현성, 1위와 차이 구간, 기본 알고리즘과 시작 틀의 빠른 검사, 사용자 코드 오류(줄 번호, NaN 점수, 학습 실패 시 이전 모델 유지), CSV 열 매핑과 비용 열 없는 데이터, Hillstrom 형식 변환, 라이브러리 상태와 설치 안내, 엔진 모듈 import 거절, PEP 723 의존성, Qini·Uplift@k 정의, 예산·Knapsack·ROI·validation 선정, 다중 처치, 예시 실험 로그, 로컬 화면 경로.
