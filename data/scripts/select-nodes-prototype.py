import json,sys,math,collections
d=json.load(open(sys.argv[1]));E=d['elements']
def cat(t):
    if t.get('railway')=='station': 
        s=t.get('station',''); n=t.get('network','')
        return 'metro' if s=='subway' or 'Métro' in n else 'rer/train' if s in('train','light_rail') or 'RER' in n or 'Transilien' in n else 'station_other'
    if t.get('tourism')=='museum': return 'museum'
    if t.get('tourism')=='attraction': return 'attraction'
    if t.get('tourism')=='artwork': return 'artwork'
    if t.get('tourism')=='viewpoint': return 'viewpoint'
    if t.get('historic'): return 'historic:'+('memorial/plaque' if t['historic'] in('memorial','plaque') else 'other')
    if t.get('leisure')=='park': return 'park'
    if t.get('amenity')=='library': return 'library'
    if t.get('amenity')=='fountain': return 'fountain'
    if t.get('amenity')=='drinking_water': return 'drinking_water'
    if t.get('amenity')=='cafe': return 'cafe_wikidata'
    return 'other'
pts=[]
c=collections.Counter(); named=collections.Counter()
for e in E:
    t=e.get('tags',{}); k=cat(t); c[k]+=1
    if 'name' in t: named[k]+=1
    ll=(e['lat'],e['lon']) if 'lat' in e else (e['center']['lat'],e['center']['lon']) if 'center' in e else None
    if ll: pts.append((ll,k,'name' in t,'wikidata' in t))
print('total',len(E))
for k,v in sorted(c.items(),key=lambda x:-x[1]): print(f'{k:24}{v:6} named {named[k]}')
# greedy min-distance selection, priority: wikidata > named > rest
pri={'metro':0,'rer/train':0,'attraction':1,'museum':1,'park':2,'library':2,'viewpoint':2,'fountain':3,'cafe_wikidata':3,'historic:other':3,'artwork':4,'historic:memorial/plaque':5,'drinking_water':6,'station_other':6,'other':7}
pts.sort(key=lambda p:(pri[p[1]],not p[3],not p[2]))
for R in (100,150,200,250):
    grid={};sel=0
    for (la,lo),k,n,w in pts:
        if k=='drinking_water' or not n and k!='fountain': continue
        x=lo*111320*math.cos(math.radians(48.86));y=la*110540
        gx,gy=int(x//R),int(y//R);ok=True
        for dx in(-1,0,1):
            for dy in(-1,0,1):
                for (px,py) in grid.get((gx+dx,gy+dy),[]):
                    if (px-x)**2+(py-y)**2<R*R: ok=False;break
        if ok: grid.setdefault((gx,gy),[]).append((x,y));sel+=1
    print(f'min-dist {R}m -> {sel} nodes (~{sel/105.4:.0f}/km2)')
