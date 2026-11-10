# 알고리즘 시작 템플릿

화면의 `알고리즘 추가`에서 선택하는 시작 파일이에요. 각 파일은 그대로 비교에 넣을 수 있는 완결된 알고리즘이고, upliftlab을 import하지 않아요.

- `start_sklearn.py`: scikit-learn T-Learner(정규화한 성과 − λ·비용). 브라우저와 로컬 모두에서 실행돼요.
- `start_lightgbm.py`: LightGBM T-Learner, 검증 셋으로 조기 종료해요. 브라우저와 로컬 모두에서 실행돼요.
- `start_pytorch.py`: PyTorch autograd로 순위 손실을 직접 줄여요. GPU가 있으면 GPU를 써요. 로컬 전용이에요.

세 템플릿 모두 처치가 여러 종류인 데이터에서 돌아가고, (행 수, 처치 수) 배열을 반환해요. scikit-learn과 LightGBM은 처치마다 모델을 학습하고, PyTorch는 출력이 처치 수만큼인 네트워크 하나를 학습해요.

템플릿을 추가하면 `upliftlab/bridge.py`의 `TEMPLATES`에 이름을 넣고 `npm run bundle:engine`을 실행해요.
