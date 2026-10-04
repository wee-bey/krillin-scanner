# Regime book, robustness grid: BTC vs its N-day average decides risk-on / risk-off.
# Books: BTC long/flat · BTC long/short · long BTC (risk-on) / short alt basket (risk-off) · weakest alts short.
# Whole book scaled to a 30% annual vol target from its own trailing vol (max 2x), costs + funding included.
import warnings; warnings.filterwarnings('ignore')
from strats import *
from run2 import basket_w, B
pd.set_option('display.width', 260)
def alts(n, weakest=None, look=30):
    U = topn(n + 2).copy(); U['BTCUSDT'] = False; U['ETHUSDT'] = False
    vol = RET.rolling(30, min_periods=15).std(); iv = (1 / vol).where(U)
    if weakest:
        rel = (CL / CL.shift(look)).div(B / B.shift(look), axis=0).where(U)   # return relative to BTC
        rk = rel.rank(axis=1, ascending=True)
        iv = iv.where(rk <= weakest)
    return iv.div(iv.sum(1), axis=0).fillna(0)
def one(sym):
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns); W[sym] = 1.0; return W
def regime(N, band=0.0):
    s = B.rolling(N).mean(); g = pd.Series(np.nan, index=B.index)
    g[B > s * (1 + band)] = 1; g[B < s * (1 - band)] = -1
    return g.ffill().fillna(0)
def books(g):
    up = (g > 0).astype(float); dn = (g < 0).astype(float)
    return {
        'BTC long/flat': one('BTCUSDT').mul(up, axis=0),
        'BTC long/short': one('BTCUSDT').mul(g, axis=0),
        'long BTC | short top20 alts': one('BTCUSDT').mul(up, axis=0) - alts(20).mul(dn, axis=0),
        'long BTC | short top50 alts': one('BTCUSDT').mul(up, axis=0) - alts(50).mul(dn, axis=0),
        'long BTC | short 10 weakest of top50': one('BTCUSDT').mul(up, axis=0) - alts(50, weakest=10).mul(dn, axis=0),
    }
rows = []
for N in [50, 75, 100, 150, 200]:
    for band in [0.0, 0.02]:
        g = regime(N, band)
        for bn, W in books(g).items():
            Wv = port_vol_target(W.shift(1), target=0.30, lookback=60, max_lev=2.0)
            res = backtest(Wv); t = table(res)
            sw = (g.diff().abs() > 0).loc['2022':].groupby(g.loc['2022':].index.year).sum().mean()
            rows.append(dict(N=N, band=band, book=bn, **{p: t.loc[p, 'sharpe'] for p in ['2022', '2023', '2024', '2025', '2026ytd', 'dev 22-24', 'test 25-26', 'replay yr', 'all']},
                             cagr=t.loc['all', 'cagr'], dd=t.loc['all', 'maxdd'], cagr_rep=t.loc['replay yr', 'cagr'], dd_rep=t.loc['replay yr', 'maxdd'], switches_yr=sw))
o = pd.DataFrame(rows)
print(o.round(2).to_string())
o.to_csv('/home/claude/k/an/run4.csv', index=False)
print('\nShare of variants with positive Sharpe, by book:')
yrs = ['2022', '2023', '2024', '2025', '2026ytd', 'test 25-26', 'replay yr']
print(o.groupby('book')[yrs].apply(lambda x: (x > 0).mean()).round(2))
print(o.groupby('book')[yrs + ['cagr', 'dd']].median().round(2))
