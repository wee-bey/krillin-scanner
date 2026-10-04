# Regime book v2: each leg is sized from ITS OWN trailing volatility (target 30%/yr per leg, max 2x),
# so flat periods don't distort the sizing. Robustness grid over the switch line, plus execution delay
# (decide at the 00:00 UTC daily close, trade 0 / 4 / 8 / 24 hours later, using 4h candles).
import warnings; warnings.filterwarnings('ignore')
from strats import *
from hist import load
pd.set_option('display.width', 260)
B = CL['BTCUSDT']
P4 = load('h4'); C4 = P4['c']
def alts_w(n):
    U = topn(n + 2).copy(); U['BTCUSDT'] = False; U['ETHUSDT'] = False
    vol = RET.rolling(30, min_periods=15).std(); iv = (1 / vol).where(U)
    return iv.div(iv.sum(1), axis=0).fillna(0)
def leg_scale(Wunit, target=0.30, lb=60, maxlev=2.0):
    """scale an always-on unit book to a target vol from its own trailing realised vol (known at close d)"""
    r = (Wunit.shift(1) * RET.fillna(0)).sum(1)          # returns of holding the unit book decided a day earlier
    sd = r.rolling(lb, min_periods=20).std() * np.sqrt(365)
    k = (target / sd).clip(upper=maxlev).fillna(0)
    return Wunit.mul(k, axis=0)
def one(sym):
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns); W[sym] = 1.0; return W
BTCv = leg_scale(one('BTCUSDT'))
ALT = {n: leg_scale(alts_w(n)) for n in [20, 50]}
def switch(line):
    return np.sign(B - line).fillna(0)
LINES = {'SMA50': B.rolling(50).mean(), 'SMA75': B.rolling(75).mean(), 'SMA100 (Krillin MA100)': B.rolling(100).mean(),
         'SMA150': B.rolling(150).mean(), 'SMA200': B.rolling(200).mean(), 'SMMA99 (Krillin EMA200)': B.ewm(alpha=1/99, adjust=False).mean()}
def books(g):
    up = (g > 0).astype(float); dn = (g < 0).astype(float)
    return {'BTC long/flat': BTCv.mul(up, axis=0), 'BTC long/short': BTCv.mul(g, axis=0),
            'long BTC | short top20 alts': BTCv.mul(up, axis=0) - ALT[20].mul(dn, axis=0),
            'long BTC | short top50 alts': BTCv.mul(up, axis=0) - ALT[50].mul(dn, axis=0)}
if __name__ == '__main__':
    rows = []
    for ln, line in LINES.items():
        g = switch(line)
        for bn, W in books(g).items():
            res = backtest(W.shift(1)); t = table(res)
            rows.append(dict(line=ln, book=bn, **{p: t.loc[p, 'sharpe'] for p in ['2022', '2023', '2024', '2025', '2026ytd', 'dev 22-24', 'test 25-26', 'replay yr', 'all']},
                             cagr=t.loc['all', 'cagr'], dd=t.loc['all', 'maxdd'], cagr_rep=t.loc['replay yr', 'cagr'], dd_rep=t.loc['replay yr', 'maxdd'], lev=t.loc['all', 'lev']))
            res.to_pickle(f'/home/claude/k/an/cache/v2_{ln.split()[0]}_{bn.replace(" ", "").replace("|", "_").replace("/", "")}.pkl')
    o = pd.DataFrame(rows); print(o.round(2).to_string()); o.to_csv('/home/claude/k/an/run6.csv', index=False)
    yrs = ['2022', '2023', '2024', '2025', '2026ytd', 'test 25-26', 'replay yr']
    print('\nshare of switch lines with a positive Sharpe:'); print(o.groupby('book')[yrs].apply(lambda x: (x > 0).mean()).round(2).to_string())
    print('\nmedian across switch lines:'); print(o.groupby('book')[yrs + ['all', 'cagr', 'dd', 'cagr_rep', 'dd_rep']].median().round(2).to_string())
