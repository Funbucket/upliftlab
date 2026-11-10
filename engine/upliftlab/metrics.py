"""Group statistics, cost curves, AUCC, Qini and uplift@k, used by the arena to score every algorithm the same way."""
import numpy as np


def cell(t, yr, yc):
    t = np.asarray(t) > 0
    nT, nC = int(t.sum()), int((~t).sum())
    out = {'n': nT + nC, 'nT': nT, 'nC': nC, 'retainT': None, 'retainC': None, 'ateR': None, 'ateC': None, 'R': None,
           'spend': float(yc.sum()), 'redeemed': int((yc[t] > 0).sum())}
    if nT and nC:
        out.update(retainT=float(yr[t].mean()), retainC=float(yr[~t].mean()), ateR=float(yr[t].mean() - yr[~t].mean()), ateC=float(yc[t].mean() - yc[~t].mean()))
        out['R'] = out['ateR'] / out['ateC'] if out['ateC'] else None
    return out


def cost_curve(score, t, yr, yc, points=20, tau_r=None, tau_c=None):
    """Rank by score; for each top fraction S, n₁(S)·(Ȳ_T − Ȳ_C) for value and cost. With tau_* it sums true effects."""
    order = np.argsort(-np.asarray(score, dtype=np.float64), kind='stable')
    n = len(order)
    idx = np.round(np.arange(1, points + 1) * n / points).astype(int) - 1
    if tau_r is not None:
        value, cost = np.cumsum(tau_r[order])[idx], np.cumsum(tau_c[order])[idx]
    else:
        T = (np.asarray(t)[order] > 0).astype(np.float64)
        nT, nC = np.cumsum(T)[idx], np.cumsum(1 - T)[idx]
        rT, rC = np.cumsum(yr[order] * T)[idx], np.cumsum(yr[order] * (1 - T))[idx]
        cT, cC = np.cumsum(yc[order] * T)[idx], np.cumsum(yc[order] * (1 - T))[idx]
        ok = (nT > 0) & (nC > 0)
        with np.errstate(divide='ignore', invalid='ignore'):
            value = np.where(ok, nT * (rT / nT - rC / nC), 0.)
            cost = np.where(ok, nT * (cT / nT - cC / nC), 0.)
    return [{'f': 0., 'cost': 0., 'value': 0.}] + [{'f': (i + 1) / points, 'cost': float(c), 'value': float(v)} for i, (c, v) in enumerate(zip(cost, value))]


def aucc(points):
    """Area under the curve normalized by its maximum cost and value. Random ranking ≈ 0.5, which is not a lower bound."""
    X, Y = max(p['cost'] for p in points), max(p['value'] for p in points)
    if not (X > 0 and Y > 0):
        return None
    return float(sum((b['cost'] - a['cost']) / X * (b['value'] + a['value']) / Y / 2 for a, b in zip(points, points[1:])))


def qini(points):
    """Area between the Qini curve and the random line, as a share of the incremental outcome of treating everyone.

    The Qini curve is the incremental outcome n₁(S)·(Ȳ_T − Ȳ_C) against the share of users targeted, which is the value
    column of the cost curve. Random ranking ≈ 0; a positive value means the top of the ranking holds more of the effect.
    """
    total = points[-1]['value']
    if not total:
        return None
    area = sum((b['f'] - a['f']) * (a['value'] + b['value']) / 2 for a, b in zip(points, points[1:]))
    return float((area - total / 2) / abs(total))


def uplift_at(score, k, t=None, yr=None, tau_r=None):
    """Average treatment effect among the top k share of users by score."""
    order = np.argsort(-np.asarray(score, dtype=np.float64), kind='stable')
    top = order[:max(1, int(round(len(order) * k)))]
    if tau_r is not None:
        return float(np.mean(tau_r[top]))
    treated = np.asarray(t)[top] > 0
    if not treated.any() or treated.all():
        return None
    return float(yr[top][treated].mean() - yr[top][~treated].mean())
