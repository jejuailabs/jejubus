// 번호표: 번호 → 방향 → 변형 ID 묶음과 정류장 순서. TAGO 호출 없이 정적 파일만 읽는다.
// 방향 값(updowncd)이 전부 0이라 쓰지 않는다. 방향은 기점·종점과 다음 정류장으로 만든다.
import {readFile} from 'node:fs/promises';
import {distanceMeters} from './catalog.mjs';
import {gradeOf} from '../public/board.js';

// 제주 대표 관광지와 그 정류장 이름(번호표 정류장 이름 기준)
export const SPOTS=[['seongsan',/^성산일출봉입구/],['hyeopjae',/^협재해수욕장/],['hamdeok',/^함덕환승정류장/],['jungmun',/^중문관광단지입구/],['dongmun',/동문시장/],['cheonjiyeon',/^천지연폭포입구/],['woljeong',/^월정리/],['sanbang',/^산방산/]];
const PARTNER_METERS=300,HUB_ROUTES=12,GRADE_ORDER=['express','trunk','branch','tour','other'];
// 바로 갈 수 있는 곳으로 알려 줄 주요 지점
const AREAS=[['제주공항',/^제주국제공항|^공항/],['제주버스터미널',/^제주버스터미널/],['제주시청',/^제주시청/],['제주대학교',/^제주대학교/],['서귀포버스터미널',/^서귀포버스터미널/],['중문',/^중문/],['성산',/^성산/],['함덕',/^함덕/],['한림',/^한림/],['표선',/^표선/],['대정·모슬포',/^(대정|모슬포|하모)/],['애월',/^애월/],['남원',/^남원/],['조천',/^조천/]];
// 정류장 유형. 색은 서는 버스 중 가장 빠른 등급, 모양은 노선 수다. 공식 환승정류장은 노선 수와 상관없이 거점이다.
export function stopKind(name,numbers){
 const count=numbers.length,grades=numbers.map(gradeOf),grade=GRADE_ORDER.find(g=>grades.includes(g))||'other';
 const kind=/환승정류장|환승센터|버스터미널|제주국제공항/.test(name)||count>=HUB_ROUTES?'hub':count>=6?'many':count>=2?'some':'one';
 return {kind,grade,routes:count,grades:Object.fromEntries(GRADE_ORDER.map(g=>[g,grades.filter(x=>x===g).length]).filter(([,n])=>n))};
}
// 괄호의 방면, [동] 같은 방위, 공항 승차장 번호는 같은 장소의 표기 차이다.
export const baseName=name=>String(name||'').replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\s+/g,'').replace(/^제주국제공항\d+$/,'제주국제공항').trim();
export const scheduleUrl=no=>`https://bus.jeju.go.kr/schedule/viewNew/${encodeURIComponent(String(no).split('-')[0])}`;

const rule_here=(stop,[,rule])=>rule.test(stop.base);
export function indexNetwork(data){
 const stops=data.stops.map(([id,name,no,lat,lng],i)=>({i,id,name,no,lat,lng,base:baseName(name)}));
 const byId=new Map(stops.map(s=>[s.id,s])),byBase=new Map(),byNo=new Map(),byVariant=new Map(),byStop=new Map();
 for(const s of stops){if(!byBase.has(s.base))byBase.set(s.base,[]);byBase.get(s.base).push(s);}
 data.variants.forEach(v=>{
  if(!v.stops.length)return;
  const first=stops[v.stops[0]],last=stops[v.stops.at(-1)];
  const variant={...v,firstName:first.name,lastName:last.name,loop:first.base===last.base||new Set(v.stops).size<v.stops.length};
  byVariant.set(v.id,variant);
  if(!byNo.has(v.no))byNo.set(v.no,[]);byNo.get(v.no).push(variant);
  for(const i of new Set(v.stops)){if(!byStop.has(i))byStop.set(i,[]);byStop.get(i).push(variant);}
 });
 return {builtAt:data.builtAt,stops,byId,byBase,byNo,byVariant,byStop};
}

export function createNetwork(load){
 let ready=null;
 const net=()=>ready??=Promise.resolve().then(load).then(indexNetwork).catch(error=>{ready=null;throw error;});
 const partners=(n,stop)=>(n.byBase.get(stop.base)||[]).filter(s=>s.id!==stop.id&&distanceMeters(stop,s)<=PARTNER_METERS);
 // 이 변형에서 stop 다음에 target 집합의 정류장이 오는가
 const reaches=(v,index,targets)=>{for(let at=v.stops.indexOf(index);at>=0&&at<v.stops.length;at++)if(at>v.stops.indexOf(index)&&targets.has(v.stops[at]))return true;return false;};
 function directionsAt(n,stop,no){
  const out=new Map();
  for(const v of n.byStop.get(stop.i)||[]){
   if(no&&v.no!==no)continue;
   const at=v.stops.indexOf(stop.i),twice=v.stops.lastIndexOf(stop.i)!==at,nextIndex=v.stops[at+1];
   const next=nextIndex===undefined?null:n.stops[nextIndex].name,key=`${v.no}|${next}|${v.lastName}`;
   if(!out.has(key))out.set(key,{no:v.no,next,end:v.lastName,terminus:next===null,loop:v.loop||twice,variantIds:[]});
   out.get(key).variantIds.push(v.id);
  }
  return [...out.values()];
 }
 return {
  async builtAt(){return (await net()).builtAt;},
  // 제주 대표 관광지 정류장과 그곳에 서는 버스. 공항을 지나 이 정류장에 오는 번호, 빠른 등급, 본 번호(가지 번호 아님) 순으로 3개 고른다.
  async spots(list=SPOTS){
   const n=await net(),airport=new Set(n.stops.filter(s=>/^제주국제공항/.test(s.name)).map(s=>s.i)),rank=g=>GRADE_ORDER.indexOf(g);
   return list.map(([id,rule])=>{
    const pool=n.stops.filter(s=>rule.test(s.name));if(!pool.length)return null;
    const routes=new Map();
    for(const s of pool)for(const v of n.byStop.get(s.i)||[]){const prior=routes.get(v.no),at=v.stops.indexOf(s.i),fly=v.stops.slice(0,at).some(i=>airport.has(i));routes.set(v.no,{no:v.no,airport:!!(prior?.airport||fly)});}
    const stop=[...pool].sort((x,y)=>(n.byStop.get(y.i)||[]).length-(n.byStop.get(x.i)||[]).length)[0];
    const top=[...routes.values()].sort((x,y)=>(y.airport-x.airport)||((x.no.split('-')[0].length>3)-(y.no.split('-')[0].length>3))||(rank(gradeOf(x.no))-rank(gradeOf(y.no)))||(x.no.includes('-')-y.no.includes('-'))||x.no.localeCompare(y.no,'ko',{numeric:true})).slice(0,3);
    return {id,stop:{id:stop.id,name:stop.name,lat:stop.lat,lng:stop.lng},routes:top.map(r=>r.no),airport:top[0]?.airport||false,total:routes.size};
   }).filter(Boolean);
  },
  // 길찾기 결과의 정류장 이름을 번호표 정류장으로 잇는다. 같은 이름이면 좌표가 가까운 쪽을 고른다.
  async stopByName(name,point=null){
   const n=await net(),list=n.byBase.get(baseName(name))||[];if(!list.length)return null;
   const exact=list.filter(s=>s.name===name),pool=exact.length?exact:list;
   const best=point?[...pool].sort((a,b)=>distanceMeters(point,a)-distanceMeters(point,b))[0]:pool[0];
   return {id:best.id,name:best.name,lat:best.lat,lng:best.lng,sure:pool.length===1||!!point};
  },
  // 지도 화면 안의 정류장. 호출 제한이 있는 TAGO를 쓰지 않고 번호표에서 고른다.
  // 넓게 볼수록 칸을 키워 칸마다 노선이 가장 많은 정류장 하나만 남긴다.
  async stopsIn({south,west,north,east},zoom){
   const n=await net(),numbers=s=>[...new Set((n.byStop.get(s.i)||[]).map(v=>v.no))],routes=s=>numbers(s).length,inside=n.stops.filter(s=>s.lat>=south&&s.lat<=north&&s.lng>=west&&s.lng<=east),cell=zoom>=15?0:.0016*2**(15-zoom),seen=new Set();
   const ranked=inside.map(s=>({s,count:routes(s)})).sort((a,b)=>b.count-a.count||a.s.i-b.s.i),kept=cell?ranked.filter(({s})=>{const key=`${Math.floor(s.lat/cell)}:${Math.floor(s.lng/cell)}`;if(seen.has(key))return false;seen.add(key);return true;}):ranked;
   const stops=kept.slice(0,350).map(({s})=>{const {kind,grade,routes:count}=stopKind(s.name,numbers(s));return {id:s.id,name:s.name,number:s.no,lat:s.lat,lng:s.lng,kind,grade,routes:count};});
   return {stops,total:inside.length,thinned:stops.length<inside.length};
  },
  // 정류장 소개: 유형과 갈아타지 않고 갈 수 있는 주요 지점
  async stopProfile(stopId){
   const n=await net(),stop=n.byId.get(stopId);if(!stop)return null;
   const variants=n.byStop.get(stop.i)||[],numbers=[...new Set(variants.map(v=>v.no))],places=new Map();
   for(const v of variants){const at=v.stops.indexOf(stop.i);for(const i of v.stops.slice(at+1)){const base=n.stops[i].base,hit=AREAS.find(([,rule])=>rule.test(base));if(hit&&!rule_here(stop,hit)){if(!places.has(hit[0]))places.set(hit[0],new Set());places.get(hit[0]).add(v.no);}}}
   const reachable=AREAS.filter(([name])=>places.has(name)).map(([name])=>({name,routes:places.get(name).size}));
   return {...stopKind(stop.name,numbers),reachable};
  },
  // 이 번호로 이 정류장 다음에 갈 수 있는 정류장. 내린 곳을 고를 때 쓴다.
  async regionTotals(){const n=await net(),t={east:0,west:0,south:0,north:0};for(const s of n.stops){const r=s.lng>=126.72?'east':s.lng<=126.38?'west':s.lat>=33.38?'north':'south';t[r]++;}return t;},
  async stopsAfter(stopId,no){
   const n=await net(),stop=n.byId.get(stopId);if(!stop)return [];const seen=new Map();
   for(const v of n.byStop.get(stop.i)||[]){if(v.no!==no)continue;for(const i of v.stops.slice(v.stops.indexOf(stop.i)+1)){const s=n.stops[i];if(!seen.has(s.id))seen.set(s.id,{id:s.id,name:s.name,lat:s.lat,lng:s.lng});}}
   return [...seen.values()].slice(0,120);
  },
  // 내 위치에서 가까운 정류장
  async nearest(point,limit=10){
   const n=await net();
   return n.stops.map(s=>({s,distance:distanceMeters(point,s)})).sort((a,b)=>a.distance-b.distance).slice(0,limit).map(({s,distance})=>{const {kind,grade,routes}=stopKind(s.name,[...new Set((n.byStop.get(s.i)||[]).map(v=>v.no))]);return {id:s.id,name:s.name,number:s.no,lat:s.lat,lng:s.lng,distanceMeters:Math.round(distance),kind,grade,routes};});
  },
  // 시간표와 맞춰 볼 이 번호의 변형들
  async variantStops(no){const n=await net();return (n.byNo.get(no)||[]).map(v=>({id:v.id,stops:v.stops.map(i=>n.stops[i])}));},
  // 이름이 같은 양쪽 정류장을 나눠 보여 준다. 다음 정류장으로 방향을 구분한다.
  // 글쓰기에서 고를 노선: 번호가 맞거나 기점·종점 이름에 들어간 것
  async findRoutes(query,limit=6){
   const n=await net(),q=String(query||'').trim();if(!q)return [];const digits=/^\d/.test(q),seen=new Set(),out=[];
   for(const v of n.byVariant.values()){const hit=digits?v.no===q||v.no.startsWith(q):(v.start||'').includes(q)||(v.end||'').includes(q);if(!hit)continue;const key=`${v.no}|${v.start}|${v.end}`;if(seen.has(key))continue;seen.add(key);out.push({id:v.id,number:v.no,start:v.start||v.firstName,end:v.end||v.lastName,exact:v.no===q});}
   return out.sort((a,b)=>b.exact-a.exact||a.number.localeCompare(b.number,'ko',{numeric:true})).slice(0,limit).map(({exact,...r})=>r);
  },
  async namedStops(query,limit=12){
   const n=await net(),q=baseName(query);if(q.length<2)return [];
   const names=[...n.byBase.keys()].filter(b=>b.includes(q)).sort((a,b)=>(b===q)-(a===q)||(b.startsWith(q))-(a.startsWith(q))||a.length-b.length);
   return names.flatMap(name=>n.byBase.get(name)).slice(0,limit).map(s=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng,next:directionsAt(n,s).find(d=>d.next)?.next||null}));
  },
  // 출발·도착 근처 정류장을 잇는 직행 번호. 방향이 맞는 변형만 쓰고 번호마다 가장 편한 조합을 남긴다.
  async directTrips(from,to,{walk=800,limit=3}={}){
   const n=await net(),within=(p,m)=>n.stops.map(s=>({s,d:distanceMeters(p,s)})).filter(x=>x.d<=m),ends=new Map(within(to,walk).map(x=>[x.s.i,x.d])),best=new Map();
   const brief=(s,w)=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng,walk:w});
   for(const {s,d} of within(from,walk))for(const v of n.byStop.get(s.i)||[]){
    const at=v.stops.indexOf(s.i);
    for(let k=at+1;k<v.stops.length;k++){const i=v.stops[k];if(!ends.has(i))continue;const off=ends.get(i),score=d+off+(k-at)*75,prior=best.get(v.no);if(!prior||score<prior.score)best.set(v.no,{no:v.no,variantId:v.id,score,stops:k-at,board:brief(s,d),off:brief(n.stops[i],off)});}
   }
   return [...best.values()].sort((a,b)=>a.score-b.score).slice(0,limit);
  },
  // 타고 있는 번호에서 목적지에 가장 가까운 정류장. 위치를 알면 지금 위치 뒤쪽 정류장만 본다.
  async alightOn(no,to,me=null){
   const n=await net();let best=null;
   for(const v of n.byNo.get(no)||[]){
    const stops=v.stops.map(i=>n.stops[i]);let start=-1;
    if(me){let near=Infinity;stops.forEach((s,i)=>{const d=distanceMeters(me,s);if(d<near){near=d;start=i;}});if(near>2000)continue;}
    for(let k=start+1;k<stops.length;k++){const d=distanceMeters(to,stops[k]);if(!best||d<best.walk)best={no,variantId:v.id,id:stops[k].id,name:stops[k].name,lat:stops[k].lat,lng:stops[k].lng,walk:d,stopsLeft:me?k-start:null,now:me?stops[start].name:null,before:k>0?stops[k-1].name:null,end:v.lastName};}
   }
   return best;
  },
  async stopByCode(code){const n=await net(),digits=String(code).replace(/\D/g,'');if(digits.length<5)return null;const s=n.stops.find(x=>x.id.endsWith(digits));return s?{id:s.id,name:s.name,lat:s.lat,lng:s.lng}:null;},
  async numbers(){const n=await net();return [...n.byNo.keys()].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));},
  async hasNumber(no){return (await net()).byNo.has(no);},
  async variantsOf(variantId){const n=await net(),v=n.byVariant.get(variantId);return v?n.byNo.get(v.no).map(o=>o.id):[];},
  async stats(){const n=await net();return {builtAt:n.builtAt,variants:n.byVariant.size,numbers:n.byNo.size,stops:n.stops.length};},
  async groupOf(variantId){
   const n=await net(),v=n.byVariant.get(variantId);if(!v)return null;
   return {no:v.no,key:`${v.no}|${v.firstName}→${v.lastName}`,variantIds:n.byNo.get(v.no).filter(o=>o.firstName===v.firstName&&o.lastName===v.lastName).map(o=>o.id)};
  },
  async numberOf(variantId){return (await net()).byVariant.get(variantId)?.no||null;},
  async groups(no){
   const n=await net(),variants=n.byNo.get(no);if(!variants)return null;
   const groups=new Map();
   for(const v of variants){const key=`${v.firstName}→${v.lastName}`;if(!groups.has(key))groups.set(key,{key,from:v.firstName,to:v.lastName,loop:v.loop,variantIds:[]});groups.get(key).variantIds.push(v.id);}
   return {no,variantCount:variants.length,groups:[...groups.values()].sort((a,b)=>b.variantIds.length-a.variantIds.length),scheduleUrl:scheduleUrl(no)};
  },
  // 이 정류장을 지나는 번호별 방향. 다음 정류장과 종점이 판정의 1단계다.
  async stopDirections(stopId){
   const n=await net(),stop=n.byId.get(stopId);if(!stop)return null;
   return {stop:{id:stop.id,name:stop.name},directions:directionsAt(n,stop),partners:partners(n,stop).map(s=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng}))};
  },
  async directionFor(stopId,variantId){
   const n=await net(),stop=n.byId.get(stopId),v=n.byVariant.get(variantId);if(!stop||!v)return null;
   return directionsAt(n,stop,v.no).find(d=>d.variantIds.includes(variantId))||null;
  },
  async searchStops(query,limit=8){
   const n=await net(),q=baseName(query);if(q.length<2)return [];
   const names=[...n.byBase.keys()].filter(b=>b.includes(q)).sort((a,b)=>(b===q)-(a===q)||(b.startsWith(q))-(a.startsWith(q))||a.length-b.length).slice(0,limit);
   return names.map(name=>({name,count:n.byBase.get(name).length}));
  },
  // 2단계: 목적지 기준 판정. 위치를 쓰지 않는다. 양쪽 모두 닿는 번호나 순환만 있으면 단정하지 않는다.
  async sideCheck(stopId,toName){
   const n=await net(),stop=n.byId.get(stopId),base=baseName(toName),targets=new Set((n.byBase.get(base)||[]).map(s=>s.i));
   if(!stop||!targets.size)return null;
   if(targets.has(stop.i)||stop.base===base)return {verdict:'same',to:base,here:[],across:[],unsure:[]};
   const opposite=partners(n,stop),reach=(s)=>{const nos=new Map();for(const v of n.byStop.get(s.i)||[])if(reaches(v,s.i,targets))nos.set(v.no,(nos.get(v.no)||false)||!v.loop);return nos;};
   const here=reach(stop),across=new Map(),acrossStop=new Map();
   for(const p of opposite)for(const [no,straight]of reach(p)){across.set(no,(across.get(no)||false)||straight);if(!acrossStop.has(no))acrossStop.set(no,p);}
   const sure=[],far=[],unsure=[];
   for(const [no,straight]of here){if(across.has(no)||!straight)unsure.push(no);else sure.push(no);}
   for(const [no,straight]of across){if(here.has(no))continue;if(straight)far.push(no);else unsure.push(no);}
   const stopOf=far[0]&&acrossStop.get(far[0]);
   const verdict=sure.length?'here':far.length?'across':unsure.length?'unsure':'none';
   const sort=a=>a.sort((x,y)=>x.localeCompare(y,'ko',{numeric:true}));
   return {verdict,to:base,here:sort(sure),across:sort(far),unsure:sort(unsure),acrossStop:stopOf?{id:stopOf.id,name:stopOf.name,lat:stopOf.lat,lng:stopOf.lng}:null};
  }
 };
}

export const fileNetwork=path=>createNetwork(async()=>JSON.parse(await readFile(path,'utf8')));
