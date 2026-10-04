# Build one feature table from the replay's monthly signal files + market.json + exit-variant R matrix.
import json, gzip, re, numpy as np, pandas as pd, os
D = '/home/claude/k/repo/data'
idx = json.load(open(f'{D}/index.json'))
mkt = json.load(open(f'{D}/market.json'))['days']
rows = []
WARN_PATTERNS = {
    'w_btcres': 'BTC sits at HTF resistance',
    'w_prepump': 'Pre-pump context',
    'w_2touch': 'Only 2 touches',
    'w_stochd': 'Daily stoch RSI maxed',
    'w_nocomp': 'compression breakout with it',
    'w_dailybull': 'Daily bias is bullish: treat as a hedge',
    'w_dailybear': 'Daily bias is bearish',
    'w_midrange': 'Mid-range',
    'w_shrink': 'highs shrinking',
    'w_lowsrise': 'lows rising',
    'w_stoch4': '4h stoch RSI not reset',
    'w_pump7': 'in 7 days: profit-taking',
    'w_tapped': 'trend tapped',
}
MISS_PATTERNS = {
    'm_room': 'Room to the next HTF',
    'm_bias': 'Daily bias ',
    'm_rs': 'than BTC over 7 days',
    'm_struct': 'structure ',
    'm_stoch': 'stoch RSI',
    'm_confl': 'Entry lines up',
    'm_btc': 'BTC daily',
    'm_nowarn': 'No warnings',
    'm_tl': 'trend line (3+ touches)',
}
for m in idx['months']:
    for s in json.load(open(f'{D}/signals-{m}.json'))['signals']:
        ev = s.get('ev') or {}
        ctx = s.get('ctx') or {}
        r = dict(id=s['id'], key=s['key'], t=s['t'], day=s['day'], S=s['S'], setup=s['setup'], fam=s.get('fam'),
                 tf=s['tf'], dir=s['dir'], grade=s['grade'], score=s.get('score'), pot=s.get('pot'),
                 alerted=s.get('alertedAt') is not None, px=s['px'], avg=s['avg'], stop=s['stop'],
                 stopPct=s.get('stopPct'), avgTP=s.get('avgTP'), room=s.get('room'), beWin=s.get('beWin'),
                 conf=s.get('conf'), ntp=len(s.get('tps') or []), size=s.get('size'), mult=s.get('mult'),
                 nwarn=len(s.get('warnings') or []), nmiss=len([x for x in (s.get('missing') or []) if not x.startswith('A+ requires')]),
                 btc1d=ctx.get('btc1d'), btc4h=ctx.get('btc4h'), btcAtRes=ctx.get('btcAtRes'),
                 btcReg4h=ctx.get('btcReg4h'), btcReg1d=ctx.get('btcReg1d'), rsPct=ctx.get('rsPct'), rank=ctx.get('rank'),
                 st=ev.get('st'), reason=ev.get('reason'), fill=ev.get('fill'), R=ev.get('R'), mfe=ev.get('mfe'), mae=ev.get('mae'),
                 tFill=ev.get('tFill'), tExit=ev.get('tExit'), upd=ev.get('upd'), amb=ev.get('amb'))
        # first TP distance in R, entry distance from price
        tps = s.get('tps') or []
        r['tp1R'] = tps[0][1] if tps and len(tps[0]) > 1 else None
        r['entryDistPct'] = (s['px'] - s['avg']) / s['px'] * 100 * (1 if s['dir'] == 'long' else -1)
        ws = s.get('warnings') or []
        for k, p in WARN_PATTERNS.items():
            r[k] = any(p in w for w in ws)
        ms = [x for x in (s.get('missing') or []) if not x.startswith('A+ requires')]
        for k, p in MISS_PATTERNS.items():
            hit = [x for x in ms if p in x]
            r[k] = 0 if not hit else (1 if all('(partly)' in x for x in hit) else 2)  # 0 satisfied/not applicable, 1 partly missing, 2 missing
        mm = re.search(r'\+(\d+)% in 7 days', ' '.join(ws))
        r['pump7'] = int(mm.group(1)) if mm else 0
        md = mkt.get(s['day'], {})
        for k in ['chg7', 'chg30', 'chg90', 'vol20', 'reg1d', 'reg4h', 'bias1d', 'bias4h', 'bias1w']:
            r['b_' + k] = md.get(k)
        rows.append(r)
df = pd.DataFrame(rows).sort_values('t', kind='stable').reset_index(drop=True)
# exit-variant matrix (rows in the same t-sorted order as meta.ids)
meta = json.load(open('/home/claude/k/research/meta.json'))
V = len(meta['variants'])
M = np.frombuffer(gzip.open('/home/claude/k/research/R.i16.gz').read(), dtype=np.int16).reshape(-1, V)
pos = {i: k for k, i in enumerate(meta['ids'])}
order = np.array([pos.get(i, -1) for i in df['id']])
print('ids matched', (order >= 0).sum(), 'of', len(df))
Mv = np.full((len(df), V), -32768, dtype=np.int16)
ok = order >= 0
Mv[ok] = M[order[ok]]
np.save('/home/claude/k/an/variantR.npy', Mv)
json.dump(meta['variants'], open('/home/claude/k/an/variants.json', 'w'))
df['dt'] = pd.to_datetime(df['t'], unit='ms', utc=True)
df['month'] = df['day'].str[:7]
df['hour'] = df['dt'].dt.hour
df['wday'] = df['dt'].dt.dayofweek
df.to_pickle('/home/claude/k/an/sig.pkl')
print(df.shape)
print(df[['R', 'st']].groupby('st').agg(['count', 'mean']))
