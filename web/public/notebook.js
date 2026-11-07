// 미션 화면 「제주 버스 탐험 수첩」. 데이터는 quest.js(미션·귤·카드)와 game.js(탔어요 도장)를 그대로 쓰고 배치만 맡는다.
import {CARDS,SKINS,TEAMS,WEEKLY,levelOf,regionShare,todayMissions,weekStats} from './quest.js';
import {REGIONS,stampsOf} from './game.js';
import {dayOf} from './trips.js';
import {ART_V} from './art.js';

const KST=9*3600000;
const pic=(path,width,cls='',alt='')=>`<img class="art ${cls}" src="/art/${path}.webp?v=${ART_V}" width="${width}" alt="${alt}" loading="lazy" decoding="async">`;
// 지도 위 장소 핀(가로·세로 비율). 대표 정류장 좌표를 지도 투영식(output/explorer-notebook/sources/map/projection.json)으로 바꾼 값이다.
// 제주시 한가운데 네 곳은 서로 겹치지 않게 조금씩 벌려 놓았다.
export const PLACES={
 airport:[.372,.180,'제주국제공항'],terminal:[.468,.165,'제주버스터미널'],cityhall:[.505,.285,'제주시청'],market:[.385,.305,'제주민속오일장'],
 hamdeok:[.619,.155,'함덕해수욕장'],seogwipo:[.502,.803,'서귀포항'],jungmun:[.346,.796,'중문 주상절리'],gimnyeong:[.721,.123,'김녕해수욕장'],
 seongsan:[.917,.321,'성산일출봉'],pyoseon:[.803,.619,'표선'],namwon:[.678,.715,'남원'],moseulpo:[.158,.865,'모슬포 운진항'],
 hallim:[.165,.428,'한림'],aewol:[.227,.319,'애월'],seongpanak:[.565,.492,'성판악'],eoseungsaeng:[.388,.550,'1100고지'],
};
const RARITY={common:'nbCommon',rare:'nbRare',legend:'nbLegend'};
const NOTEBOOK_STAMPS=['first-ride','new-route','new-stop','first-bus','sunset','last-bus','four-way'];
const band=level=>level<=3?1:level<=6?2:3;
const date=(at,locale)=>new Date(at).toLocaleDateString(locale,{month:'numeric',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});
const bar=(pct,cls='')=>`<span class="nb-bar ${cls}"><i style="width:${Math.max(0,Math.min(100,pct))}%"></i></span>`;

function certificate({q,lv,span,guest,open},e,t){
 const tt=t;
 return `<header class="nb-cert ${open?'open':''}">
 <div class="nb-cert-row"><button class="nb-cert-main" data-q-cert aria-expanded="${open}">${pic(`quest/mascot-face-${band(lv.level)}`,52,'nb-face')}<span class="nb-id"><small>Lv.${lv.level} · ${tt('nbExplorer')}</small><strong>${tt(`qLv${lv.level}`)}</strong>${bar(span)}</span></button>
 <span class="nb-purse"><b>${tt('nbCoins',{n:q.coins})}</b></span>
 <button class="nb-bonus" data-q-spin="1" ${q.tickets?'':'disabled'} aria-label="${tt('qTickets',{n:q.tickets})}">${pic('quest/ticket-bonus',44)}<b>${q.tickets}</b></button></div>
 ${guest?`<button class="nb-keep" data-action="login">${tt('nbKeep')}</button>`:''}
 ${open?`<div class="nb-cert-more">
  <h4>${tt('nbRanks')}<small>${lv.to?tt('qNext',{n:lv.to-q.xp}):tt('qMax')}</small></h4>
  <ol class="nb-ranks">${[1,2,3,4,5,6,7,8,9].map(i=>`<li class="${i<=lv.level?'on':''} ${i===lv.level?'now':''}">${pic(`quest/rank-${i}`,48)}<span>${tt(`qLv${i}`)}</span></li>`).join('')}</ol>
  <h4>${tt('nbCovers')}</h4>
  <div class="nb-covers">${SKINS.map(([id,price])=>{const own=q.owned.includes(id),on=q.skin===id;return `<button data-q-skin="${id}" data-q-price="${price}" class="${on?'on':''}" ${!own&&q.coins<price?'disabled':''}>${pic(`quest/cover-${id}`,64)}<span>${tt(`qSkin_${id}`)}</span><small>${on?tt('qOn'):own?tt('qUse'):tt('nbCoins',{n:price})}</small></button>`;}).join('')}</div>
  <button class="nb-rules" data-q-rules="1">ⓘ ${tt('nbRules')}</button>
 </div>`:''}
 </header>`;
}

function todayPage({q,legs,board,now},e,t){
 const day=dayOf(now),s=weekStats(legs,now),tt=board?.teams||{},max=Math.max(1,...TEAMS.map(x=>tt[x]||0));
 const trips=todayMissions(day).map(([id,reward])=>{const done=q.done[`${day}:${id}`];return `<li class="nb-trip ${done?'done':''}">${pic(`quest/trip-${id}`,64,'nb-trip-art')}<div><strong>${t(`qm_${id}`)}</strong><small>${t('nbCoins',{n:reward})}</small></div><span class="nb-punch" aria-label="${done?t('nbDone'):''}">${done?pic('quest/punch',46):''}</span></li>`;}).join('');
 const goals=WEEKLY.map(([id,reward,goal])=>{const v={wRides:s.rides,wRoutes:s.routes,wDays:s.days,wStops:s.stops}[id];return {id,reward,goal,v:Math.min(v,goal),done:v>=goal};});
 // 버스는 마지막으로 달성한 정류장 위에 선다(아직 없으면 출발점).
 const reached=goals.filter(g=>g.done).length,pos=reached?(reached-.5)/goals.length*100:0;
 return `<h3 class="nb-head">${t('nbTrips')}<small>${t('nbSame')}</small></h3>
 <ul class="nb-trips">${trips}</ul>
 ${q.tickets?`<button class="nb-bonus-row" data-q-spin="1">${pic('quest/ticket-bonus',52)}<span>${t('nbBonus',{n:q.tickets})}</span></button>`:''}
 <h3 class="nb-head">${t('nbRoute')}<small>${reached}/${goals.length}</small></h3>
 <div class="nb-route"><div class="nb-line"><i style="width:${pos}%"></i><img class="art nb-bus" src="/art/quest/bus-side.webp?v=${ART_V}" width="52" alt="" style="left:max(26px,${pos}%)">${pic('quest/route-goal',40,'nb-goal')}</div>
 <ol>${goals.map(g=>`<li class="${g.done?'on':''}">${pic(`quest/route-stop-${g.done?'on':'off'}`,28)}<strong>${t(`qm_${g.id}`,{n:g.goal})}</strong><small>${g.v}/${g.goal} · ${t('nbCoins',{n:g.reward})}</small></li>`).join('')}</ol></div>
 <h3 class="nb-head">${t('nbUnion')}</h3>
 ${q.team?`<div class="nb-unions">${TEAMS.map(x=>`<div class="${q.team===x?'mine':''}">${pic(`quest/union-${x}`,30)}<span>${t(`qTeam_${x}`)}</span>${bar((tt[x]||0)/max*100,`u-${x}`)}<small>${tt[x]||0}</small></div>`).join('')}</div>`
 :`<p class="nb-muted">${t('qPickTeam')}</p><div class="nb-pick">${TEAMS.map(x=>`<button data-q-team="${x}">${pic(`quest/union-${x}`,56)}<span>${t(`qTeam_${x}`)}</span></button>`).join('')}</div>`}`;
}

function mapPage({q,totals},e,t){
 const share=regionShare(q.stops,totals),stops=Object.keys(q.stops).length,lit=REGIONS.filter(r=>share[r].n>0),got=new Set(q.cards);
 const layers=REGIONS.map(r=>share[r].n?`<img class="nb-layer" src="/art/map/explore-${r}.webp?v=${ART_V}" alt="" style="opacity:${Math.min(1,.75+share[r].pct/20).toFixed(2)}">`:'').join('');
 const pins=CARDS.map(c=>{const p=PLACES[c.id];if(!p)return '';const on=got.has(c.id);return `<button class="nb-pin ${on?'on':''} r-${c.rarity}" style="left:${p[0]*100}%;top:${p[1]*100}%" data-q-place="${c.id}" aria-label="${e(p[2])}${on?'':` · ${t('nbLocked')}`}">${on?pic(`quest/place-${c.id}`,34):''}<span>${e(c.name)}</span></button>`;}).join('');
 return `<div class="nb-map" role="group" aria-label="${t('nbMap')}"><img class="nb-base" src="/art/map/explore-base.webp?v=${ART_V}" alt="" width="1600" height="1000">${layers}${pins}</div>
 <p class="nb-cap">${t('nbMapCap',{stops,places:got.size,total:CARDS.length,regions:lit.length})}</p>
 ${stops?'':`<div class="nb-map-empty">${pic('quest/mascot-map',96)}<p>${t('nbMapEmpty')}</p></div>`}<div class="nb-regions">${['north','east','south','west'].map(r=>`<span class="${share[r].n?'on':''} g-${r}">${t(`region_${r}`)} <b>${share[r].n}</b></span>`).join('')}</div>`;
}

function bookPage({legs,now,rides,game,locale},e,t){
 const s=weekStats(legs,now),ended=legs.filter(l=>l.offAt).sort((a,b)=>b.at-a.at).slice(0,12);
 const stamps=stampsOf(rides).filter(x=>NOTEBOOK_STAMPS.includes(x.id));
 let last='';
 const log=ended.map(l=>{const d=date(l.at+0*KST,locale),head=d!==last?`<li class="nb-day">${e(d)}</li>`:'';last=d;const min=Math.max(1,Math.round((l.offAt-l.at)/60000));return `${head}<li class="nb-stub"><b>${e(l.no)}</b><span>${e(l.stopName||'')} → ${e(l.offName||'')}</span><small>${t('nbMinutes',{n:min})}</small></li>`;}).join('');
 return `<div class="nb-stats"><div><b>${s.rides}</b><small>${t('nbRides')}</small></div><div><b>${s.routes}</b><small>${t('nbRoutes')}</small></div><div><b>${s.stops}</b><small>${t('nbStops')}</small></div></div>
 <h3 class="nb-head">${t('nbStamps')}<small>${stamps.filter(x=>x.earned).length}/${stamps.length}</small></h3>
 ${game?`<div class="nb-stamps">${stamps.map(x=>`<figure class="${x.earned?'on':''}">${pic(`stamp/${x.id}`,72)}<figcaption>${t(`stamp_${x.id.replaceAll('-','_')}`)}</figcaption></figure>`).join('')}</div>
 <div class="nb-actions"><button data-action="game-share" ${rides.length?'':'disabled'}>${t('gameShare')}</button><button data-action="game-off">${t('gameOff')}</button>${rides.length?`<button data-action="game-clear">${t('gameClear')}</button>`:''}</div>`
 :`<div class="nb-off"><p>${t('nbStampsOff')}</p><button data-action="game-on">${t('gameOn')}</button></div>`}
 <h3 class="nb-head">${t('nbLog')}</h3>
 ${log?`<ol class="nb-log">${log}</ol>`:`<div class="nb-empty">${pic('quest/mascot-sleep',110)}<p>${t('nbLogEmpty')}</p></div>`}
 <p class="nb-muted">${t('nbPrivacy')}</p>`;
}

export function notebookMarkup({quest:q,legs,board,totals,now=Date.now(),guest=false,tab='today',cert=false,rides=[],game=false,locale='ko'},e,t){
 const lv=levelOf(q.xp),span=lv.to?Math.round((q.xp-lv.from)/(lv.to-lv.from)*100):100;
 const page=tab==='map'?mapPage({q,totals},e,t):tab==='book'?bookPage({legs,now,rides,game,locale},e,t):todayPage({q,legs,board,now},e,t);
 return `<section class="notebook">${certificate({q,lv,span,guest,open:cert},e,t)}
 <nav class="nb-tabs" role="tablist">${['today','map','book'].map(id=>`<button role="tab" data-q-tab="${id}" aria-selected="${tab===id}" class="${tab===id?'on':''}">${t(`nbTab_${id}`)}</button>`).join('')}</nav>
 <div class="nb-page nb-p-${tab}">${page}</div></section>`;
}

// 장소 핀을 눌렀을 때의 카드
export function placeSheet(id,got,e,t){
 const c=CARDS.find(x=>x.id===id),p=PLACES[id];if(!c||!p)return '';
 return `<div class="form-modal nb-place r-${c.rarity} ${got?'on':''}">${pic(`quest/place-${id}`,180,'nb-place-art')}<span class="nb-rarity">${t(RARITY[c.rarity])}</span><h2>${e(c.name)}</h2><p>${got?t('nbPlaceGot',{place:e(p[2])}):t('nbPlaceHow',{place:e(p[2])})}</p><button class="tt-go" data-action="close">${t('qGoOn')}</button></div>`;
}
export const rulesSheet=t=>`<div class="form-modal nb-rules-sheet">${pic('quest/mascot-explorer',120)}<h2>${t('nbRules')}</h2><p>${t('qRules')}</p><button class="tt-go" data-action="close">${t('qGoOn')}</button></div>`;
