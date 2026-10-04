# Load the long history (research/hist) into wide panels: one column per symbol, one row per UTC day / 4h bar.
import pandas as pd, numpy as np, os, re
H = '/home/claude/krillin-scanner/research/hist'
C = '/home/claude/k/an/cache'
os.makedirs(C, exist_ok=True)
def base_of(sym):
    b = sym[:-4] if sym.endswith('USDT') else sym
    m = re.match(r'^(1000000|1000|1M)(.+)$', b)
    return m.group(2) if m else b
def load(tf='d1'):
    f = f'{C}/{tf}.pkl'
    if os.path.exists(f):
        return pd.read_pickle(f)
    d = pd.read_csv(f'{H}/{tf}.csv.gz')
    d['dt'] = pd.to_datetime(d['t'], unit='ms', utc=True)
    P = {k: d.pivot_table(index='dt', columns='sym', values=k, aggfunc='last') for k in ['o', 'h', 'l', 'c', 'qv', 'tbq']}
    pd.to_pickle(P, f)
    return P
def load_funding():
    f = f'{C}/funding.pkl'
    if os.path.exists(f):
        return pd.read_pickle(f)
    d = pd.read_csv(f'{H}/funding.csv.gz')
    d['dt'] = pd.to_datetime(d['t'], unit='ms', utc=True)
    # sum of funding paid per UTC day (rate per interval; longs pay positive rates)
    d['day'] = d['dt'].dt.floor('D')
    F = d.groupby(['day', 'sym'])['rate'].sum().unstack()
    pd.to_pickle(F, f)
    return F
def universe(P, n=100):
    """bool panel: symbol is in the top-n by the PREVIOUS day's quote volume (one symbol per base asset)."""
    qv = P['qv'].shift(1)
    cols = list(qv.columns); bases = np.array([base_of(s) for s in cols])
    U = np.zeros(qv.shape, bool)
    arr = qv.values
    for i in range(len(qv)):
        row = arr[i]; ok = np.where(np.isfinite(row) & (row > 0))[0]
        if not len(ok): continue
        order = ok[np.argsort(-row[ok])]; seen = set(); k = 0
        for j in order:
            if bases[j] in seen: continue
            seen.add(bases[j]); U[i, j] = True; k += 1
            if k >= n: break
    return pd.DataFrame(U, index=qv.index, columns=cols)
if __name__ == '__main__':
    P = load('d1'); print({k: v.shape for k, v in P.items()}); print(P['c'].index.min(), P['c'].index.max())
    F = load_funding(); print(F.shape, F.index.min(), F.index.max())
    U = universe(P, 100); pd.to_pickle(U, f'{C}/U100.pkl'); print('universe sizes', U.sum(1).describe())
    P4 = load('h4'); print({k: v.shape for k, v in P4.items()})
