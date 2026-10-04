# Alts vs BTC: the top-alt basket bled -33%/yr over 2022-26 while BTC rose. Test the pair and regime versions.
import warnings; warnings.filterwarnings('ignore')
from strats import *
from run2 import basket_w, gate_sma, gate_ema_band, B
pd.set_option('display.width', 250)
def alts_basket(n):
    W = basket_w(n + 2).copy(); W['BTCUSDT'] = 0; W['ETHUSDT'] = 0      # top-n alts excluding BTC and ETH
    return W.div(W.sum(1).replace(0, np.nan), axis=0).fillna(0)
def btc_only():
    W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns); W['BTCUSDT'] = 1.0; return W
rows = []
def add(name, W):
    t = table(backtest(W.shift(1)))
    rows.append(dict(strategy=name, **{f'{p}': t.loc[p, 'sharpe'] for p in ['2022', '2023', '2024', '2025', '2026ytd', 'dev 22-24', 'test 25-26', 'replay yr', 'all']},
                     cagr=t.loc['all', 'cagr'], dd=t.loc['all', 'maxdd'], vol=t.loc['all', 'vol'], cagr_replay=t.loc['replay yr', 'cagr'], dd_replay=t.loc['replay yr', 'maxdd']))
for n in [10, 20, 50]:
    A = alts_basket(n)
    # beta-match: scale BTC leg so both legs have equal trailing vol
    volA = (A * RET.fillna(0)).sum(1).rolling(60, min_periods=20).std(); volB = RET['BTCUSDT'].rolling(60, min_periods=20).std()
    k = (volA / volB).clip(0.5, 3).fillna(1)
    pair = btc_only().mul(k, axis=0) - A
    add(f'long BTC / short top{n} alts (vol-matched)', pair / 2)
    add(f'short top{n} alts', -A)
    for ma in [50, 100, 200]:
        g = gate_sma(ma)
        dn = (g < 0).astype(float); up = (g > 0).astype(float)
        add(f'short top{n} alts when BTC<SMA{ma}', -A.mul(dn, axis=0))
        add(f'BTC>SMA{ma}: long BTC, else short top{n} alts', btc_only().mul(up, axis=0) - A.mul(dn, axis=0))
        add(f'pair only when BTC<SMA{ma}', (pair / 2).mul(dn, axis=0))
o = pd.DataFrame(rows)
print(o.round(2).to_string())
o.to_csv('/home/claude/k/an/run3.csv', index=False)
