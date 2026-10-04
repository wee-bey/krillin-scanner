# Strategy families from outside the course, with parameters taken from published work / common practice
# (not tuned on this data). Each returns a weight panel W for day d, built only from data up to close d-1.
from bt import *
def donchian_state(N, shorts=True):
    """+1 after a close above the prior N-day high close, held until a close below the N-day channel midline;
    -1 symmetric for breakdowns (if shorts). Evaluated at each close; the caller shifts by one day."""
    hh = CL.shift(1).rolling(N, min_periods=N).max(); ll = CL.shift(1).rolling(N, min_periods=N).min()
    mid = (CL.rolling(N, min_periods=N).max() + CL.rolling(N, min_periods=N).min()) / 2
    up = CL > hh; dn = CL < ll
    exit_long = CL < mid; exit_short = CL > mid
    st = np.zeros(CL.shape); cur = np.zeros(CL.shape[1])
    U = up.values; D = dn.values; XL = exit_long.values; XS = exit_short.values
    for i in range(len(CL)):
        cur = np.where((cur > 0) & XL[i], 0, cur)
        cur = np.where((cur < 0) & XS[i], 0, cur)
        cur = np.where(U[i], 1, cur)
        if shorts: cur = np.where(D[i], -1, cur)
        nan = np.isnan(CL.values[i]); cur = np.where(nan, 0, cur)
        st[i] = cur
    return pd.DataFrame(st, index=CL.index, columns=CL.columns)
NS = [10, 20, 30, 60, 90, 150, 250]
_cache = {}
def trend_signal(shorts=True, Ns=NS):
    key = (shorts, tuple(Ns))
    if key not in _cache:
        _cache[key] = sum(donchian_state(n, shorts) for n in Ns) / len(Ns)
    return _cache[key]
def S_trend(n_univ=20, shorts=True, target=0.20, Ns=NS, gross=2.0):
    sig = trend_signal(shorts, Ns)
    U = topn(n_univ)
    vol = RET.rolling(30, min_periods=15).std() * np.sqrt(365)
    W = (sig * (target / vol) / n_univ).where(U).fillna(0)       # equal risk budget per coin
    W = cap(W, gross)
    return W.shift(1)
def S_xsmom(look=28, n_univ=100, frac=0.1, hold=7, longshort=True, skip=1):
    """cross-sectional momentum: every `hold` days rank by return over `look` days (skipping the last `skip`),
    long the top `frac`, short the bottom `frac`, inverse-vol weights, gross 1 per side"""
    U = topn(n_univ)
    past = CL.shift(skip) / CL.shift(skip + look) - 1
    past = past.where(U)
    vol = RET.rolling(30, min_periods=15).std()
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns)
    last = None
    for i, d in enumerate(CL.index):
        if i % hold == 0 or last is None:
            row = past.loc[d].dropna()
            if len(row) < 20: last = pd.Series(0.0, index=CL.columns); W.loc[d] = last; continue
            k = max(1, int(len(row) * frac))
            top = row.nlargest(k).index; bot = row.nsmallest(k).index
            iv = 1 / vol.loc[d]
            w = pd.Series(0.0, index=CL.columns)
            w[top] = iv[top] / iv[top].sum()
            if longshort: w[bot] = -iv[bot] / iv[bot].sum()
            last = w.fillna(0)
        W.loc[d] = last
    return W.shift(1)
def S_btc_regime(ma=100, asset='BTCUSDT', basket=None):
    """long BTC (or an equal-weight basket of the top-n) only while BTC closes above its `ma`-day SMA"""
    b = CL['BTCUSDT']; on = (b > b.rolling(ma).mean()).astype(float)
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns)
    if basket:
        U = topn(basket)
        W = U.astype(float).div(U.sum(1), axis=0).mul(on, axis=0)
    else:
        W[asset] = on
    return W.shift(1)
def S_funding(n_univ=100, frac=0.1, hold=1, look=3):
    """contrarian crowding: short the highest average funding over `look` days, long the lowest"""
    U = topn(n_univ)
    f = FUND.rolling(look, min_periods=1).mean().where(U)
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns)
    rk = f.rank(axis=1, pct=True)
    W[rk >= 1 - frac] = -1.0; W[rk <= frac] = 1.0
    W = W.div(W.abs().sum(1).replace(0, np.nan), axis=0).fillna(0) * 2
    return W.shift(1)
def S_reversal(n_univ=100, frac=0.1):
    """1-day short-term reversal: long yesterday's biggest losers, short the biggest winners"""
    U = topn(n_univ); r = RET.where(U); rk = r.rank(axis=1, pct=True)
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns)
    W[rk >= 1 - frac] = -1.0; W[rk <= frac] = 1.0
    W = W.div(W.abs().sum(1).replace(0, np.nan), axis=0).fillna(0) * 2
    return W.shift(1)
