import numpy as np, pickle, json, base64, sys
from gen import CLASSES
CLASSES=CLASSES+['#']
name=sys.argv[1]; out=sys.argv[2]
m=pickle.load(open(name,'rb'))
d=np.load('data.npz'); P=np.load('pairs.npz'); P2=np.load('pairs2.npz'); H=np.load('hand.npz'); Xv=np.concatenate([d['Xv'],P['Xv'][:6000],P2['Xv'][:4000]]); Yv=np.concatenate([d['Yv'],np.full(min(6000,len(P['Xv'])),len(CLASSES)-1),np.full(min(4000,len(P2['Xv'])),len(CLASSES)-1)])
Xv=np.concatenate([Xv,H['Xv'],H['dXv']]); Yv=np.concatenate([Yv,H['Yv'],H['dYv']])
MERGE={'C':'c','O':'o','S':'s','V':'v','W':'w','X':'x','Z':'z','U':'u'}
Yv=np.array([CLASSES.index(MERGE.get(c,c)) for c in CLASSES])[Yv]
CL=list(pickle.load(open(name,'rb')).classes_); Yv=np.array([CL.index(y) for y in Yv])
def fwd(Ws,bs,X):
    a=X
    for i,(W,b) in enumerate(zip(Ws,bs)):
        a=a@W+b
        if i<len(Ws)-1: a=np.maximum(a,0)
    return a
Ws=m.coefs_;bs=m.intercepts_
# quantize
Q=[];Ws2=[]
for W in Ws:
    s=np.abs(W).max(axis=0)/127.0+1e-12
    q=np.clip(np.round(W/s),-127,127).astype(np.int8)
    Q.append((q,s)); Ws2.append(q.astype(np.float32)*s)
lg=fwd(Ws,bs,Xv); lq=fwd(Ws2,bs,Xv)
print('val float',(lg.argmax(1)==Yv).mean(),'quantized',(lq.argmax(1)==Yv).mean())
# temperature on held-out fonts
def nll(T):
    z=lq/T; z=z-z.max(1,keepdims=True); lp=z-np.log(np.exp(z).sum(1,keepdims=True)); return -lp[np.arange(len(Yv)),Yv].mean()
Ts=np.linspace(0.6,3,49); T=float(Ts[np.argmin([nll(t) for t in Ts])]); print('T',T,'nll',nll(T))
net={'classes':''.join(CLASSES[i] for i in CL),'T':round(T,3),'layers':[]}
for (q,s),b in zip(Q,bs):
    net['layers'].append({'in':q.shape[0],'out':q.shape[1],'w':base64.b64encode(q.tobytes()).decode(),'s':[float('%.5g'%v) for v in s],'b':[float('%.5g'%v) for v in b]})
js='/* trained glyph classifier (see train/): int8 weights, generated, do not edit */\nconst MB_NET = '+json.dumps(net,separators=(',',':'))+';\n'
open(out,'w').write(js); print(len(js)//1024,'KB')
