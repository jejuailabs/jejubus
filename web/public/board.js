// 타도 돼 카드 화면. 값은 서버가 준 것만 쓰고, 없으면 칸을 숨기거나 "확인되지 않아요"라고 말한다.
// 등급은 BIS 노선 분류(앞자리) 기준이다. TAGO routetp는 공식 분류와 달라 쓰지 않는다.
export function gradeOf(no){const n=String(no);if(/^(810|820)(-|$)/.test(n))return 'tour';const d=n[0];if(n.length<3)return 'other';if(d==='1')return 'express';if('235'.includes(d))return 'trunk';if('467'.includes(d))return 'branch';return 'other';}
export const chip=(no,e,t)=>{const g=gradeOf(no);return `<span class="grade-chip grade-${g}" title="${e(t(`grade_${g}`))}"><i aria-hidden="true"></i><b>${e(no)}</b></span>`;};
const direction=(d,e,t)=>!d?'':d.terminus?`<small class="tado-dir">${t('boardTerminus')}</small>`:`<small class="tado-dir">${t('boardNext',{stop:e(d.next)})} · ${t('boardToward',{stop:e(d.end)})}${d.loop?` · ${t('boardLoop')}`:''}</small>`;
function statusLine(r,e,t){const s=r.today;
 if(s.state==='coming'||r.arrivals.length)return '';
 if(s.state==='scheduled')return `<p>${s.time?t('boardScheduled',{time:e(s.time)}):t('boardRunningPlan')}</p>`;
 if(s.state==='beforeFirst')return `<p>${t('boardBeforeFirst',{time:e(s.time)})}</p>`;
 if(s.state==='ended')return `<p>${t('boardEnded')}</p>`;
 if(s.state==='notToday')return `<p class="tado-off"><strong>${t('boardNotToday')}</strong>${s.effective?` <small>${e(s.effective)}</small>`:''}</p>`;
 if(s.state==='running')return `<p>${t('boardRunning')}</p>`;
 return `<p class="muted">${t('boardUnknown')}</p>`;}
const planLine=(p,e,t)=>p&&(p.interval||p.last)?`<span class="tado-plan">${p.interval?`${t('planInterval',{v:e(p.interval)})}`:''}${p.interval&&p.last?' · ':''}${p.last?t('planLast',{v:e(p.last)}):''}${p.last&&p.lastBase?` (${e(p.lastBase)})`:''}</span>`:'';
function row(r,e,t,reports,badge,game){const first=r.arrivals[0],second=r.arrivals[1],d=r.direction||(r.directions.length===1?r.directions[0]:null);
 const main=`<span class="tado-head">${chip(r.no,e,t)}${first?`<strong class="tado-min">${t('arrive',{n:first.minutes})}</strong>${first.remainingStops===null?'':`<small>${t('boardStopsAway',{n:first.remainingStops})}</small>`}`:''}</span>${direction(d,e,t)}`;
 return `<article class="tado-row ${r.notice?'has-notice':''}">${r.notice?`<div class="tado-notice" role="status"><strong>${t('boardChanged')}</strong> ${e(r.notice.title)}${r.notice.sourceUrl?` <a href="${e(r.notice.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('noticeOpen')}</a>`:''}</div>`:''}${r.routeId?`<button class="tado-main" data-arrival-route="${e(r.routeId)}">${main}</button>`:`<div class="tado-main">${main}</div>`}${statusLine(r,e,t)}${reports.filter(x=>x.no===r.no).map(x=>badge(x,e,t)).join('')}<div class="tado-after">${second?`<span>${t('boardMissNext',{n:second.minutes})}</span>`:planLine(r.plan,e,t)}${game&&!r.notice&&first?`<button class="rode" data-rode="${e(r.no)}">${t('gameRode')}</button>`:''}<a href="${e(r.scheduleUrl)}" target="_blank" rel="noopener noreferrer">${t('boardSchedule')}</a><button data-report-no="${e(r.no)}">${t('reportOpen')}</button></div></article>`;}
export function boardMarkup(board,e,t,{reports=[],badge=()=>'',game=false}={}){if(!board)return '';
 const on=board.rows.filter(r=>r.arrivals.length||r.notice),off=board.rows.filter(r=>!r.arrivals.length&&!r.notice);
 return `<div class="tado-card"><h3>${t('boardTitle')}</h3>${on.length?on.map(r=>row(r,e,t,reports,badge,game)).join(''):`<p class="muted">${t('boardNoArrivals')}</p>`}${off.length?`<details class="tado-more"><summary>${t('boardQuiet',{n:off.length})}</summary>${off.map(r=>row(r,e,t,reports,badge,game)).join('')}</details>`:''}${board.inNetwork?'':`<p class="muted">${t('boardNoTable')}</p>`}</div>`;}
export function routeBoardMarkup(stops,vehicles,no,age,mineId,e,t){const face=age===null?'ok':age<90?'ok':age<300?'stale':'lost',names=new Set(stops.map(s=>s.name)),away=vehicles.filter(v=>!names.has(v.stop)).length,g=gradeOf(no);
 return `<div class="route-board">${stops.map(s=>{const here=vehicles.filter(v=>v.stop===s.name);return `<button class="rb-stop ${s.id===mineId?'mine':''}" data-stop="${e(s.id)}"><span class="rb-dot"></span><span class="rb-name">${e(s.name)}</span>${here.map(()=>`<span class="bus-token grade-${g} state-${face}"><b>${e(no)}</b><span><i></i><i></i></span></span>`).join('')}</button>`;}).join('')}</div>${away?`<p class="rb-more">${t('rbOther',{n:away})}</p>`:''}`;}
export const routeJumpMarkup=(t,hasBus,hasMine)=>hasBus||hasMine?`<div class="rb-jump">${hasMine?`<button data-action="rb-mine">${t('rbMine')}</button>`:''}${hasBus?`<button data-action="rb-bus">${t('rbBus')}</button>`:''}</div>`:'';
export function homeLineMarkup(h,homeName,e,t){if(!h)return `<section class="home-line"><strong>${t('homeLineTo',{stop:e(homeName)})}</strong></section>`;
 if(h.verdict==='same')return '';
 const rows=h.options.slice(0,4).map(o=>`<div class="home-line-row">${chip(o.no,e,t)}${o.today==='ended'?`<strong>${t('homeLineEnded')}</strong>`:o.today==='off'?`<strong>${t('boardNotToday')}</strong>`:o.last?`<strong>${e(o.last)}</strong><small>${o.lastHere?t('homeLineHere'):o.lastBase?`${e(o.lastBase)} ${t('homeLineBase')}`:t('homeLineRoute')}</small>`:`<small>${t('boardUnknown')}</small>`}${o.sure?'':`<small>${t('boardLoop')}</small>`}</div>${o.notes.map(n=>`<p class="home-line-note">${e(n)}</p>`).join('')}`).join('');
 return `<section class="home-line"><strong>${t('homeLineTo',{stop:e(h.to)})}</strong>${rows||`<p>${t(h.across?.length?'sideAcross':'sideNone')}</p>`}<p class="home-line-note">${t('homeLineWarn')}</p></section>`;}
export function sideBest(side,board){if(!side?.here?.length||!board)return [];const wanted=new Set(side.here);return board.rows.filter(r=>wanted.has(r.no)).flatMap(r=>r.arrivals.map(a=>({no:r.no,minutes:a.minutes}))).sort((a,b)=>a.minutes-b.minutes).slice(0,2);}
export function sideFormMarkup(value,side,e,t,board=null){return `<form id="side-form" class="side-form"><label for="side-input">${t('sideQuestion')}</label><div><input id="side-input" name="to" list="side-places" maxlength="40" autocomplete="off" value="${e(value||'')}" placeholder="${t('sidePlaceholder')}"><button type="submit">${t('sideCheck')}</button></div><datalist id="side-places"></datalist></form><div id="side-result" aria-live="polite">${sideResultMarkup(side,e,t,board)}</div>`;}
export function sideResultMarkup(s,e,t,board=null){if(!s)return '';const nos=a=>a.map(n=>chip(n,e,t)).join(' ');
 if(s.error)return `<p class="side-result side-none">${t('sideNoPlace')}</p>`;
 const basis=`<small>${t('sideBasis',{to:e(s.to)})}</small>`;
 if(s.verdict==='same')return `<p class="side-result side-here"><strong>${t('sideSame')}</strong></p>`;
 const unsure=s.unsure.length?`<p class="side-result side-unsure"><strong>${t('sideUnsure')}</strong> ${nos(s.unsure)}</p>`:'';
 if(s.verdict==='here'){const best=sideBest(s,board);return `<p class="side-result side-here"><strong>${t('sideHere')}</strong> ${nos(s.here)}${s.across.length?`<br><small>${t('sideAlsoAcross')}</small> ${nos(s.across)}`:''}</p>${best[0]?`<p class="side-best">${t('sideFirst')} ${chip(best[0].no,e,t)} <strong>${t('arrive',{n:best[0].minutes})}</strong>${best[1]?` · ${t('sideThen')} ${chip(best[1].no,e,t)} ${t('arrive',{n:best[1].minutes})}`:''}</p>`:''}${unsure}${basis}`;}
 if(s.verdict==='across')return `<div class="side-result side-across"><strong>${t('sideAcross')}</strong> ${nos(s.across)}${s.acrossStop?`<button data-action="side-across">${t('sideOpenAcross',{stop:e(s.acrossStop.name)})}</button>`:''}</div>${unsure}${basis}`;
 if(s.verdict==='unsure')return `${unsure}${basis}`;
 return `<p class="side-result side-none">${t('sideNone')}</p>${basis}`;}
