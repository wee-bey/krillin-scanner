# The same regime book, but with Krillin's own daily lines on BTC as the switch:
# daily MA100 (SMA100), daily "EMA200" (= SMMA(99), Krillin's red line), daily MA300 (SMA300).
import warnings; warnings.filterwarnings('ignore')
from run4 import *
smma99 = B.ewm(alpha=1/99, adjust=False).mean()
lines = {'daily MA100': B.rolling(100).mean(), 'daily EMA200 (SMMA99)': smma99, 'daily MA300': B.rolling(300).mean()}
rows = []
for ln, s in lines.items():
    g = np.sign(B - s).fillna(0)
    for bn, W in books(g).items():
        if 'weakest' in bn: continue
        Wv = port_vol_target(W.shift(1), target=0.30, lookback=60, max_lev=2.0)
        res = backtest(Wv); t = table(res)
        rows.append(dict(line=ln, book=bn, **{p: t.loc[p, 'sharpe'] for p in ['2022', '2023', '2024', '2025', '2026ytd', 'dev 22-24', 'test 25-26', 'replay yr', 'all']},
                         cagr=t.loc['all', 'cagr'], dd=t.loc['all', 'maxdd'], cagr_rep=t.loc['replay yr', 'cagr'], dd_rep=t.loc['replay yr', 'maxdd'],
                         switches_yr=(g.diff().abs() > 0).loc['2022':].sum() / 4.75))
        res.to_pickle(f'/home/claude/k/an/cache/reg_{ln.split()[1]}_{bn.replace(" ", "").replace("|", "_").replace("/", "")}.pkl')
print(pd.DataFrame(rows).round(2).to_string())
