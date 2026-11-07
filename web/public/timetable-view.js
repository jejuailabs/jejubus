// 앱 안 시간표. 넓은 표 대신 방향과 정류장을 고르면 그 정류장의 시각만 크게 보여 준다.
import {busFace} from './board.js';
const parts=(g,e,t)=>[g.first&&t('ttFirst',{v:e(g.first)}),g.last&&t('ttLast',{v:e(g.last)}),g.interval&&t('ttGap',{v:e(g.interval)})].filter(Boolean).join(' · ');
function timeChip(item,next,mark,e,t){
 const cls=['tt-time',item.off?'off':'',!item.off&&next?'next':'',!item.off&&item.past?'past':'',item.maybe?'maybe':''].filter(Boolean).join(' ');
 return `<li class="${cls}">${item.off?`<s>${e(item.time)}</s>`:e(item.time)}${mark?`<sup>${mark}</sup>`:''}${!item.off&&next?`<small>${t('ttNext')}</small>`:''}</li>`;
}
// 도착 희망 시각에 맞는 가장 늦은 회차. 표에 두 정류장 시각이 모두 있는 회차만 쓴다.
const toMinutes=value=>{const m=/^(\d{1,2}):(\d{2})$/.exec(value||'');if(!m)return null;const n=Number(m[1])*60+Number(m[2]);return n<240?n+1440:n;};
export function planTrip(group,from,to,target,now=null){
 const start=group.stops[from],end=group.stops[to],goal=toMinutes(target);if(!start||!end||from===to||goal===null)return null;
 let best=null;
 for(const board of start.times){if(board.off||(now!==null&&board.minutes<now))continue;const off=end.times.find(x=>x.trip===board.trip&&!x.off);if(!off||off.minutes<=board.minutes||off.minutes>goal)continue;if(!best||off.minutes>best.off.minutes)best={board,off};}
 return best&&{board:best.board.time,off:best.off.time,ride:best.off.minutes-best.board.minutes,early:goal-best.off.minutes,maybe:best.board.maybe};
}
// 정류장 노트: 한 회차가 정류장마다 표에 적힌 시각. 표에 없는 정류장은 지어내지 않는다.
function liveHead(view,live,e,t){
 if(!live)return `<p class="tt-live-head"><span>${t('ttLiveLoading')}</span></p>`;
 if(live.error)return `<p class="tt-live-head"><span>${t('ttLiveError')}</span></p>`;
 const map=`<button data-live-no="${e(view.no)}">${t('ttLiveMap')}</button>`;
 if(!live.matched)return `<p class="tt-live-head"><span>${t('ttLiveNoMatch')}</span>${map}</p>`;
 const off=live.vehicles.filter(v=>v.after===null).length;
 return `<p class="tt-live-head"><span>${live.vehicles.length?t('ttLiveCount',{n:live.vehicles.length,time:e(live.at)}):t('ttLiveNone')}${off?` ${t('ttLiveOff',{n:off})}`:''}</span>${map}</p>`;
}
const liveBus=(no,v,e,t)=>`<li class="tt-live-bus">${busFace(no,e,t)}<small>${v.stop?t('ttLiveAt',{stop:e(v.stop)}):''}</small></li>`;
function noteMarkup(view,g,stop,times,next,e,t,live,showLive){
 const run=view.run;
 const list=times.filter(x=>!x.off);if(!list.length)return `<p class="tt-done">${t('ttNoRun')}</p>`;
 const index=Math.min(list.length-1,Math.max(0,run??list.indexOf(next??list[0]))),pick=list[index];
 const rows=g.stops.map((s,i)=>({i,name:s.name,item:s.times.find(x=>x.trip===pick.trip)})).filter(x=>x.item);
 // 회차와 상관없이 지금 달리는 차량을 이 회차가 서는 칸 사이에 끼워 넣는다.
 const buses=showLive?(live?.vehicles||[]).filter(v=>v.after!==null):[],slot=v=>rows.reduce((at,x,n)=>x.i<=v.after?n:at,-1);
 return `<div class="tt-run"><button data-tt-run="${index-1}" ${index?'':'disabled'} aria-label="${t('ttPrevRun')}">‹</button><span>${t('ttRun',{time:e(pick.time)})}</span><button data-tt-run="${index+1}" ${index<list.length-1?'':'disabled'} aria-label="${t('ttNextRun')}">›</button></div><div id="tt-note-live">${showLive?liveHead(view,live,e,t):''}<ol class="tt-line-list">${buses.filter(v=>slot(v)<0).map(v=>liveBus(view.no,v,e,t)).join('')}${rows.map((x,n)=>`<li class="${g.stops[x.i]===stop?'here':''}"><button data-tt-stop="${x.i}"><span>${e(x.name)}</span><b>${e(x.item.time)}</b></button></li>${buses.filter(v=>slot(v)===n).map(v=>liveBus(view.no,v,e,t)).join('')}`).join('')}</ol></div><p class="tt-note">${t('ttNoteHelp')}${showLive?` ${t('ttNoteLiveHelp')}`:''}</p>`;
}
// 여정 승차권: 시간표 기준. 실시간 도착이 아니다.
function tripMarkup(g,trip,now,e,t){
 const from=g.stop,to=trip.to??g.stops.length-1,target=trip.target||'',result=planTrip(g,from,to,target,now),same=from===to;
 const ticket=result?`<div class="tt-ticket"><div class="tt-ticket-head"><span>${t('ttTicket')}</span><small>${t('ttTicketBasis')}</small></div><div class="tt-ticket-body"><div><small>${t('ttBoard')}</small><b>${e(result.board)}</b><span>${e(g.stops[from].name)}</span></div><i>${t('ttRide',{n:result.ride})}</i><div><small>${t('ttAlight')}</small><b>${e(result.off)}</b><span>${e(g.stops[to].name)}</span></div></div><p>${result.early?t('ttEarly',{n:result.early}):t('ttOnTime')}${result.maybe?` ${t('ttMaybe')}`:''}</p></div>`:'';
 return `<div class="tt-trip"><label>${t('ttTo')}<select id="tt-to">${g.stops.map((s,i)=>`<option value="${i}" ${i===to?'selected':''}>${e(s.name)}</option>`).join('')}</select></label><label>${t('ttTarget')}<input id="tt-target" type="time" value="${e(target)}"></label></div>${same?`<p class="tt-note">${t('ttSameStop')}</p>`:!target?`<p class="tt-note">${t('ttTargetHelp')}</p>`:ticket||`<p class="tt-done">${t('ttNoTrip')}</p>`}`;
}
export function timetableMarkup(view,e,t){
 if(!view?.groups?.length)return `<div class="form-modal tt-sheet"><h2>${busFace(view?.no||'',e,t)} ${t('ttTitle',{no:e(view?.no||'')})}</h2><p>${t('ttNone')}</p><a class="tt-source" href="${e(view?.sourceUrl||'https://bus.jeju.go.kr/')}" target="_blank" rel="noopener noreferrer">${t('ttSource')}</a></div>`;
 const g=view.groups[view.group]||view.groups[0],stop=g.stops[g.stop]||g.stops[0],notes=[],marks=new Map(),isToday=!view.day||!g.day||g.day===view.day,mode=view.mode||'times';
 for(const item of stop.times)if(item.note&&!marks.has(item.note)){notes.push(item.note);marks.set(item.note,notes.length);}
 const times=stop.times.map(x=>({...x,past:isToday&&x.minutes<view.current})),next=isToday?times.find(x=>!x.off&&!x.past):null;
 const days=[...new Set(view.groups.map(x=>x.day).filter(Boolean))],same=view.groups.filter(x=>x.day===g.day),ends=same.map(x=>x.end),twin=x=>ends.filter(y=>y===x.end).length>1;
 return `<div class="form-modal tt-sheet"><div class="tt-head">${busFace(view.no,e,t)}<div><h2>${t('ttTitle',{no:e(view.no)})}</h2><p>${t(`ttDay${view.kind}`)}</p></div></div>
 ${days.length>1?`<div class="tt-days" role="tablist" aria-label="${t('ttDayPick')}">${days.map(d=>`<button role="tab" aria-selected="${d===g.day}" class="${d===g.day?'active':''}" data-tt-day="${d}">${t(`ttTab${d}`)}${d===view.day?`<small>${t('ttTodayMark')}</small>`:''}</button>`).join('')}</div>`:''}
 ${view.day&&!view.groups.some(x=>x.day===view.day)?`<p class="tt-done">${t('ttNoToday')}</p>`:view.kind==='saturday'&&view.day==='holiday'?`<p class="tt-note">${t('ttSaturdayGuess')}</p>`:''}
 ${same.length>1?`<div class="tt-groups" role="tablist" aria-label="${t('ttDirection')}">${same.map(x=>{const i=view.groups.indexOf(x);return `<button role="tab" aria-selected="${i===view.group}" class="${i===view.group?'active':''}" data-tt-group="${i}">${t('ttToward',{stop:e(x.end)})}${twin(x)?`<small>${e(x.path)}</small>`:''}</button>`;}).join('')}</div>`:`<p class="tt-path">${e(g.path)}</p>`}
 ${parts(g,e,t)?`<p class="tt-line">${parts(g,e,t)}</p>`:''}
 <label class="tt-stop">${t('ttStop')}<select id="tt-stop">${g.stops.map((s,i)=>`<option value="${i}" ${i===g.stop?'selected':''}>${e(s.name)} (${t('ttTrips',{n:s.times.length})})</option>`).join('')}</select></label>
 ${stop.times.length<Math.max(...g.stops.map(s=>s.times.length))/2?`<p class="tt-note">${t('ttFewTrips',{n:stop.times.length})}</p>`:''}
 <div class="tt-modes" role="tablist">${['times','note','trip'].map(m=>`<button role="tab" aria-selected="${mode===m}" class="${mode===m?'active':''}" data-tt-mode="${m}">${t(`ttMode_${m}`)}</button>`).join('')}</div>
 ${mode==='note'?noteMarkup(view,g,stop,times,next,e,t,view.live?.key===`${view.no}|${view.group}`?view.live:null,isToday):mode==='trip'?tripMarkup(g,view.trip||{},isToday?view.current:null,e,t):`<ul class="tt-times">${times.map(x=>timeChip(x,x===next,marks.get(x.note),e,t)).join('')}</ul>${isToday&&!next?`<p class="tt-done">${t('ttDone')}</p>`:''}`}
 ${times.some(x=>x.maybe)?`<p class="tt-note">${t('ttMaybe')}</p>`:''}
 ${notes.length?`<div class="tt-notes"><strong>${t('ttNotes')}</strong><ol>${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ol></div>`:''}
 <p class="tt-note">${t('ttWarn')}${g.effective?` ${e(g.effective)}`:''}</p>
 <a class="tt-source" href="${e(view.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('ttSource')}</a></div>`;
}
