// 관광노선: 출발지(내 위치·고른 정류장)에서 주요 관광지까지 어느 정류장에서 몇 번을 타는지 카드로 보여 준다.
// 정렬: 금방 타는 순(지금 도착 정보) · 가까운 순 · 주제별(바다·오름·숲·시장·명소)
import {chip} from './board.js';
import {icon} from './icons.js';

export const THEMES=['sea','oreum','town'];
export const THEME_ICON={sea:'🌊',oreum:'⛰️',town:'🏮'};
const km=m=>m==null?'':m<1000?`${m}m`:`${(m/1000).toFixed(m<10000?1:0)}km`;

// 탈 정류장의 지금 도착(분). 모르면 undefined, 도착 정보가 없으면 null
export function soonOf(spot,boards){
 const trip=spot.trips?.[0];if(!trip)return undefined;
 const board=boards[trip.board.id];if(!board)return undefined;
 const rows=(board.rows||[]).filter(r=>spot.trips.some(x=>x.no===r.no&&x.board.id===trip.board.id)&&r.arrivals?.length);
 const best=rows.map(r=>({no:r.no,minutes:r.arrivals[0].minutes})).sort((a,b)=>a.minutes-b.minutes)[0];
 return best||null;
}

export function sortSpots(spots,{sort='soon',theme='all',boards={}}={}){
 const list=(spots||[]).filter(s=>theme==='all'||s.theme===theme);
 const dist=s=>s.distance??Infinity,has=s=>s.trips?.length?0:1;
 if(sort==='near')return [...list].sort((a,b)=>dist(a)-dist(b));
 if(sort==='theme')return [...list].sort((a,b)=>THEMES.indexOf(a.theme)-THEMES.indexOf(b.theme)||has(a)-has(b)||dist(a)-dist(b));
 const min=s=>{const x=soonOf(s,boards);return x?.minutes??Infinity;};
 return [...list].sort((a,b)=>has(a)-has(b)||min(a)-min(b)||dist(a)-dist(b));
}

// 같은 정류장에서 타는 곳이 여럿이면 가까운 6곳만 도착을 부른다(도착 API 호출을 줄인다).
export function boardsToLoad(spots,limit=6){
 const seen=new Map();
 for(const s of spots||[])for(const tr of s.trips||[])if(!seen.has(tr.board.id)||seen.get(tr.board.id).walk>tr.board.walk)seen.set(tr.board.id,tr.board);
 return [...seen.values()].sort((a,b)=>a.walk-b.walk).slice(0,limit);
}

export const tourHits=(hits,e,t)=>(hits||[]).map(s=>`<li><button data-tour-hit="${e(s.id)}"><strong>${e(s.name)}</strong>${s.next?`<small>${t('ctxToward',{next:e(s.next)})}</small>`:''}</button></li>`).join('');
function fromMarkup(tour,home,mine,e,t){
 const f=tour.from,label=!f?t('tourPick'):f.kind==='me'?`📍 ${t('tourMe')}`:`🚏 ${e(f.name)}`;
 const quick=[`<button data-tour-from="me">📍 ${t('tourMe')}</button>`,...(home?[`<button data-tour-from="stop:${e(home.id)}">🏠 ${e(home.name)}</button>`]:[]),...mine.filter(s=>s.id!==home?.id).slice(0,4).map(s=>`<button data-tour-from="stop:${e(s.id)}">⭐ ${e(s.name)}</button>`)];
 return `<div class="tr-from ${tour.picking?'open':''}"><div class="tr-from-row"><span>${t('tourFrom')}</span><strong>${label}</strong><button data-action="tour-pick">${t(tour.picking?'close':'tourChange')}</button></div>${tour.picking?`<div class="tr-pick"><div class="tr-quick">${quick.join('')}</div><input id="tour-from-input" type="search" autocomplete="off" placeholder="${t('tourSearchPh')}" value="${e(tour.q||'')}"><ul class="tr-hits">${tourHits(tour.hits,e,t)}</ul></div>`:''}</div>`;
}

function tripMarkup(s,boards,e,t){
 if(!s.trips?.length)return `<p class="tr-none">${t('tourNone')}</p>`;
 const soon=soonOf(s,boards),a=s.trips.find(x=>x.no===soon?.no)||s.trips[0],other=s.trips.find(x=>x!==a);
 return `<ol class="tr-steps"><li><b>${t('tourBoard')}</b><span>${e(a.board.name)}<small>${t('tourWalk',{m:a.board.walk})}</small></span></li><li class="tr-bus"><b>${t('tourRide')}</b><span>${chip(a.no,e,t)}<small>${t('tourStops',{n:a.stops})}</small>${other?`<small>${t('tourOr',{no:e(other.no)})}</small>`:''}</span></li><li><b>${t('tourOff')}</b><span>${e(a.off.name)}${a.off.walk>150?`<small>${t('tourWalk',{m:a.off.walk})}</small>`:''}</span></li></ol>`;
}

function cardMarkup(s,boards,focus,e,t){
 const soon=soonOf(s,boards);
 const badge=soon?`<span class="tr-soon"><b>${soon.minutes}</b>${t('hbMin')}</span>`:soon===null?`<span class="tr-soon tr-soon-off">${t('tourNoArrival')}</span>`:'';
 return `<article class="tr-card tr-${s.theme} ${focus===s.id?'focus':''}" id="tour-${e(s.id)}"><div class="tr-card-top"><i aria-hidden="true">${THEME_ICON[s.theme]}</i><div><h3>${t(`hbSpot_${s.id}`)}</h3><small>${t(`tourTheme_${s.theme}`)}${s.distance!=null?` · ${km(s.distance)}`:''}</small></div>${badge}</div>${s.distance==null?`<p class="tr-none">${t('tourNoFrom')}</p>`:tripMarkup(s,boards,e,t)}${s.note==='ferry'?`<p class="tr-note">⛴ ${t('tourFerry')}</p>`:''}<div class="tr-act"><button data-tour-map="${e(s.id)}">${icon('map')}${t('tourMap')}</button><button data-tour-go="${e(s.id)}">${icon('search')}${t('tourGo')}</button></div></article>`;
}

export function tourMarkup({tour,home=null,mine=[]},e,t){
 const sort=tour.sort||'soon',theme=tour.theme||'all',list=sortSpots(tour.spots,{sort,theme,boards:tour.boards||{}});
 const sorts=['soon','near','theme'].map(k=>`<button class="${sort===k?'on':''}" data-tour-sort="${k}">${t(`tourSort_${k}`)}</button>`).join('');
 const themes=['all',...THEMES].map(k=>`<button class="${theme===k?'on':''}" data-tour-theme="${k}">${k==='all'?t('tourAll'):`${THEME_ICON[k]} ${t(`tourTheme_${k}`)}`}</button>`).join('');
 let cards='';
 if(!tour.spots)cards=`<p class="muted tr-wait">${t(tour.locating?'tourLocating':'loading')}</p>`;
 else if(sort==='theme'&&theme==='all')cards=THEMES.map(th=>{const group=list.filter(s=>s.theme===th);return group.length?`<h3 class="tr-group">${THEME_ICON[th]} ${t(`tourTheme_${th}`)}</h3>${group.map(s=>cardMarkup(s,tour.boards||{},tour.focus,e,t)).join('')}`:'';}).join('');
 else cards=list.map(s=>cardMarkup(s,tour.boards||{},tour.focus,e,t)).join('');
 return `<div class="today-board tour-board"><header class="tr-head"><span class="eyebrow">JEJU BUS TOUR</span><h2>${t('tourTitle')}</h2><p>${t('tourSub')}</p></header>${fromMarkup(tour,home,mine,e,t)}${tour.error?`<p class="tr-error">${t(tour.error)}</p>`:''}<div class="tr-sorts">${sorts}</div><div class="tr-themes">${themes}</div><div class="tr-cards">${cards}</div><p class="tr-foot">${t('tourFoot')}</p></div>`;
}
