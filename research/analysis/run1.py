from strats import *
pd.set_option('display.width', 220)
fmt = lambda t: t.round(3).to_string()
runs = {
    'trend L/S top20': lambda: S_trend(20, True),
    'trend long-only top20': lambda: S_trend(20, False),
    'trend L/S top50': lambda: S_trend(50, True),
    'trend long-only top50': lambda: S_trend(50, False),
    'xsmom 28d L/S': lambda: S_xsmom(28),
    'xsmom 7d L/S': lambda: S_xsmom(7, hold=7),
    'BTC>100d long BTC': lambda: S_btc_regime(100),
    'BTC buy&hold': lambda: S_btc_regime(1),
    'funding contrarian': lambda: S_funding(),
    'reversal 1d': lambda: S_reversal(),
}
summary = []
for nm, f in runs.items():
    W = f(); res = backtest(W); t = table(res)
    print(f'\n=== {nm}\n{fmt(t)}')
    for p in ['dev 22-24', 'test 25-26', 'replay yr', 'all']:
        summary.append(dict(strategy=nm, period=p, sharpe=t.loc[p, 'sharpe'], cagr=t.loc[p, 'cagr'], maxdd=t.loc[p, 'maxdd']))
    res.to_pickle(f'/home/claude/k/an/cache/res_{nm.replace(" ", "_").replace("/", "")}.pkl')
print(pd.DataFrame(summary).pivot(index='strategy', columns='period', values='sharpe').round(2))
