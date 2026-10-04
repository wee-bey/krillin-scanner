# Add candle-based features to every Krillin signal, using only the last daily candle CLOSED before the signal.
from strats import *
from common import df
import re
tr = trend_signal(True)                       # Donchian ensemble, -1..+1, evaluated at each daily close
trL = trend_signal(False)
sma200 = CL.rolling(200, min_periods=150).mean(); sma50 = CL.rolling(50, min_periods=40).mean()
ema20 = CL.ewm(span=20, adjust=False).mean()
vol30 = RET.rolling(30, min_periods=15).std() * np.sqrt(365)
f3 = FUND.rolling(3, min_periods=1).mean(); f14 = FUND.rolling(14, min_periods=3).mean()
qv30 = QV.rolling(30, min_periods=10).mean()
feats = {
    'c_tr': tr, 'c_trL': trL,
    'c_r7': CL / CL.shift(7) - 1, 'c_r30': CL / CL.shift(30) - 1, 'c_r90': CL / CL.shift(90) - 1,
    'c_d200': CL / sma200 - 1, 'c_d50': CL / sma50 - 1, 'c_d20': CL / ema20 - 1,
    'c_vol30': vol30, 'c_f3': f3, 'c_f14': f14, 'c_qvx': QV / qv30,
    'c_age': CL.notna().cumsum(),
}
sym = np.where(df['mult'] == 1000, '1000' + df['S'] + 'USDT', np.where(df['mult'] == 1e6, '1000000' + df['S'] + 'USDT', df['S'] + 'USDT'))
day_prev = (pd.to_datetime(df['t'], unit='ms', utc=True).dt.floor('D') - pd.Timedelta(days=1))
cols = {s: i for i, s in enumerate(CL.columns)}; rows = {d: i for i, d in enumerate(CL.index)}
ci = np.array([cols.get(s, -1) for s in sym]); ri = np.array([rows.get(d, -1) for d in day_prev])
okk = (ci >= 0) & (ri >= 0)
print('signals matched to candles:', okk.sum(), 'of', len(df))
out = pd.DataFrame(index=df.index)
for k, P_ in feats.items():
    a = P_.values; v = np.full(len(df), np.nan); v[okk] = a[ri[okk], ci[okk]]; out[k] = v
# BTC trend state
bt_ = tr['BTCUSDT'].values; v = np.full(len(df), np.nan); v[ri >= 0] = bt_[ri[ri >= 0]]; out['b_tr'] = v
out['sym'] = sym
out.to_pickle('/home/claude/k/an/sigfeat.pkl')
print(out.describe().T.round(3))
