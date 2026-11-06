// 번호표 배치: TAGO 노선 목록과 노선별 정류장 순서를 전수로 받아 public/data/network.json을 만든다.
// 노선 개정 공지가 있을 때 로컬에서만 실행한다. 호출량은 노선 ID 수 + 목록 몇 번이다.
// 실행: node --env-file-if-exists=.env.local scripts/build-network.mjs
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const key=process.env.TAGO_SERVICE_KEY,cityCode=process.env.TAGO_CITY_CODE;
if(!key||!cityCode){console.error('TAGO_SERVICE_KEY, TAGO_CITY_CODE가 필요합니다.');process.exit(1);}
const CACHE='data/network-raw.json',OUT='public/data/network.json',GAP=120;
const list=x=>!x?[]:Array.isArray(x)?x:[x];
let calls=0;
async function tago(service,operation,params){
 const url=new URL(`https://apis.data.go.kr/1613000/${service}/${operation}`);
 url.search=new URLSearchParams({serviceKey:key,_type:'json',cityCode,...params});
 for(let attempt=0;;attempt++){
  try{
   calls++;
   const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const data=await response.json(),code=String(data.response?.header?.resultCode);
   if(!['00','0'].includes(code))throw new Error(`결과 코드 ${code}`);
   return {items:list(data.response?.body?.items?.item),total:Number(data.response?.body?.totalCount||0)};
  }catch(error){if(attempt>=2)throw new Error(`${operation} 실패: ${error.message}`);await delay(1500*(attempt+1));}
 }
}
async function allRoutes(){
 const routes=new Map();
 for(let page=1;;page++){
  const {items,total}=await tago('BusRouteInfoInqireService','getRouteNoList',{numOfRows:'500',pageNo:String(page)});
  for(const r of items)routes.set(String(r.routeid),{id:String(r.routeid),no:String(r.routeno),type:String(r.routetp||''),start:String(r.startnodenm||''),end:String(r.endnodenm||'')});
  if(!items.length||routes.size>=total)return routes;
  await delay(GAP);
 }
}
await mkdir('data',{recursive:true});await mkdir('public/data',{recursive:true});
let raw={};try{raw=JSON.parse(await readFile(CACHE,'utf8'));}catch{}
const routes=await allRoutes();
console.log(`노선 ID ${routes.size}개`);
if(routes.size<500)throw new Error('목록이 너무 적습니다. 저장하지 않습니다.');
let done=0;
for(const route of routes.values()){
 done++;
 if(raw[route.id])continue;
 const {items}=await tago('BusRouteInfoInqireService','getRouteAcctoThrghSttnList',{routeId:route.id,numOfRows:'600',pageNo:'1'});
 raw[route.id]=items.map(s=>({id:String(s.nodeid),name:String(s.nodenm),no:String(s.nodeno??''),lat:Number(s.gpslati),lng:Number(s.gpslong),order:Number(s.nodeord)}));
 if(done%50===0){await writeFile(CACHE,JSON.stringify(raw));console.log(`${done}/${routes.size} (호출 ${calls})`);}
 await delay(GAP);
}
await writeFile(CACHE,JSON.stringify(raw));
const stops=[],index=new Map(),variants=[];
for(const route of routes.values()){
 const ordered=(raw[route.id]||[]).filter(s=>s.id&&Number.isFinite(s.lat)&&Number.isFinite(s.lng)).sort((a,b)=>a.order-b.order);
 const seq=ordered.map(s=>{if(!index.has(s.id)){index.set(s.id,stops.length);stops.push([s.id,s.name,s.no,Math.round(s.lat*1e6)/1e6,Math.round(s.lng*1e6)/1e6]);}return index.get(s.id);});
 variants.push({...route,stops:seq});
}
const out={builtAt:new Date().toISOString(),source:'국토교통부 TAGO',stops,variants};
await writeFile(OUT,JSON.stringify(out));
console.log(`완료: 노선 ID ${variants.length}, 정류장 없는 ID ${variants.filter(v=>!v.stops.length).length}, 고유 정류장 ${stops.length}, 번호 ${new Set(variants.map(v=>v.no)).size}, 호출 ${calls}`);
