import sys
from common import *
sf = pd.read_pickle('/home/claude/k/an/sigfeat.pkl')
d = pd.concat([df, sf.drop(columns=['sym'])], axis=1)
EXIT = sys.argv[1] if len(sys.argv) > 1 else 'base'
d['y'] = d['Rv'] if EXIT == 'base' else vR(vidx(*[float(v) if v.replace('.', '').isdigit() else v for v in EXIT.split(',')]))
d = d[d.y.notna()]
sg = np.where(d.dir == 'long', 1, -1)
d['tr_al'] = d.c_tr * sg            # coin trend aligned with the trade (+1 = fully with it)
d['btr_al'] = d.b_tr * sg
d['r30_al'] = d.c_r30 * sg; d['r7_al'] = d.c_r7 * sg; d['r90_al'] = d.c_r90 * sg
d['d200_al'] = d.c_d200 * sg; d['d50_al'] = d.c_d50 * sg; d['d20_al'] = d.c_d20 * sg
d['f3_al'] = d.c_f3 * sg            # funding the trade pays (+ = trade pays funding / crowded side)
feats = {
    'trend aligned': pd.cut(d.tr_al, [-1.01, -0.5, -0.01, 0.01, 0.5, 1.01]),
    'BTC trend aligned': pd.cut(d.btr_al, [-1.01, -0.5, -0.01, 0.01, 0.5, 1.01]),
    'coin 30d ret aligned': pd.qcut(d.r30_al, 5), 'coin 7d ret aligned': pd.qcut(d.r7_al, 5), 'coin 90d aligned': pd.qcut(d.r90_al, 5),
    'dist 200d aligned': pd.qcut(d.d200_al, 5), 'dist 50d aligned': pd.qcut(d.d50_al, 5), 'dist 20d EMA aligned': pd.qcut(d.d20_al, 5),
    'coin vol30': pd.qcut(d.c_vol30, 5), 'funding paid by trade (3d)': pd.qcut(d.f3_al, 5, duplicates='drop'),
    'volume vs 30d': pd.qcut(d.c_qvx, 5), 'listing age': pd.cut(d.c_age, [0, 90, 180, 365, 730, 5000]),
}
rows = []
for name, s in feats.items():
    for v, g in d.groupby(s.astype(str), observed=True):
        a = stats(g.y.values, g.day); b1 = stats(g[g.H == 1].y.values, g[g.H == 1].day); b2 = stats(g[g.H == 2].y.values, g[g.H == 2].day)
        rows.append(dict(feat=name, val=v, n=a['n'], avg=a['avg'], t=a['t'], avg1=b1['avg'], t1=b1['t'], avg2=b2['avg'], t2=b2['t']))
pd.set_option('display.width', 220); pd.set_option('display.max_rows', 300)
print(EXIT, 'overall H1', d[d.H == 1].y.mean().round(3), 'H2', d[d.H == 2].y.mean().round(3))
print(pd.DataFrame(rows).round(3).to_string())
