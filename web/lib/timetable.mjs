// 공개 시간표 해석. 표의 시각과 비고 원문만 쓰고, 도착 시각을 계산하지 않는다.
// 표에는 주요 정류장만 있어서 대부분의 정류장은 노선 전체의 첫차·막차와 공식 배차 문구로 답한다.
import {readFile} from 'node:fs/promises';
import {baseName,scheduleUrl} from './network.mjs';
import {koreaDay} from './telemetry.mjs';

const KST=9*3600000,DAY=1440,CUT=240;
export function parseTime(cell){
 const m=/(?:^|[^\d])(\d{1,2}):(\d{2})/.exec(` ${cell||''}`);if(!m||Number(m[2])>59)return null;
 const value=Number(m[1])*60+Number(m[2]);return value<CUT?value+DAY:value;
}
const clock=n=>{const v=n%DAY;return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;};
const NOT=/운행\s*안|미운행|운휴|쉼/;
export function tripFlags(note){
 const text=String(note||'');
 const days=/(?:^|[\s(,.·])토\s*[,.·]|토요일|주말|공휴일|휴일|방학/.test(text),off=days&&NOT.test(text),weekendOnly=/(?:토|일요|공휴|주말|휴일)[^,]*만\s*운행/.test(text),weekdayOnly=/평일\s*만/.test(text)||/평일\s*(?:에만|운행)$/.test(text);
 return {saturday:off&&/(?:^|[\s(,.·])토\s*[,.·]|토요일|주말/.test(text),sunday:off&&/일요|주말|공휴|휴일/.test(text),holiday:off&&/공휴|휴일/.test(text),vacation:off&&/방학/.test(text),weekendOnly,weekdayOnly};
}
const parsed=new WeakMap();
const rowNumber=(cell,fallback)=>/^\d+(?:-\d+)?/.exec(String(cell||'').trim())?.[0]||fallback;
export function tripsOf(tab){
 if(parsed.has(tab))return parsed.get(tab);
 const noteCol=tab.columns.findIndex(c=>/비\s*고/.test(c)),noCol=tab.columns.findIndex(c=>/노선\s*번호/.test(c));
 const trips=tab.rows.map(cells=>{
  const times=[];let extra='';
  cells.forEach((cell,col)=>{if(col===noteCol||col===noCol||!cell)return;const t=parseTime(cell);if(t!==null)times.push({col,minutes:t});else if(!/^[X○x\-]$/.test(cell))extra+=` ${cell}`;});
  const cell=noCol>=0?cells[noCol]||'':'',note=`${noteCol>=0?cells[noteCol]||'':''}${extra}`.trim(),flags=tripFlags(note);
  if(/\(평일\)/.test(cell))flags.weekdayOnly=true;
  return {no:rowNumber(cell,rowNumber(tab.no,tab.no)),times,note,flags};
 }).filter(t=>t.times.length);
 parsed.set(tab,trips);return trips;
}
// 날짜가 고정된 공휴일만 안다. 설·추석·대체공휴일은 알 수 없어 표 기준 평일로 남는다.
const FIXED_HOLIDAYS=new Set(['01-01','03-01','05-05','06-06','08-15','10-03','10-09','12-25']);
export const dayKind=now=>{const date=new Date(now+KST),d=date.getUTCDay();if(FIXED_HOLIDAYS.has(date.toISOString().slice(5,10)))return 'sunday';return d===0?'sunday':d===6?'saturday':'weekday';};
const effectiveDay=text=>{const m=/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(text||'');return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
// 같은 방향 탭이 여러 시행일이면 오늘 기준 최신 탭만 쓴다.
export function currentTabs(tabs,today){
 const best=new Map();
 for(const tab of tabs){const day=effectiveDay(tab.effective)||'0000-00-00';if(day>today)continue;const key=`${tab.no}|${tab.path}`;const prior=best.get(key);if(!prior||day>prior.day)best.set(key,{tab,day});}
 return [...best.values()].map(x=>x.tab);
}
export function headline(run,no){
 const text=String(run||''),parts=text.split(/(?=\[[\d-]+번\])/).filter(p=>p.startsWith('[')),part=parts.length?parts.find(p=>p.startsWith(`[${no}번]`))||'':text;
 const first=/첫차(?:\(([^)]*)\))?\s*(\d{1,2}:\d{2})/.exec(part),last=/막차(?:\(([^)]*)\))?\s*(\d{1,2}:\d{2})/.exec(part),gap=/배차간격\s*([\d~\s-]+분)/.exec(part);
 return {first:first?.[2]||null,firstBase:first?.[1]||null,last:last?.[2]||null,lastBase:last?.[1]||null,interval:gap?.[1]?.replace(/\s/g,'')||null};
}
const excluded=(t,kind)=>(kind==='saturday'&&t.flags.saturday)||(kind==='sunday'&&(t.flags.sunday||t.flags.holiday))||(kind==='weekday'&&t.flags.weekendOnly)||(kind!=='weekday'&&t.flags.weekdayOnly);
const maybe=t=>t.flags.vacation;
export function createTimetable(load,{now=Date.now}={}){
 let ready=null;
 const data=()=>ready??=Promise.resolve().then(load).catch(error=>{ready=null;throw error;});
 const tabsFor=async no=>{const d=await data(),route=d.routes[String(no).split('-')[0]];if(!route)return [];const today=koreaDay(now());return currentTabs(route.tabs,today);};
 return {
  // 번호 하나의 오늘 계획. 알 수 없으면 null을 돌려준다. 방학 기간은 공식 달력이 없어 방학 제외 회차만 남으면 단정하지 않는다.
  async plan(no,{stopName=null,towards=null}={}){
   const tabs=await tabsFor(no);if(!tabs.length)return null;
   const kind=dayKind(now()),entries=tabs.flatMap(tab=>tripsOf(tab).filter(t=>t.no===no).map(trip=>({trip,tab})));
   if(!entries.length)return null;
   const running=entries.filter(({trip})=>!excluded(trip,kind));
   // 양방향 문구가 다르면 방향을 알 때만 첫차·막차를 말한다.
   const pairs=x=>new Set(Array.from({length:Math.max(0,x.length-1)},(_,i)=>x.slice(i,i+2))),wanted=towards?pairs(baseName(towards)):null;
   const score=tab=>wanted?[...pairs(baseName(tab.path.split('-').at(-1)))].filter(p=>wanted.has(p)).length:0,best=Math.max(0,...tabs.map(score)),top=entries.filter(({tab})=>score(tab)===best),own=best>0&&new Set(top.map(({tab})=>tab.path.split('-').at(-1))).size===1?top[0]:null;
   const heads=[...new Set(entries.map(({tab})=>JSON.stringify(headline(tab.run,no))))],head=own?headline(own.tab.run,no):heads.length===1?JSON.parse(heads[0]):{first:null,firstBase:null,last:null,lastBase:null,interval:null};
   const base={reviewed:true,sourceUrl:scheduleUrl(no),effective:(own||entries[0]).tab.effective,kind,...head};
   if(!running.length)return {...base,today:'off'};
   if(running.every(({trip})=>maybe(trip)))return {...base,today:'unsure'};
   const all=running.flatMap(({trip})=>trip.times.map(t=>t.minutes)),raw=new Date(now()+KST),at=raw.getUTCHours()*60+raw.getUTCMinutes(),current=at<CUT?at+DAY:at,first=Math.min(...all),last=Math.max(...all);
   const lastDepart=Math.max(...running.map(({trip})=>Math.min(...trip.times.map(t=>t.minutes))));
   if(heads.length===1||own){base.last||=clock(lastDepart);base.first||=clock(first);}
   const notes=[...new Set(entries.map(({trip})=>trip.note).filter(n=>/막차|승객|종료|단축|회차/.test(n)))].slice(0,3);
   let next=null,lastHere=null;
   if(stopName){
    const key=baseName(stopName),matches=running.filter(({tab})=>tab.columns.some(c=>baseName(c)===key));
    const ends=towards?matches.filter(({tab})=>baseName(towards).startsWith(baseName(tab.path.split('-').at(-1)).slice(0,2))):matches,pool=new Set(ends.map(x=>x.tab)).size===1?ends:new Set(matches.map(x=>x.tab)).size===1?matches:[];
    const times=pool.flatMap(({trip,tab})=>trip.times.filter(t=>baseName(tab.columns[t.col])===key).map(t=>t.minutes)).filter(m=>m>=current).sort((a,b)=>a-b);
    if(times.length)next=clock(times[0]);
    const every=pool.flatMap(({trip,tab})=>trip.times.filter(t=>baseName(tab.columns[t.col])===key).map(t=>t.minutes));if(every.length)lastHere=clock(Math.max(...every));
   }
   const state=current<first?'before':current>last?'ended':'running';
   return {...base,today:state,firstTime:clock(first),lastTime:clock(last),next,lastHere,notes};
  }
 };
}
export const fileTimetable=(path,options)=>createTimetable(async()=>JSON.parse(await readFile(path,'utf8')),options);
