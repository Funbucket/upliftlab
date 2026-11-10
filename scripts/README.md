# Build scripts

- `build.mjs` (`npm run build`): CodeMirror 편집기 번들(`web/vendor/editor.js`, `LICENSES.txt`), 엔진 파일 번들, 예시 결과, 자체 호스팅 한국어 글꼴(`web/fonts/`)을 만들고, 화면 전체를 단일 파일 `dist/index.html`로 묶어요. 같은 파일을 pip 패키지용 `engine/upliftlab/ui/index.html`에도 복사해요.
- `bundle-engine.mjs`: `engine/upliftlab`의 Python 파일을 브라우저 워커가 쓰는 `web/engine-files.js`로 묶어요.
- `build-catalog.py`: 엔진으로 데이터·알고리즘 목록과 첫 화면의 예시 결과(기본 시장, 예산 40%)를 계산해 `web/catalog.js`를 써요.

`npm run bundle:engine`은 앞의 두 단계만 실행해요. engine/을 고친 뒤 실행하세요.
