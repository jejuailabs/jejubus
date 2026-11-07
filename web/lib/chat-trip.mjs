// 챗봇의 승하차 판단. 말이 아니라 번호표 데이터로 어디서 타고 내릴지 정한다.
// 방향이 맞는 변형에서만 승차 정류장을 고르므로 같은 이름의 건너편 정류장이 섞이지 않는다. 사람이 현장에서 대조할 수 있게 다음 정류장도 함께 낸다.
import {distanceMeters} from './catalog.mjs';

const GPS_MARGIN=15; // 위치 오차로 건너편 경고가 잘못 뜨지 않게 이만큼 더 가까울 때만 알린다.
const WORDS=['n','ne','e','se','s','sw','w','nw'];
export function heading(from,to){
 const rad=n=>n*Math.PI/180,dLng=rad(to.lng-from.lng),a=rad(from.lat),b=rad(to.lat);
 const deg=(Math.atan2(Math.sin(dLng)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(dLng))*180/Math.PI+360)%360;
 return WORDS[Math.round(deg/45)%8];
}
const CANDIDATES=12,MAX_LIVE_STOPS=4,WALK_METERS_PER_MIN=70,NO_ARRIVAL=600;
const walkMinutes=m=>Math.ceil((m||0)/WALK_METERS_PER_MIN);
// 걸어가는 동안 지나갈 버스는 빼고, 잡을 수 있는 버스부터 보여 준다.
export function catchable(arrival,walkMeters){const left=(arrival.minutes||[]).filter(m=>m>=walkMinutes(walkMeters));return left.length?{...arrival,minutes:left,missed:left.length<arrival.minutes.length,remainingStops:left.length<arrival.minutes.length?null:arrival.remainingStops}:arrival;}
// 지금 가서 가장 빨리 탈 수 있는 순서. 도착 정보가 없는 번호는 뒤로 보낸다.
export const rankByBoarding=options=>[...options].sort((a,b)=>(a.arrival.minutes?.[0]??NO_ARRIVAL)-(b.arrival.minutes?.[0]??NO_ARRIVAL)||(a.stops||0)-(b.stops||0));
const walkInfo=(me,stop)=>me?{walkMeters:distanceMeters(me,stop),heading:heading(me,stop)}:{};

export function createTripTools({network,board,catalog}){
 const arrivalsAt=memo=>(stopId)=>memo.get(stopId)||memo.set(stopId,board.stop(stopId).catch(()=>null)).get(stopId);
 function arrivalOf(result,no){
  if(!result)return {live:false};
  const row=result.rows.find(r=>r.no===no);if(!row)return {live:true,minutes:[]};
  return {live:true,minutes:row.arrivals.slice(0,3).map(a=>a.minutes),remainingStops:row.arrivals[0]?.remainingStops??null,today:row.plan?.today||null,next:row.plan?.next||null,last:row.plan?.last||null,notice:row.notice?.title||null};
 }
 // 현장에서 대조할 정보: 다음 정류장, 종점, 건너편 같은 이름 정류장
 async function boardDetail(stop,no,variantId,me){
  const map=await network.stopDirections(stop.id),ways=(map?.directions||[]).filter(d=>!no||d.no===no),way=ways.find(d=>d.variantIds.includes(variantId))||ways[0]||null;
  const partner=map?.partners?.[0]||null;let opposite=null;
  if(partner){const other=await network.stopDirections(partner.id),next=other?.directions.find(d=>!no||d.no===no)?.next||other?.directions[0]?.next||null;opposite={id:partner.id,name:partner.name,next,nearer:!!me&&distanceMeters(me,partner)+GPS_MARGIN<distanceMeters(me,stop)};}
  return {id:stop.id,name:stop.name,lat:stop.lat,lng:stop.lng,...walkInfo(me,stop),next:way?.next||null,towards:way?.end||null,loop:!!way?.loop,opposite};
 }
 return {
  // 갈아타지 않는 번호를 먼저 찾고, 없으면 길찾기 제공처의 환승 경로를 정류장에 잇는다.
  async plan(from,to,{me=null}={}){
   const memo=arrivalsAt(new Map());
   let direct=await network.directTrips(from,to,{limit:CANDIDATES});if(!direct.length)direct=await network.directTrips(from,to,{walk:1500,limit:CANDIDATES});
   // 도착을 묻는 정류장은 네 곳까지만. 호출을 아끼고 가까운 승차 정류장 위주로 본다.
   const asked=[...new Set(direct.map(o=>o.board.id))].slice(0,MAX_LIVE_STOPS);direct=direct.filter(o=>asked.includes(o.board.id));
   const provider=await catalog.journeys(from,to,'fastest').catch(()=>null),journeys=provider?.journeys||[];
   const options=await Promise.all(direct.map(async o=>{
    const [boardAt,live]=await Promise.all([boardDetail(o.board,o.no,o.variantId,me),memo(o.board.id)]),match=journeys.find(j=>j.legs.some(l=>l.type==='bus'&&l.routes.some(r=>r.number===o.no)));
    return {no:o.no,routeId:o.variantId,board:boardAt,off:{id:o.off.id,name:o.off.name,lat:o.off.lat,lng:o.off.lng,walkToDestination:o.off.walk},stops:o.stops,arrival:catchable(arrivalOf(await live,o.no),o.board.walk),providerMinutes:match?Math.ceil(match.totalMinutes):null,then:[]};
   }));
   if(options.length)return {options:rankByBoarding(options).slice(0,3),source:provider?.source||'Jeju Bus',receivedAt:provider?.receivedAt};
   const transfers=await Promise.all(journeys.slice(0,2).map(async j=>{
    const legs=j.legs.filter(l=>l.type==='bus'),first=legs[0];if(!first)return null;
    const no=first.routes[0]?.number||'',stop=await network.stopByName(first.start,first.points?.[0]||null);
    const off=await network.stopByName(first.end,first.points?.at(-1)||null),boardAt=stop?await boardDetail(stop,no,null,me):{name:first.start};
    return {no,routeId:null,board:boardAt,off:off?{id:off.id,name:off.name,lat:off.lat,lng:off.lng}:{name:first.end},stops:null,arrival:arrivalOf(stop?await memo(stop.id):null,no),providerMinutes:Math.ceil(j.totalMinutes),then:legs.slice(1).map(l=>({numbers:l.routes.map(r=>r.number),board:l.start,off:l.end}))};
   }));
   return {options:transfers.filter(Boolean),source:provider?.source||null,receivedAt:provider?.receivedAt,noRoute:!provider};
  },
  // 내 주변 정류장과 곧 오는 버스. 번호를 주면 그 번호가 서는 정류장만 본다.
  async nearby(me,no=null){
   const memo=arrivalsAt(new Map()),list=await network.nearest(me,no?40:6),picked=[];
   for(const s of list){if(picked.length>=(no?2:5))break;const detail=await boardDetail(s,no,null,me);if(no&&!detail.next&&!detail.towards)continue;picked.push(detail);}
   return Promise.all(picked.map(async(s,i)=>{const live=i<2?await memo(s.id):null;return {...s,routes:live?live.rows.filter(r=>r.arrivals.length&&(!no||r.no===no)).slice(0,6).map(r=>({no:r.no,minutes:r.arrivals.slice(0,2).map(a=>a.minutes),towards:r.direction?.end||null})):null,liveChecked:!!live};}));
  },
  // 정류장 이름·ID로 찾은 곳의 도착. 같은 이름 양쪽을 함께 보여 방향을 고르게 한다.
  async arrivals(stops,no,me){
   const memo=arrivalsAt(new Map());
   return Promise.all(stops.slice(0,2).map(async s=>{const detail=await boardDetail(s,no,null,me),live=await memo(s.id);return {...detail,...(no?{number:no,arrival:arrivalOf(live,no)}:{routes:(live?.rows||[]).filter(r=>r.arrivals.length).slice(0,8).map(r=>({no:r.no,minutes:r.arrivals.slice(0,2).map(a=>a.minutes),towards:r.direction?.end||null}))}),liveChecked:!!live};}));
  },
  // 이 번호를 타고 목적지에 가장 가까운 곳에서 내린다.
  async alight(no,to,me){
   const best=await network.alightOn(no,to,me);if(!best)return null;
   return best;
  }
 };
}
