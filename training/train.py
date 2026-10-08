import numpy as np, json, sys, time, base64
from sklearn.neural_network import MLPClassifier
from gen import CLASSES
sys.path.insert(0,'.')
d=np.load('data.npz'); X,Y,Xv,Yv=d['X'],d['Y'],d['Xv'],d['Yv']
print(X.shape,Xv.shape,flush=True)
MERGE={'C':'c','O':'o','S':'s','V':'v','W':'w','X':'x','Z':'z','U':'u'}
remap=np.array([CLASSES.index(MERGE.get(c,c)) for c in CLASSES]+[len(CLASSES)])
P=np.load('pairs.npz'); rng=np.random.default_rng(5)
HASH=len(CLASSES)
pi=rng.permutation(len(P['X']))[:110000]
X=np.concatenate([X,P['X'][pi]]); Y=np.concatenate([Y,np.full(len(pi),HASH)])
Xv=np.concatenate([Xv,P['Xv'][:6000]]); Yv=np.concatenate([Yv,np.full(min(6000,len(P['Xv'])),HASH)])
P2=np.load('pairs2.npz'); pj=rng.permutation(len(P2['X']))[:90000]
X=np.concatenate([X,P2['X'][pj]]); Y=np.concatenate([Y,np.full(len(pj),HASH)])
Xv=np.concatenate([Xv,P2['Xv'][:4000]]); Yv=np.concatenate([Yv,np.full(min(4000,len(P2['Xv'])),HASH)])
Y=remap[Y]; Yv=remap[Yv]
def aug(X):
    X=X.copy(); n=len(X)
    f=np.exp(rng.normal(0,0.1,n)); odd=rng.random(n)<0.12; f[odd]=rng.choice([0.72,0.8,1.2,1.3],odd.sum())
    X[:,257]/=f; X[:,258]/=f
    return X
H=(int(sys.argv[1]),int(sys.argv[2])); EP=int(sys.argv[3]); final=len(sys.argv)>4 and sys.argv[4]=='final'
if final: X=np.concatenate([X,Xv]); Y=np.concatenate([Y,Yv])
m=MLPClassifier(H,solver='adam',batch_size=512,learning_rate_init=1.5e-3,alpha=1e-5,max_iter=1,warm_start=True,random_state=1)
t=time.time()
for ep in range(EP):
    if ep==int(EP*0.6): m.learning_rate_init=5e-4
    if ep==int(EP*0.85): m.learning_rate_init=1.5e-4
    m.fit(aug(X),Y)
    if ep%3==2 or ep==EP-1: print(ep,'val',round(m.score(Xv,Yv),4),'t',int(time.time()-t),flush=True)
import pickle; pickle.dump(m,open('model%s.pkl'%('_final' if final else ''),'wb'))
