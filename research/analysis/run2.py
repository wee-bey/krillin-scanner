# Market-level trend (regime) strategies: is the whole crypto market trending up or down, and trade it with
# BTC or a basket of the top alts. Every parameter variant is reported, not just the best.
from strats import *
pd.set_option('display.width', 250)
B = CL['BTCUSDT']
def basket_w(n):
    U = topn(n); vol = RET.rolling(30, min_periods=15).std()
    iv = (1 / vol).where(U)
    return iv.div(iv.sum(1), axis=0).fillna(0)          # inverse-vol weights, gross 1
def gate_sma(ma, src=B):
    s = src.rolling(ma).mean(); return np.sign(src - s)
def gate_ema_band(src=B, fast=13, slow=21):
    """Krillin's trend band on the daily: up when EMA13 > EMA21 and close > EMA21, down when the reverse"""
    f = src.ewm(span=fast, adjust=False).mean(); s = src.ewm(span=slow, adjust=False).mean()
    g = pd.Series(0.0, index=src.index); g[(f > s) & (src > s)] = 1; g[(f < s) & (src < s)] = -1
    return g
def gate_donch(src=B):
    st = sum(donchian_state(n)[src.name] for n in NS) / len(NS); return st
def build(gate, asset, ls):
    g = gate.copy()
    if not ls: g = g.clip(lower=0)
    if asset == 'BTC':
        W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns); W['BTCUSDT'] = g
    elif asset == 'BTC+ETH':
        W = pd.DataFrame(0.0, index=CL.index, columns=CL.columns); W['BTCUSDT'] = g * 0.5; W['ETHUSDT'] = g * 0.5
    else:
        W = basket_w(int(asset[3:])).mul(g, axis=0)
    return W.shift(1)
def _main():
  gates = {'SMA50': gate_sma(50), 'SMA100': gate_sma(100), 'SMA200': gate_sma(200), 'EMA13/21 band': gate_ema_band(),
           'Donchian ens': gate_donch()}
  rows = []
  for gn, g in gates.items():
      for asset in ['BTC', 'BTC+ETH', 'top10', 'top20', 'top50']:
          for ls in [False, True]:
              W = build(g, asset, ls); res = backtest(W); t = table(res)
              rows.append(dict(gate=gn, asset=asset, side='L/S' if ls else 'long', **{f'sh {p}': t.loc[p, 'sharpe'] for p in ['2022', '2023', '2024', '2025', '2026ytd', 'dev 22-24', 'test 25-26', 'replay yr']},
                               cagr_all=t.loc['all', 'cagr'], dd_all=t.loc['all', 'maxdd'], vol=t.loc['all', 'vol']))
  o = pd.DataFrame(rows)
  print(o.round(2).to_string())
  # buy & hold references
  for asset in ['BTC', 'top20']:
      W = build(pd.Series(1.0, index=CL.index), asset, False); t = table(backtest(W))
      print('buy&hold', asset, t[['cagr', 'sharpe', 'maxdd']].round(2).T.to_string())
  o.to_csv('/home/claude/k/an/run2.csv', index=False)

if __name__ == "__main__":
    _main()
