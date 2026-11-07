# 코덱스 원본 PNG(저장소 밖)를 앱용 WebP로 줄인다. 실제로 화면에 쓰는 파일만 만든다.
# 사용: python scripts/build-art.py <원본 폴더>
import os,sys
from PIL import Image
src=sys.argv[1];out=os.path.join(os.path.dirname(__file__),'..','public','art')
faces='normal soon stale lost done notoday before sorry happy cheer thanks wave fix night'.split()
stamps='first-ride new-route new-stop first-bus sunset last-bus east west south north four-way'.split()
icons='tab-home tab-find tab-board tab-map tab-community tab-jeju stop notice official report notcome crowded wait'.split()
places='stonewall oreum sea orchard canola city forest night'.split()
scenes='home-empty search-start no-result no-favorites no-posts no-reports this-side across-road today-off service-ended before-first signal-lost quota-out plan-b home-line report-sheet repair-news ai-avatar login'.split()
jobs=[(f'bus/bus-{g}',200,70) for g in 'express trunk branch tour'.split()]
jobs+=[(f'bus/face-{f}',220,74) for f in faces]+[(f'stamp/{s}',200,76) for s in stamps]+[(f'icon/{i}',96,80) for i in icons]
jobs+=[(f'board/{p}',900,60) for p in places]+[('board/stop-token',96,78),('board/my-stop-token',96,78)]
jobs+=[(f'scene/{s}',420,72) for s in scenes]+[(f'guide/{g}',360,72) for g in 'raise-hand check-side official-vs-report'.split()]
jobs+=[(f'reward/{r}-bg',640,62) for r in 'first-ride region weekly'.split()]
jobs+=[(f'share/card-{c}',720,70) for c in 'sea oreum sunset night'.split()]+[(f'share/type-{c}',380,74) for c in 'east explorer night west commuter'.split()]
jobs+=[('map/sea-paper',700,60),('brand/mascot-splash',640,66)]
def save(im,name,q):
    p=os.path.join(out,name+'.webp');os.makedirs(os.path.dirname(p),exist_ok=True);im.save(p,'WEBP',quality=q,method=6)
def fit(im,w):
    return im if im.width<=w else im.resize((w,round(im.height*w/im.width)),Image.LANCZOS)
for name,w,q in jobs:
    im=Image.open(os.path.join(src,name+'.png'))
    if im.mode=='RGBA':
        box=im.getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()
        im=im.crop(box)
        if im.height>im.width:w=round(w*im.width/im.height)
    save(fit(im,w),name,q)
# 지도는 조각이 겹쳐야 하므로 같은 틀로 자른다.
base=Image.open(os.path.join(src,'map/jeju-base-color.png'));box=base.getchannel('A').getbbox()
for n in 'jeju-base-gray jeju-east jeju-west jeju-south jeju-north'.split():
    save(fit(Image.open(os.path.join(src,f'map/{n}.png')).crop(box),900),f'map/{n}',76)
icon=Image.open(os.path.join(src,'brand/app-icon.png')).convert('RGB');mask=Image.open(os.path.join(src,'brand/app-icon-maskable.png')).convert('RGB')
os.makedirs(os.path.join(out,'brand'),exist_ok=True)
for s in (180,192,512):icon.resize((s,s),Image.LANCZOS).save(os.path.join(out,'brand',f'icon-{s}.png'),optimize=True)
mask.resize((512,512),Image.LANCZOS).save(os.path.join(out,'brand','icon-maskable-512.png'),optimize=True)
og=Image.open(os.path.join(src,'brand/og-cover.png')).convert('RGB').resize((1200,800),Image.LANCZOS).crop((0,170,1200,800));og.save(os.path.join(out,'brand','og-cover.jpg'),quality=82)
