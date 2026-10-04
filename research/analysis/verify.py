# Independent re-implementation (no shared code with bt.py / strats.py): read the raw CSVs again and recompute
# the BTC regime book with plain loops, to check the headline numbers and look for look-ahead.
import gzip, csv, math, datetime as dt
H = '/home/claude/krillin-scanner/research/hist'
px = {}; fund = {}
with gzip.open(f'{H}/d1.csv.gz', 'rt') as f:
    for r in csv.DictReader(f):
        if r['sym'] == 'BTCUSDT': px[int(r['t'])] = float(r['c'])
with gzip.open(f'{H}/funding.csv.gz', 'rt') as f:
    for r in csv.DictReader(f):
        if r['sym'] == 'BTCUSDT':
            d = int(r['t']) // 86400000 * 86400000; fund[d] = fund.get(d, 0.0) + float(r['rate'])
ts = sorted(px); c = [px[t] for t in ts]; day = [dt.datetime.utcfromtimestamp(t / 1000).date() for t in ts]
N = 100; COST = 0.0008; TARGET = 0.30; LB = 60; MAXLEV = 2.0
def run(mode, lag=1, cost=COST):
    sig = [0.0] * len(c)
    for i in range(len(c)):
        if i >= N - 1:
            sma = sum(c[i - N + 1:i + 1]) / N
            s = 1.0 if c[i] > sma else (-1.0 if c[i] < sma else 0.0)
            sig[i] = s if mode == 'ls' else max(s, 0.0)
    raw = [0.0] * len(c); net = [0.0] * len(c); wprev = 0.0
    for i in range(1, len(c)):
        r = c[i] / c[i - 1] - 1
        w0 = sig[i - lag] if i - lag >= 0 else 0.0          # decided at the close `lag` days ago
        raw[i] = w0 * r
        past = raw[max(1, i - LB):i]                          # realised raw returns up to yesterday only
        if len(past) >= 20:
            m = sum(past) / len(past); sd = math.sqrt(sum((x - m) ** 2 for x in past) / (len(past) - 1)) * math.sqrt(365)
            k = min(TARGET / sd, MAXLEV) if sd > 0 else 0.0
        else:
            k = 0.0
        w = w0 * k
        if abs(w) > MAXLEV: w = math.copysign(MAXLEV, w)
        net[i] = w * r - cost * abs(w - wprev) - w * fund.get(ts[i], 0.0)
        wprev = w
    return net
def stats(net, a, b):
    xs = [net[i] for i in range(len(net)) if a <= day[i] <= b]
    m = sum(xs) / len(xs); sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))
    eq = 1.0; peak = 1.0; dd = 0.0
    for x in xs: eq *= 1 + x; peak = max(peak, eq); dd = min(dd, eq / peak - 1)
    cagr = eq ** (365 / len(xs)) - 1
    return f'Sharpe {m / sd * math.sqrt(365):+.2f}  CAGR {cagr * 100:+.1f}%  maxDD {dd * 100:.1f}%  t={m / sd * math.sqrt(len(xs)):+.2f}  days={len(xs)}'
D = dt.date
for mode in ['ls', 'long']:
    for lag, cost in [(1, COST), (2, COST), (1, 2 * COST)]:
        net = run(mode, lag, cost)
        print(f'BTC {mode:<4} MA{N} lag={lag} cost={cost:.4f} | all 2022-01-01→2026-10-03: {stats(net, D(2022,1,1), D(2026,10,3))}')
        print(f'{"":>36} | replay yr 2025-09-01→2026-10-03: {stats(net, D(2025,9,1), D(2026,10,3))}')
