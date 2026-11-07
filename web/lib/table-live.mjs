// 시간표 주요 정류장과 실제 노선 정류장을 순서대로 맞춰, 달리는 차량이 표의 어느 구간에 있는지 알려 준다.
// 표 이름은 "남원"처럼 짧고 노선 정류장은 "남원읍사무소"처럼 길어서 포함 관계로 맞춘다. 맞지 않는 칸은 비워 두고 지어내지 않는다.
import {baseName} from './network.mjs';
import {distanceMeters} from './catalog.mjs';

const NEAR_METERS=1000;
const same=(a,b)=>a.length>1&&b.length>1&&(a===b||a.includes(b)||b.includes(a));
// 표 칸마다 노선 정류장 위치를 고른다. 순서를 지키면서 가장 많이 맞는 조합을 쓴다.
export function alignStops(names,routeNames){
 const keys=routeNames.map(baseName),chain=[];
 names.forEach((name,row)=>{
  const key=baseName(name),fresh=[];
  keys.forEach((routeKey,index)=>{
   if(!same(key,routeKey))return;
   let prev=null;for(const c of chain)if(c.index<index&&(!prev||c.length>prev.length))prev=c;
   fresh.push({row,index,length:(prev?.length||0)+1,prev});
  });
  chain.push(...fresh);
 });
 const out=names.map(()=>null);let best=null;for(const c of chain)if(!best||c.length>best.length)best=c;
 for(let c=best;c;c=c.prev)out[c.row]=c.index;
 return out;
}
// 번호의 변형 중 이 표와 같은 방향인 것만 남긴다. 반대 방향은 순서가 뒤집혀 거의 맞지 않는다.
export function matchVariants(names,variants){
 const list=variants.map(v=>{const at=alignStops(names,v.stops.map(s=>s.name));return {...v,at,hits:at.filter(x=>x!==null).length};}),top=Math.max(0,...list.map(v=>v.hits));
 return top<2?[]:list.filter(v=>v.hits>=Math.max(2,Math.ceil(top/2)));
}
function indexOnRoute(vehicle,stops){
 const byOrder=stops[Number(vehicle.order)-1];if(byOrder&&byOrder.name===vehicle.stop)return Number(vehicle.order)-1;
 const pool=stops.map((s,i)=>({s,i})),named=pool.filter(x=>x.s.name===vehicle.stop),point={lat:Number(vehicle.lat),lng:Number(vehicle.lng)},near=list=>list.reduce((a,b)=>distanceMeters(point,a.s)<=distanceMeters(point,b.s)?a:b);
 if(named.length)return near(named).i;
 const closest=pool.length?near(pool):null;
 return closest&&distanceMeters(point,closest.s)<=NEAR_METERS?closest.i:null;
}
// after: 차량이 지난 표의 마지막 칸. -1은 첫 칸 전, null은 표 구간과 이을 수 없는 차량이다.
export function placeVehicles(vehicles,variants){
 return vehicles.flatMap(v=>{
  const route=variants.find(x=>x.id===v.routeId);if(!route)return [];
  const index=indexOnRoute(v,route.stops);let after=index===null?null:-1;
  if(index!==null)route.at.forEach((at,row)=>{if(at!==null&&at<=index)after=row;});
  return [{id:v.id,stop:v.stop||null,after}];
 });
}
