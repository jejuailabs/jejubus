import {icon} from './icons.js';
// 커뮤니티 화면 조각: 탭, 지금 대화, 기다리는 버스, 원탭 평가.
export const CTABS=['live','same','ask','suggest','notice'];
export const topQuestion=(q,me,hidden,e,t)=>!q||q.alias===me||hidden===q.id?'':`<div class="top-q"><button class="top-q-main" data-top-q="1"><b>${t('topAsk')}</b><span>${e(q.text)}</span></button><button class="top-q-x" data-top-q-hide="${e(q.id)}" aria-label="${t('close')}">×</button></div>`;
// 실시간 채팅만 늘 보이고, 나머지 탭은 햄버거 메뉴에 담는다. 새로고침·글쓰기도 같은 줄에.
export const ctabsMarkup=(tab,t)=>`<div class="ctabs" role="tablist"><button role="tab" aria-selected="${tab==='live'}" class="ctab-live ${tab==='live'?'active':''}" data-ctab="live"><i class="live-dot" aria-hidden="true"></i>${t('ctab_live')}</button><details class="ctab-menu ${tab!=='live'?'active':''}"><summary aria-label="${t('ctabMenu')}">${icon('menu')}${tab!=='live'?`<span>${t(`ctab_${tab}`)}</span>`:''}</summary><div class="ctab-menu-list">${CTABS.filter(id=>id!=='live').map(id=>`<button role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-ctab="${id}">${t(`ctab_${id}`)}</button>`).join('')}</div></details>${tab==='suggest'?'':`<button class="ctab-suggest" data-ctab="suggest" aria-label="${t('ctab_suggest')}">${icon('sparkles')}<span>${t('suggestPill')}</span></button>`}<span class="ctab-gap"></span><button class="ctab-icon" data-action="compose" aria-label="${t('write')}">${icon('pencil')}</button></div>`;
// 개발자에게 바란다: 불편한 점과 개선 아이디어를 바로 쓰게 하는 안내 카드.
export const suggestIntro=t=>`<section class="suggest-intro"><div><b>${icon('sparkles')}${t('suggestIntroTitle')}</b><p>${t('suggestIntroBody')}</p></div><div class="suggest-intro-actions"><button class="primary" data-suggest-write="pain">${t('suggestWritePain')}</button><button data-suggest-write="idea">${t('suggestWriteIdea')}</button></div></section>`;
const bandLabel=(band,t)=>band?t('roomBand',{n:band}):'';
const when=(at,locale)=>new Date(at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
export const roomPeople=(room,e,t)=>`<strong title="${t('roomOnline',{n:room?.total??0})}">${t('roomOnlineShort',{n:room?.total??0})}</strong><div class="room-people">${room?.botReady?`<span class="room-person bot">${t('roomBot')}</span>`:''}${(room?.people||[]).map(p=>`<span class="room-person">${e(p.alias)}${p.band?` <small>${bandLabel(p.band,t)}</small>`:''}</span>`).join('')}</div>`;
export const roomFeed=(room,me,e,t,locale)=>(room?.messages||[]).length?room.messages.map(m=>`<article class="room-msg ${m.alias===me?'mine':''} ${m.bot?'bot':''}"><header><b>${e(m.alias)}</b>${m.band?`<small>${bandLabel(m.band,t)}</small>`:''}<time>${e(when(m.at,locale))}</time>${m.bot||m.alias===me?'':`<button data-room-report="${e(m.id)}">${t('report')}</button>`}</header><p>${e(m.text)}</p></article>`).join(''):`<p class="room-empty">${t('roomEmpty')}</p>`;
export const waitChip=(wait,t)=>wait?'':`<button class="wait-chip" data-wait-pick="1">${icon('bus')}${t('waitPick')}</button>`;
export function roomMarkup({room,me,radius,located,botMode,wait},e,t,locale){
 return `<section class="room"><div class="room-bar"><label class="room-radius"><span class="sr-only">${t('roomRadius')}</span><select id="room-radius">${[0,1,3,5,10].map(r=>`<option value="${r}" ${radius===r?'selected':''}>${r?`${r}km`:t('roomAll')}</option>`).join('')}</select></label><div id="room-people" class="room-box">${roomPeople(room,e,t)}</div></div>${radius&&!located?`<p class="room-note">${t('roomNeedLocation')}</p>`:''}<div class="room-feed-wrap ${wait===undefined?'':'has-wait'}">${wait===undefined?'':`<div id="wait-float">${wait?waitPill(wait,e,t):waitChip(wait,t)}</div>`}<div id="room-feed" class="room-feed">${roomFeed(room,me,e,t,locale)}</div></div><form id="room-form" class="room-form"><button type="button" class="room-bot ${botMode?'on':''}" data-room-bot="1" aria-pressed="${!!botMode}">${t('roomAskBot')}</button><input id="room-input" maxlength="200" autocomplete="off" placeholder="${t(botMode?'roomBotHint':'roomHint')}"><button type="submit">${t('roomSend')}</button></form></section>`;
}
// 기다리는 버스: 번호, 도착까지, 몇 정류장 전. 값은 TAGO 그대로다.
export function waitPill(wait,e,t){
 if(!wait)return `<button class="wait-pill empty" data-wait-pick="1">${t('waitPick')}</button>`;
 const body=wait.minutes!=null?`<b>${t('arrive',{n:wait.minutes})}</b>${wait.remainingStops!=null?`<small>${t('boardStopsAway',{n:wait.remainingStops})}</small>`:''}`:`<small>${t('waitNoInfo')}</small>`;
 return `<div class="wait-pill"><button class="wait-main" data-wait-open="1"><span class="wait-no">${e(wait.no)}</span>${body}<em>${e(wait.stopName||'')}</em></button>${wait.auto?'':`<button class="wait-x" data-wait-clear="1" aria-label="${t('close')}">×</button>`}</div>`;
}
export function nextFor(board,no){const row=board?.rows?.find(r=>r.no===no);return row?.arrivals?.[0]||null;}
export function soonest(board){return (board?.rows||[]).flatMap(r=>r.arrivals.slice(0,1).map(a=>({no:r.no,...a}))).sort((a,b)=>a.minutes-b.minutes)[0]||null;}
const ROUTE_KUDOS=['ontime','clean','comfy','crowded'],DRIVER_KUDOS=['kind','safe','waited'];
export function kudosMarkup(no,counts,done,e,t){
 const chip=type=>`<button class="kudo ${done.includes(type)?'on':''}" data-kudo="${type}" data-kudo-no="${e(no)}" ${done.includes(type)?'disabled':''}>${t(`kudo_${type}`)}${counts[type]?` <b>${counts[type]}</b>`:''}</button>`;
 return `<div class="kudos"><small>${t('kudoRoute')}</small><div>${ROUTE_KUDOS.map(chip).join('')}</div><small>${t('kudoDriver')}</small><div>${DRIVER_KUDOS.map(chip).join('')}</div></div>`;
}
