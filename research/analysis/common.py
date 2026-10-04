import pandas as pd, numpy as np, json
df = pd.read_pickle('/home/claude/k/an/sig.pkl')
M = np.load('/home/claude/k/an/variantR.npy')
VARS = json.load(open('/home/claude/k/an/variants.json'))
def vidx(e='ladder', m=1, x='ladder'):
    return [i for i, v in enumerate(VARS) if v['e'] == e and v['m'] == m and v['x'] == x][0]
def vR(j):
    a = M[:, j].astype(float)
    a[M[:, j] == -32768] = np.nan
    return a / 1000
JB = vidx()
df['Rv'] = vR(JB)                       # baseline, risk = price distance to stop, costs inside
df['H'] = np.where(df['month'] <= '2026-04', 1, 2)
df['Q'] = pd.PeriodIndex(df['day'], freq='Q').astype(str)
df['tfo'] = df['tf'].map({'15m': 0, '1h': 1, '4h': 2, '12h': 3, '1d': 4})
# cost of the round trip in R (fees 0.05%/side + 0.03% slippage), approx at plan stop distance
df['costR'] = (0.05 * 2 + 0.03) / df['stopPct']
df['cell'] = df['setup'] + '@' + df['tf'] + ':' + df['dir'].str[0]

def stats(r, days):
    """mean, n, PF, day-clustered t-stat for a vector of R with matching day labels"""
    m = ~np.isnan(r)
    r = r[m]; d = days[m]
    n = len(r)
    if n == 0:
        return dict(n=0, avg=np.nan, pf=np.nan, t=np.nan, win=np.nan, tot=0)
    s = pd.Series(r).groupby(d.values if hasattr(d, 'values') else d).sum()
    nd = len(s)
    mu = r.mean()
    # clustered SE: sum over days of (sum of residuals)^2
    res = pd.Series(r - mu).groupby(d.values if hasattr(d, 'values') else d).sum()
    se = np.sqrt((res ** 2).sum()) / n if nd > 1 else np.nan
    gp = r[r > 0].sum(); gl = -r[r < 0].sum()
    return dict(n=n, avg=mu, pf=gp / gl if gl > 0 else np.inf, t=mu / se if se and se > 0 else np.nan,
                win=(r > 0).mean(), tot=r.sum())
