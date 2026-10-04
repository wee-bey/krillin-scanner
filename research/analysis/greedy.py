# Greedy rule search: add one filter at a time, picking whatever most improves average R on the TRAIN half
# (keeping at least MIN trades), then report the same rule set on the TEST half it never saw.
import sys
from common import *
EXIT = sys.argv[1] if len(sys.argv) > 1 else 'base'
y = df['Rv'].values if EXIT == 'base' else vR(vidx(*[float(v) if v.replace('.', '').isdigit() else v for v in EXIT.split(',')]))
L = df['dir'] == 'long'; S = ~L
C = {
    'stop>=2%': df.stopPct >= 2, 'stop>=3%': df.stopPct >= 3, 'stop>=5%': df.stopPct >= 5,
    'tf>=4h': df.tfo >= 2, 'tf>=12h': df.tfo >= 3, 'not 1h': df.tf != '1h',
    'shorts only': S, 'longs only': L,
    'no warnings': df.nwarn == 0, '<=1 warning': df.nwarn <= 1,
    'no pre-pump warn': ~df.w_prepump, 'no shrinking-highs warn': ~df.w_shrink, 'no BTC-at-res warn': ~df.w_btcres,
    'no daily-stoch warn': ~df.w_stochd, 'no no-compression warn': ~df.w_nocomp,
    'daily bias not against': df.m_bias != 2, 'daily bias aligned': df.m_bias == 0,
    'RS aligned': (L & (df.rsPct >= 60)) | (S & (df.rsPct <= 40)),
    'RS strongly aligned': (L & (df.rsPct >= 80)) | (S & (df.rsPct <= 20)),
    'bids >=0.65% away': df.entryDistPct >= 0.65, 'bids >=1.4% away': df.entryDistPct >= 1.4,
    'confluence>=1': df.conf >= 1, 'grade A/A+': df.grade.isin(['A', 'A+']), 'grade not C': df.grade != 'C',
    'BTC 1d not against': (L & (df.btc1d != 'bearish')) | (S & (df.btc1d != 'bullish')),
    'BTC 4h with trade': (L & (df.btc4h == 'bullish')) | (S & (df.btc4h == 'bearish')),
    'BTC 30d with trade': (L & (df.b_chg30 > 0)) | (S & (df.b_chg30 < 0)),
    'BTC 7d with trade': (L & (df.b_chg7 > 0)) | (S & (df.b_chg7 < 0)),
    'BTC 90d with trade': (L & (df.b_chg90 > 0)) | (S & (df.b_chg90 < 0)),
    'not MA-levels family': df.fam != 'MA levels', 'not trend-cont family': df.fam != 'Trend continuation',
    'trend-line family': df.fam == 'Trend lines', 'compression family': df.fam == 'Compression',
    'room ok': df.m_room == 0, 'tp1 <=1.5R': df.tp1R <= 1.5, 'avgTP <=2R': df.avgTP <= 2,
    'top-50 coin': df['rank'] <= 50, 'low BTC vol': df.b_vol20 <= df.b_vol20.median(),
}
C = {k: v.values for k, v in C.items()}
ok = ~np.isnan(y)
def run(tr_h, te_h, MIN):
    tr = ok & (df.H.values == tr_h); te = ok & (df.H.values == te_h)
    mask = np.ones(len(df), bool); chosen = []
    base_tr = y[tr].mean()
    print(f'train H{tr_h} (min {MIN} trades): start {base_tr:+.3f}R  | test H{te_h} start {y[te].mean():+.3f}R')
    for step in range(8):
        best = None
        for k, v in C.items():
            if k in chosen: continue
            m = mask & v
            n = (m & tr).sum()
            if n < MIN: continue
            r = y[m & tr].mean()
            if best is None or r > best[1]: best = (k, r, n)
        if best is None or best[1] <= y[mask & tr].mean() + 0.005: break
        chosen.append(best[0]); mask &= C[best[0]]
        a = stats(y[mask & tr], df.day.values[mask & tr]); b = stats(y[mask & te], df.day.values[mask & te])
        print(f"  + {best[0]:<26} train n={a['n']:>5} {a['avg']:+.3f}R t={a['t']:+.1f} | test n={b['n']:>5} {b['avg']:+.3f}R t={b['t']:+.1f} PF={b['pf']:.2f}")
for MIN in [3000, 800]:
    run(1, 2, MIN); run(2, 1, int(MIN * 0.7))
