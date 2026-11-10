// 지도 실험 화면의 경로 탐색. 번호표(network.json)만 쓰므로 외부 호출이 없다.
// 시간표 정보가 없어 도착 시각은 계산하지 않고, 환승 수·도보·정류장 수로만 순서를 정한다.
export const WALK_M_PER_MIN=67,ROAD_DETOUR=1.3;
const PER_STOP=1.1,TRANSFER=8,TRANSFER_M=150,KEEP_PER_STOP=10;
const KX=92900,KY=111000;
export const distanceM=(a,b)=>Math.hypot((a.lng-b.lng)*KX,(a.lat-b.lat)*KY);
export const walkMinutes=m=>m*ROAD_DETOUR/WALK_M_PER_MIN;
export const radiusOf=minutes=>minutes*WALK_M_PER_MIN/ROAD_DETOUR;
export const baseName=name=>String(name||'').replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\s+/g,'').replace(/^제주국제공항\d+$/,'제주국제공항').trim();
const VIRTUAL=/수요응답형|가상/;

export function indexNetwork(network,station=null){
 const stops=network.stops.map(([id,name,number,lat,lng],i)=>({i,id,name,number,lat,lng,base:baseName(name),station:station?station[i]:i,virtual:VIRTUAL.test(name)}));
 const variants=network.variants.filter(v=>v.stops.length>1).map((v,i)=>({...v,i}));
 const at=stops.map(()=>[]);variants.forEach(v=>v.stops.forEach((s,pos)=>at[s].push([v.i,pos])));
 const cell=new Map(),key=(x,y)=>`${x}:${y}`,CELL=.006;
 for(const s of stops){if(s.virtual||!at[s.i].length)continue;const k=key(Math.floor(s.lat/CELL),Math.floor(s.lng/CELL));if(!cell.has(k))cell.set(k,[]);cell.get(k).push(s);}
 const near=(p,m)=>{const span=Math.ceil(m/660),y=Math.floor(p.lat/CELL),x=Math.floor(p.lng/CELL),out=[];for(let a=y-span;a<=y+span;a++)for(let b=x-span;b<=x+span;b++)for(const s of cell.get(key(a,b))||[]){const d=distanceM(p,s);if(d<=m)out.push([s,d]);}return out;};
 const members=new Map();for(const s of stops){if(!members.has(s.station))members.set(s.station,[]);members.get(s.station).push(s);}
 const net={stops,variants,at,near,members,numbersAt:new Map()};
 return net;
}

export function numbersAt(net,i){
 if(!net.numbersAt.has(i))net.numbersAt.set(i,[...new Set(net.at[i].map(([v])=>net.variants[v].no))]);
 return net.numbersAt.get(i);
}

// minutes가 0이면 가장 가까운 정류장 한 곳(길 건너 짝 포함), 아니면 도보 범위 안의 정류장 전부.
export function stopsWithin(net,point,minutes){
 const found=new Map(),add=(s,d)=>{if(!found.has(s.i)||d<found.get(s.i).meters)found.set(s.i,{stop:s,meters:d,minutes:walkMinutes(d)});};
 let radius=120;let hits=net.near(point,radius);
 while(!hits.length&&radius<60000){radius*=2;hits=net.near(point,radius);}
 if(!hits.length)return [];
 const [closest]=hits.reduce((a,b)=>b[1]<a[1]?b:a);
 add(closest,distanceM(point,closest));
 for(const s of net.members.get(closest.station)||[])if(net.at[s.i].length&&!s.virtual)add(s,distanceM(point,s));
 if(minutes>0)for(const [s,d]of net.near(point,radiusOf(minutes)))add(s,d);
 return [...found.values()].sort((a,b)=>a.meters-b.meters);
}

function boardLabels(net,origin){
 // 정류장별로 "여기까지 번호 N으로 올 때 가장 적은 비용"
 const entry=new Map(origin.map(o=>[o.stop.i,o])),labels=new Map();
 for(const v of net.variants){
  let best=null;
  v.stops.forEach((s,pos)=>{
   if(best&&pos>best.pos){const cost=best.walk+(pos-best.pos)*PER_STOP;let m=labels.get(s);if(!m){m=new Map();labels.set(s,m);}const prior=m.get(v.no);if(!prior||cost<prior.cost)m.set(v.no,{cost,no:v.no,v:v.i,from:best.pos,to:pos,walk:best.walk,board:best.entry});}
   const e=entry.get(s);if(e&&(!best||e.minutes<=best.walk+(pos-best.pos)*PER_STOP))best={pos,walk:e.minutes,entry:e};
  });
 }
 return labels;
}
function alightLabels(net,destination){
 const exit=new Map(destination.map(o=>[o.stop.i,o])),labels=new Map();
 for(const v of net.variants){
  let best=null;
  for(let pos=v.stops.length-1;pos>=0;pos--){
   const s=v.stops[pos];
   if(best&&pos<best.pos){const cost=best.walk+(best.pos-pos)*PER_STOP;let m=labels.get(s);if(!m){m=new Map();labels.set(s,m);}const prior=m.get(v.no);if(!prior||cost<prior.cost)m.set(v.no,{cost,no:v.no,v:v.i,from:pos,to:best.pos,walk:best.walk,off:best.exit});}
   const e=exit.get(s);if(e&&(!best||e.minutes<=best.walk+(best.pos-pos)*PER_STOP))best={pos,walk:e.minutes,exit:e};
  }
 }
 return labels;
}
const top=m=>[...m.values()].sort((a,b)=>a.cost-b.cost).slice(0,KEEP_PER_STOP);
function neighbours(net,i,cache){if(!cache.has(i))cache.set(i,net.near(net.stops[i],TRANSFER_M).map(([s,d])=>[s.i,d]));return cache.get(i);}
const leg=(net,l)=>{const v=net.variants[l.v];return {no:l.no,variant:v.i,variantId:v.id,type:v.type,from:l.from,to:l.to,board:v.stops[l.from],alight:v.stops[l.to],stops:l.to-l.from};};

export function search(net,from,to,{walkFrom=0,walkTo=0,limit=12}={}){
 const origin=stopsWithin(net,from,walkFrom),destination=stopsWithin(net,to,walkTo);
 const inOrigin=new Set(origin.map(o=>o.stop.i)),inDest=new Set(destination.map(o=>o.stop.i));
 const L1=boardLabels(net,origin),L2=alightLabels(net,destination),cache=new Map(),options=new Map();
 const put=(key,score,build)=>{const prior=options.get(key);if(!prior||score<prior.score)options.set(key,{score,build});};
 // 직행
 for(const d of destination){const m=L1.get(d.stop.i);if(!m)continue;for(const l of m.values()){const score=l.cost+d.minutes;put(`d|${l.no}`,score,()=>({legs:[leg(net,l)],boardWalk:l.board,exitWalk:d,transferWalks:[]}));}}
 // 환승 1회
 for(const [x,m1]of L1){
  if(inDest.has(x))continue;const first=top(m1);
  for(const [y,meters]of neighbours(net,x,cache)){
   if(inOrigin.has(y))continue;const m2=L2.get(y);if(!m2)continue;const minutes=walkMinutes(meters);
   for(const a of first)for(const b of top(m2)){if(a.no===b.no)continue;const score=a.cost+b.cost+TRANSFER+minutes;put(`t|${a.no}|${b.no}`,score,()=>({legs:[leg(net,a),leg(net,b)],boardWalk:a.board,exitWalk:b.off,transferWalks:[{from:x,to:y,minutes}]}));}
  }
 }
 // 환승 2회: 위 두 가지로 아무것도 없을 때만
 if(!options.size){
  const best1=new Map();for(const [x,m]of L1)best1.set(x,top(m)[0]);
  const start=new Map();
  for(const [x,a]of best1)for(const [y,meters]of neighbours(net,x,cache)){const minutes=walkMinutes(meters),cost=a.cost+TRANSFER+minutes,p=start.get(y);if(!p||cost<p.cost)start.set(y,{cost,a,x,y,minutes});}
  const mid=new Map();
  for(const v of net.variants){let best=null;v.stops.forEach((s,pos)=>{if(best&&pos>best.pos){const cost=best.cost+(pos-best.pos)*PER_STOP,p=mid.get(s);if(!p||cost<p.cost)mid.set(s,{cost,v:v.i,no:v.no,from:best.pos,to:pos,prev:best.prev});}const e=start.get(s);if(e&&e.a.no!==v.no&&(!best||e.cost<=best.cost+(pos-best.pos)*PER_STOP))best={pos,cost:e.cost,prev:e};});}
  for(const [x,b]of mid){if(inDest.has(x))continue;for(const [y,meters]of neighbours(net,x,cache)){const m=L2.get(y);if(!m)continue;const minutes=walkMinutes(meters);for(const c of top(m)){if(c.no===b.no)continue;const score=b.cost+c.cost+TRANSFER+minutes;put(`x|${b.prev.a.no}|${b.no}|${c.no}`,score,()=>({legs:[leg(net,b.prev.a),leg(net,b),leg(net,c)],boardWalk:b.prev.a.board,exitWalk:c.off,transferWalks:[{from:b.prev.x,to:b.prev.y,minutes:b.prev.minutes},{from:x,to:y,minutes}]}));}}}
 }
 const built=[...options.entries()].sort((a,b)=>a[1].score-b[1].score).map(([key,o])=>{
  const r=o.build(),walk=r.boardWalk.minutes+r.exitWalk.minutes+r.transferWalks.reduce((n,w)=>n+w.minutes,0);
  return {key,score:o.score,transfers:r.legs.length-1,walkMinutes:walk,rideStops:r.legs.reduce((n,l)=>n+l.stops,0),...r,boardStop:r.boardWalk.stop,exitStop:r.exitWalk.stop,tags:[]};
 });
 const list=diversify(built,limit);
 tag(list);
 const direct=distanceM(from,to);
 return {options:list,total:built.length,origin,destination,walkOnly:direct<=radiusOf(25)?walkMinutes(direct):null};
}
// 번호 조합이 너무 비슷한 결과가 위를 채우지 않도록 직행을 앞에 보장한다.
function diversify(all,limit){
 const direct=all.filter(o=>o.transfers===0).slice(0,Math.ceil(limit*.6)),rest=all.filter(o=>!direct.includes(o));
 return [...direct,...rest].sort((a,b)=>a.score-b.score).slice(0,limit);
}
function tag(list){
 if(!list.length)return;
 const min=(field)=>list.reduce((a,b)=>b[field]<a[field]?b:a);
 list[0].tags.push('best');
 min('walkMinutes').tags.push('leastWalk');
 min('rideStops').tags.push('fewestStops');
}
// 번호의 운행 방향 묶음: 기점과 종점이 같은 변형은 하나로 보고 정류장이 가장 많은 것을 대표로 쓴다.
export function directionGroups(net,no){
 const groups=new Map();
 for(const v of net.variants){if(v.no!==no)continue;const first=net.stops[v.stops[0]],last=net.stops[v.stops.at(-1)],k=`${first.station}>${last.station}`,p=groups.get(k);if(!p){groups.set(k,{v,from:first.base,to:last.base,count:1});continue;}p.count++;if(v.stops.length>p.v.stops.length)p.v=v;}
 return [...groups.values()].sort((a,b)=>b.v.stops.length-a.v.stops.length);
}
// 가지 번호를 본 번호로 묶는다. 202-1은 202의 가지다.
export const baseNumber=no=>String(no).split('-')[0];
export function numberFamilies(net){
 const families=new Map();
 for(const v of net.variants){const base=baseNumber(v.no);if(!families.has(base))families.set(base,new Set());families.get(base).add(v.no);}
 return new Map([...families].map(([base,set])=>[base,[...set].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}))]));
}
// 번호 검색: 앞자리가 맞는 번호를 먼저, 그다음 중간에 들어간 번호. 가지 번호까지 치면 그 가지를 바로 찾는다.
export function searchNumbers(families,query,limit=14){
 const q=String(query||'').replace(/[^\d-]/g,'');if(!q)return [];
 const natural=(a,b)=>a.localeCompare(b,'ko',{numeric:true});
 if(q.includes('-'))return [...families.values()].flat().filter(n=>n.startsWith(q)).sort(natural).slice(0,limit).map(no=>({no,family:[no]}));
 const bases=[...families.keys()],head=bases.filter(b=>b.startsWith(q)).sort(natural),middle=bases.filter(b=>!b.startsWith(q)&&b.includes(q)).sort(natural);
 return [...head,...middle].slice(0,limit).map(base=>({no:families.get(base).includes(base)?base:families.get(base)[0],family:families.get(base)}));
}
