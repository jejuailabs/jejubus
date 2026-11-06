// 번호표: 번호 → 방향 → 변형 ID 묶음과 정류장 순서. TAGO 호출 없이 정적 파일만 읽는다.
// 방향 값(updowncd)이 전부 0이라 쓰지 않는다. 방향은 기점·종점과 다음 정류장으로 만든다.
import {readFile} from 'node:fs/promises';
import {distanceMeters} from './catalog.mjs';

const PARTNER_METERS=300;
// 괄호의 방면, [동] 같은 방위, 공항 승차장 번호는 같은 장소의 표기 차이다.
export const baseName=name=>String(name||'').replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\s+/g,'').replace(/^제주국제공항\d+$/,'제주국제공항').trim();
export const scheduleUrl=no=>`https://bus.jeju.go.kr/schedule/viewNew/${encodeURIComponent(String(no).split('-')[0])}`;

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
