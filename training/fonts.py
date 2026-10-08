import subprocess, collections, json
from fontTools.ttLib import TTFont
out=subprocess.run(['fc-list','--format','%{file}|%{family[0]}|%{style[0]}\n'],capture_output=True,text=True).stdout.splitlines()
need=set('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=()')
res=[]; seen=set()
for l in out:
    f,fam,sty=l.split('|')
    if f in seen or not f.lower().endswith(('.ttf','.otf')): continue
    seen.add(f)
    try:
        t=TTFont(f,fontNumber=0,lazy=True); cm=t.getBestCmap()
    except Exception as e: continue
    if not need<=set(chr(c) for c in cm): continue
    extra=''.join(c for c in '∫∑π≤≥≠±√∞→×÷θ' if ord(c) in cm)
    res.append({'file':f,'family':fam,'style':sty,'extra':extra})
print(len(res)); fam=collections.Counter(r['family'] for r in res); print(len(fam)); print(sorted(fam.items(),key=lambda x:-x[1])[:60])
json.dump(res,open('fonts.json','w'))
