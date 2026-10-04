# Daily portfolio backtester for perpetual futures, on the long Binance history.
# Weights for day d are decided from data up to the close of day d-1 and held from close d-1 to close d.
# Costs: 0.08% per unit of turnover (0.05% fee + 0.03% slippage, per side, as in the replay) and funding:
# a long pays the day's summed funding rate, a short receives it.
import pandas as pd, numpy as np
from hist import load, load_funding, C
P = load('d1'); F = load_funding(); U100 = pd.read_pickle(f'{C}/U100.pkl')
CL = P['c']; HI = P['h']; LO = P['l']; QV = P['qv']
RET = CL.pct_change(fill_method=None)
RET = RET.where(RET.abs() < 5)                      # guard against broken prints
FUND = F.reindex(index=CL.index, columns=CL.columns).fillna(0.0)
COST = 0.0008
def topn(n):
    """top-n by previous day's quote volume (from the 100-universe ranking)"""
    if n >= 100: return U100
    qv = QV.shift(1).where(U100)
    rk = qv.rank(axis=1, ascending=False)
    return rk <= n
def backtest(W, cost=COST, fund=True, name=''):
    """W: target weights decided at close of day d-1, applied to day d (index = day d)."""
    W = W.reindex(index=CL.index, columns=CL.columns).fillna(0.0)
    R = RET.fillna(0.0)
    gross = (W * R).sum(1)
    turn = W.diff().abs().sum(1).fillna(W.abs().sum(1))
    fcost = (W * FUND).sum(1) if fund else 0.0
    net = gross - cost * turn - fcost
    return pd.DataFrame({'net': net, 'gross': gross, 'turn': turn, 'fund': fcost, 'lev': W.abs().sum(1), 'nlong': (W > 0).sum(1), 'nshort': (W < 0).sum(1)})
def perf(r, ann=365):
    r = r.dropna()
    if len(r) < 5 or r.std() == 0: return dict(ret=np.nan, vol=np.nan, sh=np.nan, dd=np.nan, days=len(r))
    eq = (1 + r).cumprod(); dd = (eq / eq.cummax() - 1).min()
    cagr = eq.iloc[-1] ** (ann / len(r)) - 1
    return dict(ret=cagr, vol=r.std() * np.sqrt(ann), sh=r.mean() / r.std() * np.sqrt(ann), dd=dd, days=len(r))
PERIODS = [('2022', '2022-01-01', '2022-12-31'), ('2023', '2023-01-01', '2023-12-31'), ('2024', '2024-01-01', '2024-12-31'),
           ('2025', '2025-01-01', '2025-12-31'), ('2026ytd', '2026-01-01', '2026-10-03'),
           ('dev 22-24', '2022-01-01', '2024-12-31'), ('test 25-26', '2025-01-01', '2026-10-03'),
           ('replay yr', '2025-09-01', '2026-10-03'), ('all', '2022-01-01', '2026-10-03')]
def table(res, label=''):
    rows = []
    for nm, a, b in PERIODS:
        p = perf(res['net'].loc[a:b]); g = perf(res['gross'].loc[a:b])
        rows.append(dict(period=nm, cagr=p['ret'], vol=p['vol'], sharpe=p['sh'], maxdd=p['dd'], gross_sh=g['sh'],
                         turn=res['turn'].loc[a:b].mean(), lev=res['lev'].loc[a:b].mean(), fund_ann=res['fund'].loc[a:b].mean() * 365 if hasattr(res['fund'], 'loc') else 0))
    t = pd.DataFrame(rows).set_index('period')
    return t
def vol_scale(W_sig, target=0.20, lookback=30, cap_gross=2.0, per_asset_cap=0.5):
    """scale a signal panel (positions in units of 'conviction') to a target annual vol per asset, normalised by
    the number of names, then cap gross leverage. Uses vol known at close d-1 (the caller shifts)."""
    vol = RET.rolling(lookback, min_periods=lookback // 2).std() * np.sqrt(365)
    W = W_sig / vol
    W = W.clip(-per_asset_cap / 0.2 * target, per_asset_cap / 0.2 * target)
    return W
def cap(W, gross=2.0):
    g = W.abs().sum(1)
    k = (gross / g).clip(upper=1.0).fillna(0)
    return W.mul(k, axis=0)
def port_vol_target(W, target=0.20, lookback=60, max_lev=3.0):
    """scale the whole book to a target annual vol using its own trailing realised vol (no look-ahead)"""
    raw = backtest(W, cost=0, fund=False)['gross']
    rv = raw.rolling(lookback, min_periods=20).std().shift(1) * np.sqrt(365)
    k = (target / rv).clip(upper=max_lev).fillna(0)
    Wk = W.mul(k, axis=0)
    g = Wk.abs().sum(1); kk = (max_lev / g).clip(upper=1.0).fillna(0)
    return Wk.mul(kk, axis=0)
