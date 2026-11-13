"""Group statistics, cost curves, AUCC, Qini and uplift@k, used by the arena to score every algorithm the same way.

In a run these are offline metrics: each cycle's served model scores that cycle's explore group, a randomized holdout it
never trained on, and the cycles are pooled (see Run.summary). Pooling sums the curves instead of averaging per-cycle
ratios, because one cycle's total effect can be close to zero and Qini divides by it.
"""
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


def qini_draws(score, t, yr, rng, draws=200, points=20, chunk=50):
    """Bootstrap draws of the Qini curve with the ranking held fixed: an array of draws × (points + 1) values, from 0.

    Each draw gives every row a Poisson(1) weight, which resamples the users without sorting them again.
    """
    order = np.argsort(-np.asarray(score, dtype=np.float64), kind='stable')
    n = len(order)
    idx = np.round(np.arange(1, points + 1) * n / points).astype(int) - 1
    T = (np.asarray(t)[order] > 0).astype(np.float64)
    Y = np.asarray(yr, dtype=np.float64)[order]
    out = np.zeros((draws, points + 1))
    for start in range(0, draws, chunk):  # a chunk at a time keeps memory small for large explore groups
        W = rng.poisson(1., (min(chunk, draws - start), n)).astype(np.float64)
        nT, nC = np.cumsum(W * T, 1)[:, idx], np.cumsum(W * (1 - T), 1)[:, idx]
        rT, rC = np.cumsum(W * Y * T, 1)[:, idx], np.cumsum(W * Y * (1 - T), 1)[:, idx]
        with np.errstate(divide='ignore', invalid='ignore'):
            out[start:start + len(W), 1:] = np.where((nT > 0) & (nC > 0), nT * (rT / nT - rC / nC), 0.)
    return out


def qini_of_draws(values, points=20):
    """qini() for every row of a draws × (points + 1) array of curve values; a draw with no total effect is NaN."""
    f = np.arange(points + 1) / points
    area = ((f[1:] - f[:-1]) * (values[:, 1:] + values[:, :-1]) / 2).sum(1)
    total = values[:, -1]
    with np.errstate(divide='ignore', invalid='ignore'):
        return np.where(total != 0, (area - total / 2) / np.abs(total), np.nan)


def pooled(curves):
    """Curves of several cycles summed point by point. Value and cost are totals, so the sum is the curve of all the cycles
    together when each cycle targets the same top share by its own ranking."""
    return [{'f': p['f'], 'cost': float(sum(c[i]['cost'] for c in curves)), 'value': float(sum(c[i]['value'] for c in curves))} for i, p in enumerate(curves[0])]


def top_sums(score, k, t, yr):
    """The sums uplift@k needs, so cycles can be pooled: (Σy treated, n treated, Σy control, n control) in the top k share."""
    order = np.argsort(-np.asarray(score, dtype=np.float64), kind='stable')
    top = order[:max(1, int(round(len(order) * k)))]
    treated = np.asarray(t)[top] > 0
    y = np.asarray(yr, dtype=np.float64)[top]
    return float(y[treated].sum()), int(treated.sum()), float(y[~treated].sum()), int((~treated).sum())


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
