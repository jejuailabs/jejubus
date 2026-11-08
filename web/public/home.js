// 내 보드: 앱을 열면 "지금 탈 버스"부터 보이게 한다.
// 순서: 인사 → 지금 탈 버스 → 즐겨찾기 줄 → 자주 가는 경로 → 최근 검색 → 최근 탄 버스 → 내 정류장 도착판
// 자주 타는 버스·경로는 탄 기록으로 기기 안에서 계산한다(home-data.js).
import {busFace} from './board.js';
import {icon} from './icons.js';
import {art} from './art.js';
import {RECENT_SHOW,dayType,frequentRoutes,partOf,pickHero,recentRides,weekdayOf} from './home-data.js';

const arrivalOf=(board,no)=>{if(!board)return undefined;const rows=(board.rows||[]).filter(r=>r.arrivals?.length);if(no){const r=rows.find(x=>x.no===no);return r?{no,...r.arrivals[0],next:r.direction?.next||''}:null;}const r=rows.map(x=>({no:x.no,...x.arrivals[0],next:x.direction?.next||''})).sort((a,b)=>a.minutes-b.minutes)[0];return r||null;};
const clock=(at,locale)=>new Date(at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
const kstDay=at=>new Date(at+32400000).toISOString().slice(0,10);
function whenLabel(at,now,locale,t){const d=kstDay(at),today=kstDay(now),yday=kstDay(now-86400000);return d===today?t('hbToday',{time:clock(at,locale)}):d===yday?t('hbYesterday',{time:clock(at,locale)}):`${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`;}
export const POPULAR=['airport','dongmun','hamdeok','seongsan','jungmun'];
export const POPULAR_QUERY={airport:'제주국제공항',dongmun:'동문시장',hamdeok:'함덕해수욕장',seongsan:'성산일출봉',jungmun:'중문관광단지'};

function greetMarkup(now,alerts,t){
 const part=partOf(now),wd=dayType(now)==='weekday',mood=wd&&part==='morning'?'hbMood_am':wd&&part==='evening'?'hbMood_pm':'';
 return `<header class="hb-greet"><div><h2>${t('hbGreet',{day:t(`hbDay_${weekdayOf(now)}`),part:t(`hbPart_${part}`)})}</h2>${mood?`<p>${t(mood)}</p>`:''}</div>${alerts?`<button class="hb-alert" data-view="today">${icon('info')}${t('homeAlerts',{n:alerts})}</button>`:''}</header>`;
}

function heroMarkup(hero,boards,riding,e,t){
 const board=boards[hero.stopId],a=arrivalOf(board,hero.no),no=hero.no||a?.no||'';
 const why=t(hero.reason==='wait'?'hbWhyWait':hero.reason==='usual'?(hero.day==='weekend'?'hbWhyUsualEnd':'hbWhyUsual'):'hbWhyHome');
 const time=a===undefined?`<p class="hb-min-wait">${t('loading')}</p>`:a?`<strong class="hb-min">${a.minutes}<small>${t('hbMin')}</small></strong>`:`<p class="hb-min-wait">${t('boardNoArrivals')}</p>`;
 return `<section class="hb-hero" aria-label="${t('hbHero')}"><span class="hb-why">${why}</span><div class="hb-hero-main">${no?busFace(no,e,t,'hb-face'):''}${time}</div><p class="hb-hero-stop">${e(hero.stopName||'')}${a?.next?` <span>→ ${e(a.next)}</span>`:''}</p>${a?.remainingStops!=null?`<small class="hb-hero-left">${t('hbStopsLeft',{n:a.remainingStops})}</small>`:''}<div class="hb-hero-act">${no&&!riding?`<button class="hb-rode" data-hb-rode="${e(no)}" data-hb-at="${e(hero.stopId)}" data-hb-min="${a?.minutes??99}">${t('hbRode')}</button>`:''}<button data-hb-stop="${e(hero.stopId)}">${t('hbBoard')}</button></div></section>`;
}

function favStrip({stops,favorites,places},e,t){
 const items=[...favorites.map(r=>`<button class="hb-fav" data-fav-bus="${e(r.id)}" aria-label="${t('liveMap')} ${e(r.number)}">${busFace(r.number,e,t)}</button>`),...stops.map(s=>`<button class="hb-fav hb-fav-stop" data-hb-stop="${e(s.id)}">${art('board/my-stop-token',22)}<span>${e(s.name)}</span></button>`),...places.map(p=>`<button class="hb-fav hb-fav-place" data-fav-place="${e(p.id)}">${icon('pin')}<span>${e(p.name)}</span></button>`)];
 const add=items.length?`<button class="hb-fav hb-fav-add" data-action="fav-open">${icon('plus')}<span>${t('favAdd')}</span></button>`:['hbAddBus','hbAddStop','hbAddPlace'].map(k=>`<button class="hb-fav hb-fav-add" data-action="fav-open">${icon('plus')}<span>${t(k)}</span></button>`).join('');
 return `<section class="hb-sec"><h3>${t('favTitle')}</h3><div class="hb-strip">${items.join('')}${add}</div></section>`;
}

function routesMarkup(routes,boards,e,t){
 if(!routes.length)return '';
 return `<section class="hb-sec"><h3>${t('hbRoutes')}</h3><div class="hb-routes">${routes.map((r,i)=>{const a=arrivalOf(boards[r.stopId],r.no);return `<button class="hb-route" data-hb-route="${i}">${busFace(r.no,e,t)}<span class="hb-route-text"><strong>${e(r.stopName)} → ${e(r.offName)}</strong><small>${t('hbRouteCount',{n:r.count})} · ${t(`hbDayT_${r.day}`)} ${t(`hbPart_${r.part}`)}</small></span><span class="hb-route-min">${a?`<b>${a.minutes}</b>${t('hbMin')}`:a===null?'—':''}</span></button>`;}).join('')}</div></section>`;
}

const KIND_ICON={route:'🚌',stop:'🚏',place:'📍',path:'🔍'};
const recentLabel=(r,e)=>r.kind==='path'?`${e(r.from?.name||'')} → ${e(r.to?.name||'')}`:e(r.name||'');
function recentMarkup(list,e,t){
 if(!list.length)return '';
 return `<section class="hb-sec"><div class="hb-sec-head"><h3>${t('hbRecent')}</h3><button data-action="hb-recent-clear">${t('hbClear')}</button></div><div class="hb-chips">${list.slice(0,RECENT_SHOW).map(r=>`<span class="hb-chip"><button data-hb-recent="${e(r.key)}"><i aria-hidden="true">${KIND_ICON[r.kind]||'🔍'}</i>${recentLabel(r,e)}</button><button class="hb-chip-x" data-hb-recent-drop="${e(r.key)}" aria-label="${t('hbDrop')}">×</button></span>`).join('')}</div></section>`;
}

function ridesMarkup(rides,now,locale,e,t){
 if(!rides.length)return '';
 return `<section class="hb-sec"><div class="hb-sec-head"><h3>${t('hbRides')}</h3><button data-hb-log="1">${t('hbAllLog')}</button></div><ul class="hb-tickets">${rides.map((l,i)=>`<li class="hb-ticket">${busFace(l.no,e,t)}<span class="hb-tk-text"><strong>${e(l.stopName||'')}${l.offName?` → ${e(l.offName)}`:''}</strong><small>${whenLabel(l.at,now,locale,t)}</small></span><button data-hb-again="${i}">${t('hbAgain')}</button></li>`).join('')}</ul></section>`;
}

function stopLines(stops,boards,e,t){
 if(!stops.length)return '';
 return `<section class="hb-sec"><h3>${t('hbStops')}</h3>${stops.map(s=>{const b=boards[s.id],rows=(b?.rows||[]).filter(r=>r.arrivals?.length).map(r=>({no:r.no,m:r.arrivals[0].minutes})).sort((x,y)=>x.m-y.m).slice(0,3);return `<button class="hb-stopline" data-hb-stop="${e(s.id)}"><strong>${e(s.name)}</strong><span>${!b?t('loading'):rows.length?rows.map(r=>`<b>${e(r.no)}</b> ${t('arrive',{n:r.m})}`).join(' · '):t('boardNoArrivals')}</span></button>`;}).join('')}</section>`;
}

function starterMarkup(e,t,full){
 return `<section class="hb-start">${full?art('scene/home-empty',120):''}<p>${t(full?'hbStartLead':'hbFindLead')}</p><div class="hb-start-act"><button data-action="home-nearby">${icon('pin')}${t('homeNearby')}</button><button data-action="hb-find">${icon('search')}${t('hbFindPlace')}</button></div>${full?`<h3>${t('hbPopular')}</h3><div class="hb-chips">${POPULAR.map(k=>`<span class="hb-chip"><button data-hb-query="${k}"><i aria-hidden="true">📍</i>${t(`hbPop_${k}`)}</button></span>`).join('')}</div><small class="hb-start-note">${t('hbStartNote')}</small>`:''}</section>`;
}

export function homeMarkup({stops=[],boards={},favorites=[],places=[],alerts=0,homeStop=null,notice='',guest=false,legs=[],recent=[],wait=null,riding=false,locale='ko',now=Date.now()},e,t){
 const hero=pickHero({wait,legs,homeStop,now}),routes=frequentRoutes(legs,now),rides=recentRides(legs);
 const lineStops=[...(homeStop?.id?[homeStop]:[]),...stops.filter(s=>s.id!==homeStop?.id)];
 const fresh=!legs.length&&!favorites.length&&!places.length&&!stops.length&&!recent.length&&!homeStop;
 return `<div class="today-board home-board hb">${greetMarkup(now,alerts,t)}${notice}${hero?heroMarkup(hero,boards,riding,e,t):starterMarkup(e,t,fresh)}${favStrip({stops,favorites,places},e,t)}${routesMarkup(routes,boards,e,t)}${recentMarkup(recent,e,t)}${ridesMarkup(rides,now,locale,e,t)}${stopLines(lineStops,boards,e,t)}${guest&&legs.length?`<button class="save-login" data-action="login">${t('syncLogin')}</button>`:''}${hero?`<div class="home-actions"><button data-action="home-nearby">${t('homeNearby')}</button><button data-action="hb-find">${t('homeFind')}</button></div>`:''}<div class="home-links"><button data-view="community">${t('community')}</button><button data-view="favorites">${t('qTab')}</button><a href="/privacy">${t('privacyLink')}</a></div></div>`;
}

// 히어로·경로 카드·정류장 줄에 도착 정보를 붙일 정류장들(최대 6곳)
export function homeStopsToLoad({stops=[],homeStop=null,legs=[],wait=null,now=Date.now()}){
 const hero=pickHero({wait,legs,homeStop,now}),ids=new Map();
 const add=(id,name)=>{if(id&&!ids.has(id))ids.set(id,{id,name});};
 if(hero)add(hero.stopId,hero.stopName);
 for(const r of frequentRoutes(legs,now))add(r.stopId,r.stopName);
 if(homeStop)add(homeStop.id,homeStop.name);
 for(const s of stops)add(s.id,s.name);
 return [...ids.values()].slice(0,6);
}
