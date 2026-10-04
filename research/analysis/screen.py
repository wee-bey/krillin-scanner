import sys
from common import *
col = sys.argv[1] if len(sys.argv) > 1 else 'Rv'
c = df[col].notna()
d = df[c].copy()
feats = {}
def bucket(name, s):
    feats[name] = s
bucket('dir', d['dir'])
bucket('tf', d['tf'])
bucket('grade', d['grade'])
bucket('fam', d['fam'])
bucket('alerted', d['alerted'])
bucket('stopPct', pd.cut(d['stopPct'], [0, 1, 2, 3, 5, 8, 100]))
bucket('score', pd.qcut(d['score'], 5, duplicates='drop'))
bucket('pot', pd.qcut(d['pot'], 5, duplicates='drop'))
bucket('rsPct', pd.cut(d['rsPct'], [-1, 20, 40, 60, 80, 101]))
bucket('rank', pd.cut(d['rank'], [0, 10, 25, 50, 75, 101]))
bucket('avgTP', pd.cut(d['avgTP'], [0, 1, 1.5, 2, 3, 5, 100]))
bucket('tp1R', pd.cut(d['tp1R'], [0, 0.75, 1, 1.5, 2, 3, 100]))
bucket('beWin', pd.qcut(d['beWin'], 5, duplicates='drop'))
bucket('nwarn', d['nwarn'].clip(0, 3))
bucket('nmiss', d['nmiss'].clip(0, 4))
bucket('conf', d['conf'].clip(0, 3))
bucket('entryDist', pd.qcut(d['entryDistPct'], 5, duplicates='drop'))
for k in [c for c in d.columns if c.startswith('w_') or c.startswith('m_')]:
    bucket(k, d[k])
for k in ['btc1d', 'btc4h', 'btcAtRes', 'btcReg4h', 'btcReg1d', 'b_bias1w']:
    bucket(k + '|dir', d[k].astype(str) + '|' + d['dir'])
bucket('b_chg30|dir', pd.cut(d['b_chg30'], [-100, -10, -3, 3, 10, 100]).astype(str) + '|' + d['dir'])
bucket('b_chg7|dir', pd.cut(d['b_chg7'], [-100, -5, -2, 2, 5, 100]).astype(str) + '|' + d['dir'])
bucket('b_chg90|dir', pd.cut(d['b_chg90'], [-100, -20, -5, 5, 20, 100]).astype(str) + '|' + d['dir'])
bucket('b_vol20', pd.qcut(d['b_vol20'], 4))
bucket('rsPct|dir', pd.cut(d['rsPct'], [-1, 30, 70, 101]).astype(str) + '|' + d['dir'])
bucket('hour', (d['hour'] // 4) * 4)
bucket('wday', d['wday'])
out = []
for name, s in feats.items():
    for v, g in d.groupby(s.astype(str), observed=True):
        a = stats(g[col].values, g['day'])
        h1 = g[g.H == 1]; h2 = g[g.H == 2]
        b1 = stats(h1[col].values, h1['day']); b2 = stats(h2[col].values, h2['day'])
        out.append(dict(feat=name, val=v, n=a['n'], avg=a['avg'], t=a['t'], n1=b1['n'], avg1=b1['avg'], t1=b1['t'], n2=b2['n'], avg2=b2['avg'], t2=b2['t']))
o = pd.DataFrame(out)
pd.set_option('display.width', 250); pd.set_option('display.max_rows', 500)
print('overall', stats(d[col].values, d['day']))
print(o.round(3).to_string())
o.to_csv(f'/home/claude/k/an/screen_{col}.csv', index=False)
