// 타도 돼 카드: 이쪽이 맞아? 오늘 오긴 해? 언제 와? 놓치면? 주의.
// 판단 순서는 공지 → 실시간 도착 → 시간표다. 근거가 없으면 단정하지 않는다.
import {ServiceError} from './catalog.mjs';
import {scheduleUrl} from './network.mjs';

// 상태값 7종. plan은 공개 시간표를 해석한 결과이고, 없거나 불확실하면 단정하지 않는다.
export function todayState({notice=null,arrival=null,vehicleSeen=false,plan=null}={}){
 if(notice)return {state:'changed',notice};
 if(arrival)return {state:'coming',minutes:Math.max(1,Math.ceil(arrival.seconds/60)),remainingStops:arrival.remainingStops??null};
 if(vehicleSeen)return {state:'running'};
 if(!plan||plan.today==='unsure')return {state:'unknown'};
 const source={sourceUrl:plan.sourceUrl||null,effective:plan.effective||null};
 if(plan.today==='off')return {state:'notToday',kind:plan.kind,...source};
 if(plan.today==='before')return {state:'beforeFirst',time:plan.first||plan.firstTime,base:plan.firstBase||null,...source};
 if(plan.today==='ended')return {state:'ended',...source};
 return {state:'scheduled',time:plan.next,interval:plan.interval,last:plan.last,lastBase:plan.lastBase,...source};
}

export function createBoard({catalog,network,noticesFor=async()=>[],timetable=null,now=Date.now}){
 return {
  async stop(stopId){
   if(typeof stopId!=='string'||!/^[\w:.-]{1,100}$/.test(stopId))throw new ServiceError('invalidRequest',400);
   const [live,map]=await Promise.all([catalog.arrivals(stopId),network.stopDirections(stopId).catch(()=>null)]),profile=await network.stopProfile?.(stopId).catch(()=>null)||null;
   const directions=map?.directions||[],byNo=new Map();
   const row=no=>{if(!byNo.has(no))byNo.set(no,{no,arrivals:[],directions:[],scheduleUrl:scheduleUrl(no)});return byNo.get(no);};
   for(const d of directions)row(d.no).directions.push({next:d.next,end:d.end,terminus:d.terminus,loop:d.loop,variantIds:d.variantIds});
   for(const a of live.arrivals)row(a.number).arrivals.push(a);
   const notices=await noticesFor([...byNo.keys()],stopId).catch(()=>new Map());
   const rows=await Promise.all([...byNo.values()].map(async r=>{
    r.arrivals.sort((a,b)=>a.seconds-b.seconds);
    const first=r.arrivals[0]||null,notice=notices.get?.(r.no)?.[0]||null,direction=first?r.directions.find(d=>d.variantIds.includes(first.routeId))||null:null,ends=[...new Set(r.directions.map(d=>d.end))],only=direction||(ends.length===1?r.directions[0]:null),plan=timetable?await timetable.plan(r.no,{stopName:map?.stop?.name||null,towards:only?.end||null}).catch(()=>null):null;
    return {no:r.no,routeId:first?.routeId||r.directions[0]?.variantIds[0]||null,direction,directions:r.directions.map(({variantIds,...d})=>d),arrivals:r.arrivals.map(a=>({minutes:Math.max(1,Math.ceil(a.seconds/60)),remainingStops:a.remainingStops??null})),notice,scheduleUrl:r.scheduleUrl,plan:plan?{today:plan.today,first:plan.first||plan.firstTime||null,interval:plan.interval,last:plan.last,lastBase:plan.lastBase,next:plan.next||null}:null,today:todayState({notice,arrival:first,plan})};
   })).then(list=>list.sort((a,b)=>(a.arrivals[0]?.minutes??1e9)-(b.arrivals[0]?.minutes??1e9)||a.no.localeCompare(b.no,'ko',{numeric:true})));
   return {stop:map?.stop||{id:stopId,name:live.arrivals[0]?.stop||''},receivedAt:live.receivedAt,builtAt:await network.builtAt().catch(()=>null),inNetwork:!!map,profile,partners:map?.partners||[],arrivals:live.arrivals,rows};
  },
  // 귀가선: 이 정류장에서 돌아갈 정류장까지 바로 가는 번호의 오늘 마지막 출발. 시간표 값만 쓴다.
  async homeLine(stopId,homeName){
   const side=await network.sideCheck(stopId,homeName);if(!side)return null;
   if(side.verdict==='same')return {verdict:'same',to:side.to,options:[]};
   const at=await network.stopDirections(stopId),stopName=at?.stop?.name||null,numbers=[...side.here,...side.unsure],towards=no=>{const ends=[...new Set((at?.directions||[]).filter(d=>d.no===no).map(d=>d.end))];return ends.length===1?ends[0]:null;};
   const options=(await Promise.all(numbers.map(async no=>{const plan=await timetable?.plan(no,{stopName,towards:towards(no)}).catch(()=>null);return {no,sure:side.here.includes(no),today:plan?.today||'unknown',last:plan?.lastHere||plan?.last||null,lastHere:!!plan?.lastHere,lastBase:plan?.lastHere?null:plan?.lastBase||null,notes:plan?.notes||[],effective:plan?.effective||null,sourceUrl:plan?.sourceUrl||null};}))).sort((a,b)=>(b.last||'').localeCompare(a.last||''));
   return {verdict:side.verdict,to:side.to,options,across:side.across,acrossStop:side.acrossStop};
  }
 };
}
