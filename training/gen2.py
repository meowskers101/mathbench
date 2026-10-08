import sys,numpy as np
sys.argv=[sys.argv[0]]+sys.argv[1:]
import gen
from gen import *
PAIRS='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=()'
def work2(args):
    seed,per,holdout=args
    rng=np.random.default_rng(seed); fc={}; X=[]
    for f in gen.fonts:
        if (f['family'] in HOLD)!=holdout: continue
        okc=[c for c in PAIRS if ord(c) in f['cm']]
        for _ in range(per*len(CLASSES)//3):
            ch=str(rng.choice(okc))+str(rng.choice(okc))
            try: v=sample(f,ch,rng,fc)
            except Exception: v=None
            if v is not None: X.append(v)
    return np.array(X)
if __name__=='__main__':
    per=int(sys.argv[1])
    with Pool(2) as p: tr=p.map(work2,[(11,per,False),(12,per,False)])
    va=work2((98,max(2,per//3),True))
    X=np.concatenate(tr)
    np.savez_compressed('pairs.npz',X=X,Xv=va); print(X.shape,va.shape)
