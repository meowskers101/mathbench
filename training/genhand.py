import sys, json, numpy as np
sys.argv=[sys.argv[0]]+sys.argv[1:]
import gen
from gen import CLASSES, fonts, HOLD
from hand import *
from multiprocessing import Pool
from fontTools.ttLib import TTFont
def work(args):
    seed,per,holdout=args
    rng=np.random.default_rng(seed); X=[];Y=[]
    for f in fonts:
        if (f['family'] in HOLD)!=holdout: continue
        try: zh=glyph_mask(f['file'],'0',120)
        except Exception: continue
        if zh is None: continue
        a0,b0=zh; ys=np.nonzero(a0>0.5)[0]; hdig=(ys.max()-ys.min()+1)
        for ci,ch in enumerate(CLASSES):
            if ord(ch) not in f['cm']: continue
            try: g=glyph_mask(f['file'],ch,120)
            except Exception: continue
            if g is None: continue
            for _ in range(per):
                b,base=distort(g[0],g[1],rng)
                v=features(b,base,rng,hdig)
                if v is not None: X.append(v);Y.append(ci)
    return np.array(X),np.array(Y)
def digits(seed,n,test):
    from sklearn.datasets import load_digits
    D=load_digits(); rng=np.random.default_rng(seed)
    idx=np.arange(len(D.images)); sel=idx[idx%5==0] if test else idx[idx%5!=0]
    X=[];Y=[]
    for i in sel:
        im=cv2.resize(D.images[i].astype(np.float32)/16.0,(96,96),interpolation=cv2.INTER_CUBIC)
        im=np.pad(im,24); base=24+96
        for _ in range(n):
            b,_b=distort(np.clip(im,0,1),base,rng,0.6)
            v=features(b,base,rng,96)
            if v is not None: X.append(v);Y.append(CLASSES.index(str(D.target[i])))
    return np.array(X),np.array(Y)
if __name__=='__main__':
    per=int(sys.argv[1])
    with Pool(2) as p:
        tr=p.map(work,[(31,per,False),(32,per,False)])
    X=np.concatenate([t[0] for t in tr]);Y=np.concatenate([t[1] for t in tr])
    va=work((77,max(2,per//3),True))
    dX,dY=digits(5,45,False); dv=digits(6,6,True)
    np.savez_compressed('hand.npz',X=X,Y=Y,Xv=va[0],Yv=va[1],dX=dX,dY=dY,dXv=dv[0],dYv=dv[1])
    print(X.shape,va[0].shape,dX.shape,dv[0].shape)
