import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
N=16
def glyph_mask(fontfile, ch, px=120, rng=None):
    ft=ImageFont.truetype(fontfile,px)
    bb=ft.getbbox(ch,anchor='ls')
    if bb is None or bb[2]-bb[0]<2: return None
    W=bb[2]-bb[0]+60; H=bb[3]-bb[1]+60
    im=Image.new('L',(W,H),0); ImageDraw.Draw(im).text((30-bb[0],30-bb[1]),ch,font=ft,fill=255,anchor='ls')
    a=np.asarray(im,dtype=np.float32)/255.0
    base=30-bb[1]   # baseline row
    return a, base
def distort(a, base, rng, strength=1.0):
    h,w=a.shape
    # smooth random warp (wobbly pen)
    amp=rng.uniform(2.5,7.5)*strength*h/140
    sig=rng.uniform(10,22)*h/140
    dx=cv2.GaussianBlur(rng.normal(0,1,(h,w)).astype(np.float32),(0,0),sig); dy=cv2.GaussianBlur(rng.normal(0,1,(h,w)).astype(np.float32),(0,0),sig)
    dx=dx/ (dx.std()+1e-6)*amp; dy=dy/(dy.std()+1e-6)*amp
    ang=np.deg2rad(rng.normal(0,8)); sh=rng.normal(0.08,0.18); sx=rng.uniform(0.8,1.25); sy=rng.uniform(0.85,1.15)
    cx,cy=w/2,base
    M=np.array([[sx*np.cos(ang), -np.sin(ang)+sh, 0],[np.sin(ang), sy*np.cos(ang),0]],np.float32)
    M[:,2]=np.array([cx,cy])-M[:,:2]@np.array([cx,cy])
    xx,yy=np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32))
    b=cv2.warpAffine(a,M,(w,h),flags=cv2.INTER_LINEAR)
    b=cv2.remap(b,xx+dx,yy+dy,cv2.INTER_LINEAR)
    # pen width: blur then threshold at a random level
    b=cv2.GaussianBlur(b,(0,0),rng.uniform(1.0,3.2)*h/140)
    th=rng.uniform(0.18,0.62)
    b=np.clip((b-th)*rng.uniform(4,9)+0.5,0,1)
    # thicker marker occasionally
    if rng.random()<0.25:
        k=int(rng.integers(2,6)); b=cv2.dilate(b,np.ones((k,k),np.uint8))
    # ragged edge
    near=cv2.GaussianBlur(b,(0,0),3)>0.08
    b=np.clip(b+rng.normal(0,0.05,b.shape)*near,0,1)
    nb=base*sy+ (cy-cy*sy)  # baseline moves with scale about (cx,cy=base): stays put
    return b, base
def features(b, base, rng, hdig):
    """feature vector as the reader computes it, for a distorted mask whose reference digit height is hdig"""
    m=b>0.5
    ys,xs=np.nonzero(m)
    if len(ys)<12: return None
    x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
    bw,bh=x1-x0,y1-y0
    if bw<3 or bh<3: return None
    grid=cv2.resize(m[y0:y1,x0:x1].astype(np.float32),(N,N),interpolation=cv2.INTER_AREA)
    H=hdig*np.exp(rng.normal(0,0.1))*rng.choice([1,1,1,0.75,1.15])
    relBot=(y1-(base+rng.normal(0,0.1)*H))/H
    return np.concatenate([grid.ravel(),[np.log(bw/bh),bh/H,relBot]]).astype(np.float32)
