# Gradient-boosted selector: learn which signals have positive expected R from the features known at signal time.
# Honest evaluation: (a) train first half → test second half and reverse; (b) monthly expanding walk-forward
# where each month's model only sees trades that had CLOSED before that month began; (c) a null run with the
# labels shuffled within each day, to show what the search produces from noise.
import sys, warnings
import feat
from feat import *
from sklearn.ensemble import HistGradientBoostingRegressor
warnings.filterwarnings('ignore')
EXIT = sys.argv[1] if len(sys.argv) > 1 else 'base'
NULL = '--null' in sys.argv
if EXIT == 'base':
    y = df['Rv'].values
else:
    e, m, x = EXIT.split(','); y = vR(vidx(e, float(m) if '.' in m else int(m), x))
ok = ~np.isnan(y)
tEnd = df['tExit'].fillna(df['upd']).fillna(df['t']).values
rng = np.random.default_rng(7)
def model():
    return HistGradientBoostingRegressor(max_depth=3, min_samples_leaf=400, learning_rate=0.04, max_iter=250,
                                         l2_regularization=2.0, categorical_features=feat.CAT_MASK, random_state=1)
def shuffle_within_day(idx):
    yy = y[idx].copy(); days = df['day'].values[idx]
    for dday in np.unique(days):
        k = np.where(days == dday)[0]; yy[k] = yy[rng.permutation(k)] if len(k) > 1 else yy[k]
    return yy
def fit_predict(tr, te):
    yy = shuffle_within_day(tr) if NULL else y[tr]
    mdl = model().fit(feat.X.values[tr], np.clip(yy, -1.5, 5))
    return mdl.predict(feat.X.values[tr]), mdl.predict(feat.X.values[te])
QS = [0.5, 0.7, 0.8, 0.9]
def report(name, te, ptr, pte):
    out = [name]
    a = stats(y[te], df['day'].values[te]); out.append(f"all n={a['n']} {a['avg']:+.3f}R")
    for q in QS:
        th = np.quantile(ptr, q); sel = te[pte > th]
        b = stats(y[sel], df['day'].values[sel])
        out.append(f"top{int((1-q)*100)}% n={b['n']} {b['avg']:+.3f}R t={b['t']:+.1f}")
    print(' | '.join(out))
H = df['H'].values
idx = np.arange(len(df))
# (a) half splits
for a_, b_ in [(1, 2), (2, 1)]:
    tr = idx[ok & (H == a_)]; te = idx[ok & (H == b_)]
    if a_ == 1: tr = tr[tEnd[tr] < df['t'].values[te].min()]
    ptr, pte = fit_predict(tr, te)
    report(f'train H{a_} → test H{b_}', te, ptr, pte)
    th = np.quantile(ptr, 0.8); sel = tr[ptr > th]; b = stats(y[sel], df['day'].values[sel])
    print(f'   (in-sample top20% on H{a_}: n={b["n"]} {b["avg"]:+.3f}R)')
# (b) monthly expanding walk-forward
months = sorted(df['month'].unique())
preds = np.full(len(df), np.nan); thr = {}
for i, mth in enumerate(months):
    if i < 4: continue
    start = df.loc[df.month == mth, 't'].min()
    tr = idx[ok & (tEnd < start)]
    te = idx[ok & (df['month'].values == mth)]
    if len(te) == 0: continue
    ptr, pte = fit_predict(tr, te)
    preds[te] = pte
    for q in QS: thr[(mth, q)] = np.quantile(ptr, q)
wf = idx[~np.isnan(preds)]
print(f'walk-forward (monthly retrain, {months[4]} → {months[-1]}):')
a = stats(y[wf], df['day'].values[wf]); print(f"   all n={a['n']} {a['avg']:+.3f}R")
for q in QS:
    sel = np.array([k for k in wf if preds[k] > thr[(df['month'].values[k], q)]])
    b = stats(y[sel], df['day'].values[sel])
    by = pd.Series(y[sel]).groupby(df['month'].values[sel]).mean().round(2).to_dict()
    print(f"   top{int((1-q)*100)}%: n={b['n']} {b['avg']:+.3f}R t={b['t']:+.1f} PF={b['pf']:.2f} | by month {by}")
np.save(f'/home/claude/k/an/wfpred_{EXIT.replace(",", "_")}{"_null" if NULL else ""}.npy', preds)
