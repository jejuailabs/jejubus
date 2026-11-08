// 관광노선 카드 사진: 비짓제주 관광정보 OPEN API(제주관광공사)에서 관광지 대표 사진 주소와 원문 링크를 한 번 받아 둔다.
// 키는 .env.local의 VISITJEJU_API_KEY에서만 읽고 결과 파일에 남기지 않는다.
// 사용: node scripts/build-tour-photos.mjs  → public/data/tour-photos.json
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {TOUR,fileNetwork} from '../lib/network.mjs';
import {distanceMeters} from '../lib/catalog.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const env=Object.fromEntries((await readFile(join(root,'.env.local'),'utf8').catch(()=>'')).split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const key=process.env.VISITJEJU_API_KEY||env.VISITJEJU_API_KEY;
if(!key){console.error('VISITJEJU_API_KEY가 없어요');process.exit(1);}

// 비짓제주 콘텐츠 제목으로 찾는 이름(관광지 id → 제목 규칙)
const TITLE={hamdeok:/^함덕해수욕장/,hyeopjae:/^협재해수욕장/,geumneung:/^금능해수욕장/,gwakji:/^곽지해수욕장/,iho:/^이호테우해수욕장/,gimnyeong:/^김녕해수욕장/,woljeong:/^월정리해수욕장/,jungmunbeach:/^중문색달해수욕장/,hwasun:/^화순금모래해수욕장/,gwangchigi:/^광치기해변/,soesokkak:/^쇠소깍/,udo:/^우도\(해양도립공원\)/,
 seongsan:/^성산일출봉/,saebyeol:/^새별오름/,yongnuni:/^용눈이오름/,darangswi:/^다랑쉬오름/,geomun:/^거문오름/,seongpanak:/^한라산국립공원$/,yeongsil:/^한라산국립공원영실탐방로/,bijarim:/^비자림$|^비자림\s/,saryeoni:/^사려니숲길/,
 dongmun:/^동문재래시장|^동문시장/,olle:/^서귀포매일올레시장|^매일올레시장/,cheonjiyeon:/^천지연폭포/,oedolgae:/^외돌개/,jusangjeolli:/주상절리/,sanbang:/^산방산/,osulloc:/오설록\s*티\s*뮤지엄|^오설록/,hallimpark:/^한림공원/,seopjikoji:/^섭지코지/,jungmun:/^중문관광단지/};

async function page(category,n){
 const url=`https://api.visitjeju.net/vsjApi/contents/searchList?apiKey=${encodeURIComponent(key)}&locale=kr&category=${category}&page=${n}`;
 const r=await fetch(url);if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json();if(j.result!=='200')throw Error(j.resultMessage);return j;
}
const items=[];
for(const category of ['c1','c2']){const first=await page(category,1);items.push(...first.items);for(let n=2;n<=first.pageCount;n++)items.push(...(await page(category,n)).items);}
const spots=await fileNetwork(join(root,'public/data/network.json')).spots(TOUR);
const out={},missing=[];
for(const s of spots){
 const rule=TITLE[s.id],hits=items.filter(x=>rule?.test((x.title||'').trim())&&x.repPhoto?.photoid?.imgpath);
 // 같은 이름이 여럿이면 관광지 정류장에서 가까운 것
 // 야영장·숙소·부대시설 콘텐츠는 빼고, 제목이 짧은(관광지 자체) 것 → 가까운 것 순
 const best=hits.map(x=>({x,d:Number.isFinite(x.latitude)?distanceMeters(s.stop,{lat:x.latitude,lng:x.longitude}):99999})).filter(h=>!/야영장|펜션|풀장|캠핑|민박|호텔|카페|식당/.test(h.x.title)).sort((a,b)=>a.x.title.replace(/\s/g,'').length-b.x.title.replace(/\s/g,'').length||a.d-b.d)[0];
 if(!best||best.d>8000){missing.push(s.id);continue;}
 const p=best.x.repPhoto.photoid;
 out[s.id]={contentsid:best.x.contentsid,title:best.x.title,thumb:p.thumbnailpath,img:p.imgpath,link:`https://www.visitjeju.net/kr/detail/view?contentsid=${best.x.contentsid}`};
}
await writeFile(join(root,'public/data/tour-photos.json'),JSON.stringify({source:'VISIT JEJU (제주관광공사) 관광정보 OPEN API',builtAt:new Date().toISOString(),photos:out},null,1));
console.log('photos',Object.keys(out).length,'missing',missing.join(',')||'-');
for(const [id,p] of Object.entries(out))console.log(id,'→',p.title);
