from common import *
CAT = ['setup', 'tf', 'dir', 'grade', 'btc1d', 'btc4h', 'btcReg4h', 'btcReg1d', 'b_reg1d', 'b_reg4h', 'b_bias1d', 'b_bias4h', 'b_bias1w', 'fam']
NUM = ['score', 'pot', 'stopPct', 'avgTP', 'tp1R', 'room', 'beWin', 'conf', 'ntp', 'nwarn', 'nmiss', 'rsPct', 'rank',
       'entryDistPct', 'pump7', 'b_chg7', 'b_chg30', 'b_chg90', 'b_vol20', 'hour', 'wday', 'tfo']
FLAGS = [c for c in df.columns if c.startswith('w_') or c.startswith('m_')]
def build_X(d):
    X = pd.DataFrame(index=d.index)
    for c in CAT:
        X[c] = d[c].astype('category').cat.codes
    for c in NUM:
        X[c] = pd.to_numeric(d[c], errors='coerce')
    for c in FLAGS:
        X[c] = d[c].astype(float)
    X['btcAtRes'] = d['btcAtRes'].astype(float)
    X['alerted'] = d['alerted'].astype(float)
    return X
X = build_X(df)
CAT_MASK = [c in CAT for c in X.columns]
