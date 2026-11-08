// 타도 돼 카드 화면. 값은 서버가 준 것만 쓰고, 없으면 칸을 숨기거나 "확인되지 않아요"라고 말한다.
import {art} from './art.js';
// 등급은 BIS 노선 분류(앞자리) 기준이다. TAGO routetp는 공식 분류와 달라 쓰지 않는다.
export function gradeOf(no){const n=String(no);if(/^(810|820)(-|$)/.test(n))return 'tour';const d=n[0];if(n.length<3)return 'other';if(d==='1')return 'express';if('235'.includes(d))return 'trunk';if('467'.includes(d))return 'branch';return 'other';}
export const chip=(no,e,t)=>{const g=gradeOf(no);return `<span class="grade-chip grade-${g}" title="${e(t(`grade_${g}`))}"><i aria-hidden="true"></i><b>${e(no)}</b></span>`;};
// 번호판 버스. 번호는 그림이 아니라 글자로 얹어 4개 언어와 모든 번호에 같이 쓴다.
export const busFace=(no,e,t,cls='')=>{const g=gradeOf(no),file=g==='other'?'trunk':g,n=String(no).length;return `<span class="bus-face ${cls} grade-${g} len-${Math.min(5,Math.max(3,n))}" title="${e(t(`grade_${g}`))}"><img src="/art/bus/bus-${file}.webp" width="46" alt="" loading="lazy" decoding="async"><b>${e(no)}</b></span>`;};
const direction=(d,e,t)=>!d?'':d.terminus?`<small class="tado-dir">${t('boardTerminus')}</small>`:`<small class="tado-dir">${t('boardNext',{stop:e(d.next)})} · ${t('boardToward',{stop:e(d.end)})}${d.loop?` · ${t('boardLoop')}`:''}</small>`;
// 목록 한 줄의 짧은 상태. 도착이 있으면 도착, 없으면 시간표 기준 오늘 상태만 말한다.
function shortStatus(r,e,t){const s=r.today,first=r.arrivals[0];
 if(first)return `<strong class="tado-min">${t('arrive',{n:first.minutes})}</strong>${first.remainingStops===null?'':`<small>${t('boardStopsAway',{n:first.remainingStops})}</small>`}`;
 if(s.state==='scheduled')return `<span class="row-state">${s.time?t('rowNext',{time:e(s.time)}):t('rowRunning')}</span>`;
 if(s.state==='beforeFirst')return `<span class="row-state">${t('rowFirst',{time:e(s.time)})}</span>`;
 if(s.state==='ended')return `<span class="row-state off">${t('rowEnded')}</span>`;
 if(s.state==='notToday')return `<span class="row-state off">${t('rowOff')}</span>`;
 if(s.state==='running')return `<span class="row-state">${t('boardRunning')}</span>`;
 if(s.state==='changed')return `<span class="row-state warn">${t('rowChanged')}</span>`;
 return `<span class="row-state muted">${t('boardUnknownShort')}</span>`;}
// 오늘 운행 여부. 시간표를 해석한 값이고, 모르면 모른다고 말한다.
function todayLine(r,e,t,locale){const day=new Intl.DateTimeFormat(locale,{month:'numeric',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date()),p=r.plan,kind=p?.today;
 const word=kind==='off'?'detailOff':kind==='ended'?'detailEnded':kind==='running'||kind==='before'?'detailRuns':'detailUnknown';
 return `<p class="row-today ${kind==='off'||kind==='ended'?'off':kind==='running'||kind==='before'?'on':''}"><b>${e(day)}</b> ${t(word)}</p>`;}
function facts(r,e,t){const p=r.plan;if(!p)return '';const list=[p.next&&[t('factNext'),p.next],p.first&&[t('factFirst'),p.first],p.last&&[t('factLast'),p.lastBase?`${p.last} (${p.lastBase})`:p.last],p.interval&&[t('factGap'),p.interval]].filter(Boolean);
 return list.length?`<dl class="row-facts">${list.map(([k,v])=>`<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`:'';}
function flapBoard(r,e,t){const first=r.arrivals[0],digits=String(first.minutes).padStart(2,'0').slice(-2).split('');
 return `<section class="flap-board" aria-label="${t('arrive',{n:first.minutes})}"><div class="flap-top"><span>${t('flapLabel')}</span><small>TAGO</small></div><div class="flap-main"><b class="flap-about">${t('flapAbout')}</b>${digits.map(d=>`<span class="flap-digit">${e(d)}</span>`).join('')}<b class="flap-unit">${t('flapUnit')}</b>${first.remainingStops===null?'':`<small class="flap-stops">${t('boardStopsAway',{n:first.remainingStops})}</small>`}</div>${r.arrivals.slice(1,3).map((a,i)=>`<div class="flap-row"><span>${t(i?'flapThird':'flapSecond')}</span><b>${t('arrive',{n:a.minutes})}</b></div>`).join('')}</section>`;}
function detail(r,e,t,game,locale){const first=r.arrivals[0],ways=r.direction?[r.direction]:r.directions;
 return `<div class="row-detail">${todayLine(r,e,t,locale)}${first?flapBoard(r,e,t):''}${facts(r,e,t)}${ways.slice(0,3).map(d=>direction(d,e,t)).join('')}<div class="row-actions"><button data-timetable="${e(r.no)}" data-towards="${e(ways.length===1?ways[0].end:'')}">${t('boardSchedule')}</button>${r.routeId?`<button data-arrival-route="${e(r.routeId)}">${t('rowRoute')}</button>`:''}${first?`<button class="row-wait" data-wait-no="${e(r.no)}">${t('waitThis')}</button>`:''}${game?`<button class="rode" data-rode="${e(r.no)}" data-rode-min="${first?.minutes??99}">${t('gameRode')}</button>`:''}<button data-report-no="${e(r.no)}">${t('reportOpen')}</button></div><div id="kudos-box" data-kudos-no="${e(r.no)}"></div></div>`;}
function row(r,e,t,reports,badge,game,open,locale){const isOpen=open===r.no;
 return `<article class="tado-row ${r.notice?'has-notice':''} ${isOpen?'open':''}">${r.notice?`<div class="tado-notice" role="status"><strong>${t('boardChanged')}</strong> ${e(r.notice.title)}${r.notice.sourceUrl?` <a href="${e(r.notice.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('noticeOpen')}</a>`:''}</div>`:''}<button class="tado-main" data-row-toggle="${e(r.no)}" aria-expanded="${isOpen}"><span class="tado-head">${busFace(r.no,e,t)}${shortStatus(r,e,t)}</span><i class="row-chevron" aria-hidden="true"></i></button>${reports.filter(x=>x.no===r.no).map(x=>badge(x,e,t)).join('')}${isOpen?detail(r,e,t,game,locale):''}</article>`;}
// 정류장 표시: 색은 서는 버스 등급, 모양은 노선 수. 숫자는 번호 개수다.
export const pinClass=({kind,grade})=>`stop-pin kind-${kind} pin-${grade}`;
export const pinInner=({kind,routes})=>kind==='hub'?`<i aria-hidden="true">⇄</i>${routes}`:kind==='one'?'':String(routes);
function profileMarkup(p,e,t){if(!p)return '';const parts=Object.entries(p.grades).map(([g,n])=>`${t(`grade_${g}`)} ${n}`).join(' · ');
 return `<section class="stop-profile"><div class="stop-profile-head"><span class="${pinClass(p)}">${pinInner(p)}</span><div><strong>${t(`stopKind_${p.kind}`)}</strong><small>${t(`stopKindHelp_${p.kind}`,{n:p.routes})}${parts?` · ${parts}`:''}</small></div></div>${p.reachable.length?`<p class="stop-reach"><b>${t('stopReach')}</b> ${p.reachable.slice(0,6).map(r=>`<span>${e(r.name)}</span>`).join('')}</p>`:''}</section>`;}
export function boardMarkup(board,e,t,{reports=[],badge=()=>'',game=false,open=null,locale='ko'}={}){if(!board)return '';
 return `${profileMarkup(board.profile,e,t)}${board.liveOut?`<p class="live-stale art-note board-quota" role="status">${art('scene/quota-out',64,'art-deco')}<span>${t('boardQuotaPlan')} <a href="https://bus.jeju.go.kr/" target="_blank" rel="noopener noreferrer">${t('boardOfficial')}</a></span></p>`:''}<div class="tado-card"><h3>${t('stopRoutes',{n:board.rows.length})}</h3>${board.rows.length?board.rows.map(r=>row(r,e,t,reports,badge,game,open,locale)).join(''):`<p class="muted">${t('boardNoArrivals')}</p>`}${board.inNetwork?'':`<p class="muted">${t('boardNoTable')}</p>`}</div>`;}
export function routeBoardMarkup(stops,vehicles,no,age,mineId,e,t){const face=age===null?'ok':age<90?'ok':age<300?'stale':'lost',names=new Set(stops.map(s=>s.name)),away=vehicles.filter(v=>!names.has(v.stop)).length;
 return `<div class="route-board">${stops.map(s=>{const here=vehicles.filter(v=>v.stop===s.name);return `<button class="rb-stop ${s.id===mineId?'mine':''}" data-stop="${e(s.id)}"><span class="rb-dot"></span><span class="rb-name">${e(s.name)}</span>${here.map(()=>busFace(no,e,t,`bus-token state-${face}`)).join('')}</button>`;}).join('')}</div>${away?`<p class="rb-more">${t('rbOther',{n:away})}</p>`:''}`;}
export const routeJumpMarkup=(t,hasBus,hasMine)=>hasBus||hasMine?`<div class="rb-jump">${hasMine?`<button data-action="rb-mine">${t('rbMine')}</button>`:''}${hasBus?`<button data-action="rb-bus">${t('rbBus')}</button>`:''}</div>`:'';
export function homeLineMarkup(h,homeName,e,t){if(!h)return `<section class="home-line"><strong>${t('homeLineTo',{stop:e(homeName)})}</strong></section>`;
 if(h.verdict==='same')return '';
 const rows=h.options.slice(0,4).map(o=>`<div class="home-line-row">${chip(o.no,e,t)}${o.today==='ended'?`<strong>${t('homeLineEnded')}</strong>`:o.today==='off'?`<strong>${t('boardNotToday')}</strong>`:o.last?`<strong>${e(o.last)}</strong><small>${o.lastHere?t('homeLineHere'):o.lastBase?`${e(o.lastBase)} ${t('homeLineBase')}`:t('homeLineRoute')}</small>`:`<small>${t('boardUnknown')}</small>`}${o.sure?'':`<small>${t('boardLoop')}</small>`}</div>${o.notes.map(n=>`<p class="home-line-note">${e(n)}</p>`).join('')}`).join('');
 return `<section class="home-line">${art('scene/home-line',96,'art-deco')}<strong>${t('homeLineTo',{stop:e(h.to)})}</strong>${rows||`<p>${t(h.across?.length?'sideAcross':'sideNone')}</p>`}<p class="home-line-note">${t('homeLineWarn')}</p></section>`;}
export function sideBest(side,board){if(!side?.here?.length||!board)return [];const wanted=new Set(side.here);return board.rows.filter(r=>wanted.has(r.no)).flatMap(r=>r.arrivals.map(a=>({no:r.no,minutes:a.minutes}))).sort((a,b)=>a.minutes-b.minutes).slice(0,2);}
export function sideFormMarkup(value,side,e,t,board=null){return `<form id="side-form" class="side-form"><label for="side-input">${t('sideQuestion')}</label><div><input id="side-input" name="to" list="side-places" maxlength="40" autocomplete="off" value="${e(value||'')}" placeholder="${t('sidePlaceholder')}"><button type="submit">${t('sideCheck')}</button></div><datalist id="side-places"></datalist></form><div id="side-result" aria-live="polite">${sideResultMarkup(side,e,t,board)}</div>`;}
export function sideResultMarkup(s,e,t,board=null){if(!s)return '';const nos=a=>a.map(n=>chip(n,e,t)).join(' ');
 if(s.error)return `<p class="side-result side-none">${t('sideNoPlace')}</p>`;
 const basis=`<small>${t('sideBasis',{to:e(s.to)})}</small>`;
 if(s.verdict==='same')return `<p class="side-result side-here"><strong>${t('sideSame')}</strong></p>`;
 const unsure=s.unsure.length?`<p class="side-result side-unsure"><strong>${t('sideUnsure')}</strong> ${nos(s.unsure)}</p>`:'';
 if(s.verdict==='here'){const best=sideBest(s,board);return `${art('scene/this-side',66,'side-art art-deco')}<p class="side-result side-here"><strong>${t('sideHere')}</strong> ${nos(s.here)}${s.across.length?`<br><small>${t('sideAlsoAcross')}</small> ${nos(s.across)}`:''}</p>${best[0]?`<p class="side-best">${t('sideFirst')} ${chip(best[0].no,e,t)} <strong>${t('arrive',{n:best[0].minutes})}</strong>${best[1]?` · ${t('sideThen')} ${chip(best[1].no,e,t)} ${t('arrive',{n:best[1].minutes})}`:''}</p>`:''}${unsure}${basis}`;}
 if(s.verdict==='across')return `${art('scene/across-road',66,'side-art art-deco')}<div class="side-result side-across"><strong>${t('sideAcross')}</strong> ${nos(s.across)}${s.acrossStop?`<button data-action="side-across">${t('sideOpenAcross',{stop:e(s.acrossStop.name)})}</button>`:''}</div>${unsure}${basis}`;
 if(s.verdict==='unsure')return `${unsure}${basis}`;
 return `<p class="side-result side-none">${t('sideNone')}</p>${basis}`;}
