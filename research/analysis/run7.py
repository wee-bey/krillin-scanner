# Execution-delay check: decide at the 00:00 UTC daily close, trade h hours later (4h candles).
import warnings; warnings.filterwarnings('ignore')
import bt
from run6 import *
def ret_h(h):
    idx = CL.index
    look = idx + pd.Timedelta(days=1) + pd.Timedelta(hours=h) - pd.Timedelta(hours=4)
    Ph = C4.reindex(look); Ph.index = idx
    Ph = Ph.reindex(columns=CL.columns)
    R = Ph.pct_change(fill_method=None); return R.where(R.abs() < 5)
base_RET = bt.RET.copy()
g = switch(LINES['SMA100 (Krillin MA100)'])
rows = []
for h in [0, 4, 8, 12, 24]:
    Rh = ret_h(h)
    bt.RET = Rh.where(Rh.notna(), base_RET if h == 0 else np.nan)   # 4h data only covers the top-150 coins
    for bn, W in books(g).items():
        t = table(bt.backtest(W.shift(1)))
        rows.append(dict(delay_h=h, book=bn, all=t.loc['all', 'sharpe'], test=t.loc['test 25-26', 'sharpe'], replay=t.loc['replay yr', 'sharpe'], cagr_rep=t.loc['replay yr', 'cagr'], dd_all=t.loc['all', 'maxdd']))
bt.RET = base_RET
print(pd.DataFrame(rows).round(2).to_string())
