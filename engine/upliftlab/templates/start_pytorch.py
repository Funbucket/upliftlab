"""PyTorch로 '증분 비용 ÷ 증분 성과'를 직접 줄이는 순위 모델이에요. 기울기는 autograd가 계산하고, GPU가 있으면 GPU에서 돌아요.

브라우저에는 PyTorch가 없어서 로컬(python -m upliftlab serve)에서 실행해요. context.device가 'cuda:0'이면 GPU를 써요.
처치가 K종류면 네트워크 출력이 K개이고, 사용자마다 점수가 가장 큰 처치를 골라요.
"""
import torch

NAME = 'PyTorch 순위 모델'
EPOCHS = 300
HIDDEN = 16
LEARNING_RATE = 0.01


def lift(score, t, value, log_share):
    """score를 softmax한 정책으로 고른 (사용자, 처치)의 증분 value.

    처치군은 기록된 처치의 점수로, 대조군은 모든 처치의 점수로 가중해요. 한 softmax 안에서 처치끼리 경쟁하므로
    처치 사이의 점수를 비교할 수 있어요. log_share는 처치별 표본 크기의 차이를 보정해요.
    """
    treated, control = t > 0, t == 0
    arm = t[treated] - 1
    p_t = torch.softmax(score[treated, arm] - log_share[arm], 0)
    p_c = torch.softmax(score[control].flatten(), 0)
    return (p_t * value[treated]).sum() - (p_c * value[control].repeat_interleave(score.shape[1])).sum()


class Model:
    def fit(self, train, validation, context):
        torch.manual_seed(context.model_seed)
        self.device = torch.device(context.device if torch.cuda.is_available() else 'cpu')
        self.mean, self.std = train.X.mean(0), train.X.std(0) + 1e-9
        X, t = self.inputs(train.X), torch.as_tensor(train.t, device=self.device)
        y, cost = (torch.as_tensor(v, dtype=torch.float32, device=self.device) for v in (train.y, train.cost))
        log_share = torch.stack([(t == k).float().mean().log() for k in range(1, train.treatments + 1)])
        log_share = log_share - log_share.mean()
        self.net = torch.nn.Sequential(torch.nn.Linear(X.shape[1], HIDDEN), torch.nn.ReLU(), torch.nn.Linear(HIDDEN, train.treatments), torch.nn.Tanh()).to(self.device)
        optimizer = torch.optim.Adam(self.net.parameters(), lr=LEARNING_RATE)
        for epoch in range(1, EPOCHS + 1):
            score = self.net(X)
            loss = lift(score, t, cost, log_share) / lift(score, t, y, log_share).clamp_min(1e-4)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            if epoch == 1 or epoch % 10 == 0:
                context.report(step=epoch, total=EPOCHS, loss=loss.item())

    def inputs(self, X):
        return torch.as_tensor((X - self.mean) / self.std, dtype=torch.float32, device=self.device)

    def predict(self, X):
        with torch.no_grad():
            return self.net(self.inputs(X)).cpu().numpy()
