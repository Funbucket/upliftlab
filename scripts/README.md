# Build scripts

- `build.mjs` (`npm run build`): CodeMirror 편집기 번들(`web/vendor/editor.js`, `LICENSES.txt`), 엔진 파일 번들, 예시 결과, 자체 호스팅 한국어 글꼴(`web/fonts/`)을 만들고, 화면 전체를 웹 배포용 단일 파일 `dist/index.html`로 묶고, `web/data/`를 `dist/data/`로 복사해요. 로컬판 패키지는 이 파일이 아니라 `web/` 폴더를 그대로 담아요.
- `bundle-engine.mjs`: `engine/upliftlab`의 Python 파일을 브라우저 워커가 쓰는 `web/engine-files.js`로 묶어요.
- `build-catalog.py`: 엔진으로 데이터·알고리즘 목록과 첫 화면의 예시 결과(Criteo 표본, 예산 40%)를 계산해 `web/catalog.js`를 써요. 예시는 EconML로 계산하므로 EconML이 있는 Python을 `UPLIFTLAB_PYTHON`으로 넘겨요.
- `sample-criteo.py`: Hugging Face의 Criteo 원본(약 310MB)을 저장하지 않고 받으면서 처치군과 대조군을 약 10만 행씩 뽑아 `web/data/criteo-uplift-sample.csv.gz`를 만들어요. `python3 -I scripts/sample-criteo.py web/data/criteo-uplift-sample.csv.gz`

`npm run bundle:engine`은 앞의 두 단계만 실행해요. engine/을 고친 뒤 실행하세요.
