import json, sys, numpy as np, cv2, random
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from multiprocessing import Pool
N=16
BASIC='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=<>()[]|!%/:{}'
EXTRA='∫∑π≤≥≠±√∞→×÷θ'
CLASSES=list(BASIC+EXTRA)
fonts=[f for f in json.load(open('fonts.json')) if not f['family'].startswith(('Unifont','TeX Gyre Chorus','IPA'))]
HOLD={'DejaVu Serif','TeX Gyre Pagella','Poppins','Carlito','FreeSans','Latin Modern Sans','Liberation Mono'}
for f in fonts:
    try: f['cm']=set(TTFont(f['file'],fontNumber=0,lazy=True).getBestCmap().keys())
    except: f['cm']=set()
S=4
def otsu(g):
    h=np.bincount(g.ravel(),minlength=256).astype(float); tot=g.size; sm=(np.arange(256)*h).sum(); sb=0;wb=0;best=0;thr=128
    for t in range(256):
        wb+=h[t]
        if not wb: continue
        wf=tot-wb
        if not wf: break
        sb+=t*h[t]; mb=sb/wb; mf=(sm-sb)/wf; v=wb*wf*(mb-mf)**2
        if v>best: best=v;thr=t
    return thr
def sample(f,ch,rng,fontcache):
    P=float(np.exp(rng.uniform(np.log(9),np.log(56))))
    key=(f['file'],int(round(P*S)))
    if key not in fontcache:
        if len(fontcache)>400: fontcache.clear()
        fontcache[key]=ImageFont.truetype(f['file'],int(round(P*S)))
    ft=fontcache[key]
    if len(ch)==3:
        # base glyph followed by a smaller raised/lowered glyph that touches it
        sc=rng.uniform(0.55,0.8); P2=int(round(P*S*sc)); f2=ImageFont.truetype(f['file'],max(4,P2))
        adv=ft.getlength(ch[0])*rng.uniform(0.7,1.0)
        b1=ft.getbbox(ch[0],anchor='ls'); b2=f2.getbbox(ch[1],anchor='ls')
        if b1 is None or b2 is None: return None
        dy=-P*S*rng.uniform(0.3,0.5) if ch[2]=='^' else P*S*rng.uniform(0.1,0.25)
        bb=(b1[0],min(b1[1],b2[1]+dy),max(b1[2],adv+b2[2]),max(b1[3],b2[3]+dy))
    elif len(ch)==2:
        adv=ft.getlength(ch[0])*rng.uniform(0.5,0.98)
        b1=ft.getbbox(ch[0],anchor='ls'); b2=ft.getbbox(ch[1],anchor='ls')
        if b1 is None or b2 is None: return None
        bb=(b1[0],min(b1[1],b2[1]),max(b1[2],adv+b2[2]),max(b1[3],b2[3]))
    else:
        bb=ft.getbbox(ch,anchor='ls')
    zb=ft.getbbox('0',anchor='ls')
    if bb is None or bb[2]-bb[0]<=0: return None
    Hd=(zb[3]-zb[1])/S
    W=int((bb[2]-bb[0])+8*S+abs(bb[0])); Hh=int((bb[3]-bb[1])+12*S)
    # canvas with margins, baseline placed so everything fits
    ox=4*S-bb[0]+rng.integers(0,S); base=int(6*S-bb[1])+int(rng.integers(0,S))
    # shift lowers-case descender etc handled by bb
    img=Image.new('L',(W+ S,Hh+ S),0); d=ImageDraw.Draw(img); d.text((ox,base),ch[0],font=ft,fill=255,anchor='ls')
    if len(ch)==3: d.text((ox+adv,base+dy),ch[1],font=f2,fill=255,anchor='ls')
    elif len(ch)==2: d.text((ox+adv,base),ch[1],font=ft,fill=255,anchor='ls')
    a=np.asarray(img,dtype=np.float32)
    # slant/rotation
    sh=rng.normal(0,0.04)+(rng.uniform(0.08,0.25) if rng.random()<0.12 else 0)
    rot=rng.normal(0,1.2)*np.pi/180
    M=np.array([[1,sh,0],[0,1,0]],dtype=np.float32)
    c,s=np.cos(rot),np.sin(rot)
    R=np.array([[c,-s,0],[s,c,0]],dtype=np.float32)
    h,w=a.shape
    a=cv2.warpAffine(a,M,(w+int(abs(sh)*h)+2,h),flags=cv2.INTER_LINEAR)
    a=cv2.warpAffine(a,R,(a.shape[1],a.shape[0]),flags=cv2.INTER_LINEAR)
    a=cv2.resize(a,(max(1,a.shape[1]//S),max(1,a.shape[0]//S)),interpolation=cv2.INTER_AREA)/255.0
    gam=float(np.exp(rng.normal(0,0.22)))
    a=np.clip(a,0,1)**gam
    if rng.random()<0.5:
        sg=rng.uniform(0.2,0.9); a=cv2.GaussianBlur(a,(0,0),sg)
    # runtime upscales so typical glyphs are ~30px
    k=min(4.0,max(1.0,30.0/max(3.0,Hd)))
    if k>1.15:
        a=cv2.resize(a,(int(a.shape[1]*k),int(a.shape[0]*k)),interpolation=cv2.INTER_CUBIC if rng.random()<0.6 else cv2.INTER_LINEAR)
        Hd*=k; base_px=base/S*k
    else: k=1.0; base_px=base/S
    g=np.clip(255-a*255+rng.normal(0,rng.choice([0,0,2,5]),a.shape),0,255).astype(np.uint8)
    t0=otsu(g); thr=min(235,round(t0+0.2*(255-t0)))
    b=(g<=thr)
    ys,xs=np.nonzero(b)
    if len(ys)<4: return None
    x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
    bw,bh=x1-x0,y1-y0
    if bw<2 or bh<2: return None
    grid=cv2.resize(b[y0:y1,x0:x1].astype(np.float32),(N,N),interpolation=cv2.INTER_AREA)
    # layout reference: H is usually the digit/cap height, sometimes x-height or ascender-ish
    H=Hd*rng.choice([1.0,1.0,1.0,1.0,0.72,1.1,1.2])*np.exp(rng.normal(0,0.05))
    base_j=base_px+rng.normal(0,0.04)*H
    # base row in the cropped image: rows are in the padded canvas; compute relative to bottom of glyph
    relBot=(y1-base_j)/H
    return np.concatenate([grid.ravel(),[np.log(bw/bh),bh/H,relBot]]).astype(np.float32)
def work(args):
    seed,per,holdout=args
    rng=np.random.default_rng(seed); fc={}
    X=[];Y=[];F=[]
    for fi,f in enumerate(fonts):
        if (f['family'] in HOLD)!=holdout: continue
        for ci,ch in enumerate(CLASSES):
            if ord(ch) not in f['cm']: continue
            for _ in range(per):
                try: v=sample(f,ch,rng,fc)
                except Exception as e: v=None
                if v is not None: X.append(v);Y.append(ci);F.append(fi)
    return np.array(X),np.array(Y),np.array(F)
if __name__=='__main__':
    per=int(sys.argv[1]); out=sys.argv[2]
    with Pool(2) as p:
        tr=p.map(work,[(1,per,False),(2,per,False)])
        va=work((99,max(2,per//3),True))
    X=np.concatenate([t[0] for t in tr]);Y=np.concatenate([t[1] for t in tr])
    np.savez_compressed(out,X=X,Y=Y,Xv=va[0],Yv=va[1])
    print(X.shape,va[0].shape,len(CLASSES))
