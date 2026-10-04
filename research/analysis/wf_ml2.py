# same as wf_ml.py but with the candle-based features added
import sys, warnings
warnings.filterwarnings('ignore')
import feat
from feat import *
sf = pd.read_pickle('/home/claude/k/an/sigfeat.pkl')
sg = np.where(df.dir == 'long', 1, -1)
for k in ['c_tr', 'b_tr', 'c_r7', 'c_r30', 'c_r90', 'c_d200', 'c_d50', 'c_d20', 'c_f3', 'c_f14']:
    feat.X[k + '_al'] = sf[k].values * sg
for k in ['c_vol30', 'c_qvx', 'c_age']:
    feat.X[k] = sf[k].values
feat.CAT_MASK = [c in CAT for c in feat.X.columns]
import wf_ml
