// 타도 돼 카드: 이쪽이 맞아? 오늘 오긴 해? 언제 와? 놓치면? 주의.
// 판단 순서는 공지 → 실시간 도착 → 시간표다. 근거가 없으면 단정하지 않는다.
import {ServiceError} from './catalog.mjs';
import {scheduleUrl} from './network.mjs';
import {koreaDay} from './telemetry.mjs';

const KST=9*3600000;
const minuteOfDay=now=>{const d=new Date(now+KST);return d.getUTCHours()*60+d.getUTCMinutes();};
const dayKind=now=>{const d=new Date(now+KST).getUTCDay();return d===0?'sunday':d===6?'saturday':'weekday';};
const toMinutes=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(s||'');return m?Number(m[1])*60+Number(m[2]):null;};

// 상태값 7종. timetable은 사람이 검수한 표일 때만 넘긴다. 없으면 시간표로 말하지 않는다.
export function todayState({notice=null,arrival=null,vehicleSeen=false,timetable=null,now=Date.now()}={}){
 if(notice)return {state:'changed',notice};
 if(arrival)return {state:'coming',minutes:Math.max(1,Math.ceil(arrival.seconds/60)),remainingStops:arrival.remainingStops??null};
 if(vehicleSeen)return {state:'running'};
 if(!timetable?.reviewed)return {state:'unknown'};
 const today=koreaDay(now);
 if(timetable.effectiveTo&&today>timetable.effectiveTo)return {state:'unknown'};
 if(timetable.holidays?.includes(today)&&!timetable.days?.holiday)return {state:'unknown'};
 const kind=timetable.holidays?.includes(today)?'holiday':dayKind(now),times=timetable.days?.[kind];
 if(times===undefined)return {state:'unknown'};
 const source={sourceUrl:timetable.sourceUrl||null,effectiveDate:timetable.effectiveDate||null};
 if(!times.length)return {state:'notToday',kind,...source};
 const list=times.map(toMinutes).filter(n=>n!==null).sort((a,b)=>a-b),at=minuteOfDay(now),next=list.find(n=>n>=at);
 if(!list.length)return {state:'unknown'};
 const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 if(at<list[0])return {state:'beforeFirst',time:clock(list[0]),...source};
 if(next===undefined)return {state:'ended',...source};
 return {state:'scheduled',time:clock(next),...source};
}

export function createBoard({catalog,network,noticesFor=async()=>[],now=Date.now}){
 return {
  async stop(stopId){
   if(typeof stopId!=='string'||!/^[\w:.-]{1,100}$/.test(stopId))throw new ServiceError('invalidRequest',400);
   const [live,map]=await Promise.all([catalog.arrivals(stopId),network.stopDirections(stopId).catch(()=>null)]);
   const directions=map?.directions||[],byNo=new Map();
   const row=no=>{if(!byNo.has(no))byNo.set(no,{no,arrivals:[],directions:[],scheduleUrl:scheduleUrl(no)});return byNo.get(no);};
   for(const d of directions)row(d.no).directions.push({next:d.next,end:d.end,terminus:d.terminus,loop:d.loop,variantIds:d.variantIds});
   for(const a of live.arrivals)row(a.number).arrivals.push(a);
   const notices=await noticesFor([...byNo.keys()],stopId).catch(()=>new Map());
   const rows=[...byNo.values()].map(r=>{
    r.arrivals.sort((a,b)=>a.seconds-b.seconds);
    const first=r.arrivals[0]||null,notice=notices.get?.(r.no)?.[0]||null,direction=first?r.directions.find(d=>d.variantIds.includes(first.routeId))||null:null;
    return {no:r.no,routeId:first?.routeId||r.directions[0]?.variantIds[0]||null,direction,directions:r.directions.map(({variantIds,...d})=>d),arrivals:r.arrivals.map(a=>({minutes:Math.max(1,Math.ceil(a.seconds/60)),remainingStops:a.remainingStops??null})),notice,scheduleUrl:r.scheduleUrl,today:todayState({notice,arrival:first,now:now()})};
   }).sort((a,b)=>(a.arrivals[0]?.minutes??1e9)-(b.arrivals[0]?.minutes??1e9)||a.no.localeCompare(b.no,'ko',{numeric:true}));
   return {stop:map?.stop||{id:stopId,name:live.arrivals[0]?.stop||''},receivedAt:live.receivedAt,builtAt:await network.builtAt().catch(()=>null),inNetwork:!!map,partners:map?.partners||[],arrivals:live.arrivals,rows};
  }
 };
}
