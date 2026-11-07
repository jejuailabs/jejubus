// 시간표 메뉴: 노선 기준, 정류장 기준, 목적지 기준. 정류장 카드와 시간표 창의 조각을 그대로 다시 쓴다.
import {busFace} from './board.js';
import {art} from './art.js';
import {icon} from './icons.js';

export const TT_PLACES=['제주공항','제주버스터미널','서귀포버스터미널','제주대학교','중문','성산','함덕','한림'];
export const filterNumbers=(numbers,query)=>{const q=String(query||'').trim();if(!q)return [];return numbers.filter(n=>n.startsWith(q)).concat(numbers.filter(n=>!n.startsWith(q)&&n.includes(q))).slice(0,24);};
export const numberGrid=(numbers,e,t)=>numbers.length?`<div class="tt-numbers">${numbers.map(n=>`<button data-tt-no="${e(n)}" aria-label="${e(n)}">${busFace(n,e,t)}</button>`).join('')}</div>`:'';
export const stopList=(names,e)=>names.map(s=>`<button class="tt-stop-hit" data-tt-name="${e(s.name)}"><span>${e(s.name)}</span>${s.count>1?`<small>${s.count}</small>`:''}</button>`).join('');
// 오늘 곧 오는 버스 세 대. 값은 TAGO 그대로이고 시각을 계산하지 않는다.
export function upcomingMarkup(board,e,t){
 const list=(board?.rows||[]).flatMap(r=>r.arrivals.slice(0,2).map(a=>({no:r.no,...a}))).sort((a,b)=>a.minutes-b.minutes).slice(0,3);if(!list.length)return '';
 const [head,...rest]=list,digits=String(head.minutes).padStart(2,'0').slice(-2).split('');
 return `<section class="flap-board tt-flap"><div class="flap-top"><span>${t('flapLabel')}</span><small>TAGO</small></div><div class="flap-main">${busFace(head.no,e,t)}<b class="flap-about">${t('flapAbout')}</b>${digits.map(d=>`<span class="flap-digit">${e(d)}</span>`).join('')}<b class="flap-unit">${t('flapUnit')}</b></div>${rest.map(a=>`<div class="flap-row"><span>${busFace(a.no,e,t)}</span><b>${t('arrive',{n:a.minutes})}</b></div>`).join('')}</section>`;
}
const pickerMarkup=({mine,current,nearby,query,hits},e,t)=>`<div class="tt-picker"><div class="tt-chips"><button class="tt-chip locate" data-tt-locate="1">${t('ttNearMe')}</button>${mine.map(s=>`<button class="tt-chip ${current?.id===s.id?'on':''}" data-tt-pick="${e(s.id)}">${art('board/my-stop-token',18)}${e(s.name)}</button>`).join('')}${nearby.map(s=>`<button class="tt-chip ${current?.id===s.id?'on':''}" data-tt-pick="${e(s.id)}">${e(s.name)} <small>${s.distanceMeters}m</small></button>`).join('')}</div><input id="tt-stop-q" autocomplete="off" maxlength="40" value="${e(query||'')}" placeholder="${t('ttStopSearch')}"><div id="tt-stop-list">${stopList(hits||[],e)}</div></div>`;
function currentStop(stop,board,saved,e,t){if(!stop)return '';const across=(board?.partners||[]).slice(0,2);return `<div class="tt-current"><div><small>${t('ttFromStop')}</small><strong>${e(stop.name)}</strong></div><button class="tt-fav ${saved?'is-saved':''}" data-action="save-stop" aria-pressed="${saved}" aria-label="${t(saved?'unsaveStop':'saveStop')}">${icon('star')}</button><button data-tt-change="1">${t('ttChangeStop')}</button></div>${across.map(p=>`<button class="tt-across" data-tt-pick-partner="${e(p.id)}">${t('ttAcross',{stop:e(p.name)})}</button>`).join('')}`;}
function tripRow(o,board,by,e,t){const row=board?.rows.find(r=>r.no===o.no),live=row?.arrivals[0],word=o.today==='off'?'rowOff':o.today==='ended'?'rowEnded':null;
 return `<article class="tt-trip-row ${word?'dim':''}">${busFace(o.no,e,t)}<div class="tt-trip-main"><strong>${live?t('arrive',{n:live.minutes}):word?t(word):t(o.today==='before'?'ttBeforeFirst':o.today==='running'?'rowRunning':'boardUnknownShort')}</strong><small>${o.sure?'':`${t('boardLoop')} · `}${o.last?t('ttLastHere',{time:e(o.last)}):t('ttNoLast')}</small>${o.ticket?`<p class="tt-trip-ticket">${t('ttTicketLine',{board:e(o.ticket.board),off:e(o.ticket.off)})}</p>`:by?`<p class="tt-trip-none">${t(o.ticketReason||'ttNoTicket')}</p>`:''}</div><button data-tt-plan="${e(o.no)}">${t('boardSchedule')}</button></article>`;}
const rank=o=>o.today==='off'||o.today==='ended'?1:0;
function tripResult(trip,board,by,e,t){if(!trip)return '';
 if(trip.error)return `<p class="tt-done">${t('sideNoPlace')}</p>`;
 if(trip.verdict==='same')return `<p class="tt-done">${t('sideSame')}</p>`;
 const across=trip.acrossStop?`<button class="tt-across" data-tt-across="1">${t('sideOpenAcross',{stop:e(trip.acrossStop.name)})}</button>`:'';
 const jump=`<button class="tt-journey" data-tt-journey="1">${t('ttJourney')}</button>`;
 if(!trip.options.length)return `<div class="tt-empty">${art('scene/plan-b',96,'art-deco')}<p>${t(trip.across?.length?'sideAcross':'ttNoDirect')}</p>${across}${jump}</div>`;
 return `<h3 class="tt-section">${t('ttDirect',{to:e(trip.to),n:trip.options.length})}</h3>${[...trip.options].sort((a,b)=>rank(a)-rank(b)).map(o=>tripRow(o,board,by,e,t)).join('')}${across}${jump}<p class="tt-note">${t('ttTripBasis')}</p>`;}
export function timetableBoardMarkup({mode,query,numbers,recent,favorites,stop,board,mine,nearby,picking,stopQuery,hits,to,by,trip,inline,live},e,t){
 const tabs=`<div class="tt-base" role="tablist">${[['route','tt-route'],['stop','tt-stop'],['place','tt-place']].map(([id,key])=>`<button role="tab" aria-selected="${mode===id}" class="${mode===id?'active':''}" data-tt-base="${id}"><b>${t(`ttBase_${id}`)}</b><small>${t(`ttBaseHelp_${id}`)}</small></button>`).join('')}</div>`;
 const picker=pickerMarkup({mine,current:stop,nearby,query:stopQuery,hits},e,t),saved=!!stop&&mine.some(s=>s.id===stop.id);
 let body='';
 if(mode==='route'){const quick=[...new Set([...recent,...favorites])].slice(0,8);body=`<input id="tt-no" class="tt-input" inputmode="text" autocomplete="off" maxlength="8" value="${e(query||'')}" placeholder="${t('ttNoSearch')}"><div id="tt-no-list">${numberGrid(filterNumbers(numbers,query),e,t)}</div>${quick.length&&!query?`<h3 class="tt-section">${t('ttRecent')}</h3>${numberGrid(quick,e,t)}`:''}<div id="tt-inline" class="tt-inline">${inline?'':`<div class="tt-empty">${art('scene/search-start',96,'art-deco')}<p>${t('ttRouteHelp')}</p></div>`}</div>`;}
 if(mode==='stop')body=`${stop&&!picking?currentStop(stop,board,saved,e,t):picker}${stop&&!picking?`${upcomingMarkup(board,e,t)}<div id="live-content">${live}</div>`:!stop?`<div class="tt-empty">${art('scene/home-empty',96,'art-deco')}<p>${t('ttStopHelp')}</p></div>`:''}`;
 if(mode==='place')body=`${stop&&!picking?currentStop(stop,board,saved,e,t):picker}<form id="tt-place-form" class="tt-place"><label>${t('ttWhere')}<input id="tt-to-q" autocomplete="off" maxlength="40" value="${e(to||'')}" placeholder="${t('sidePlaceholder')}" list="tt-to-list"></label><datalist id="tt-to-list"></datalist><div class="tt-chips">${TT_PLACES.map(p=>`<button type="button" class="tt-chip ${to===p?'on':''}" data-tt-to="${e(p)}">${e(p)}</button>`).join('')}</div><label>${t('ttArriveBy')}<input id="tt-by" type="time" value="${e(by||'')}"></label><button class="tt-go" type="submit">${t('ttFind')}</button></form><div id="tt-trip-result">${stop?tripResult(trip,board,by,e,t):`<p class="tt-note">${t('ttPlaceHelp')}</p>`}</div>`;
 return `<div class="today-board tt-board"><span class="eyebrow">TIMETABLE</span><h2>${t('ttMenu')}</h2>${tabs}${body}</div>`;
}
export {tripResult};
