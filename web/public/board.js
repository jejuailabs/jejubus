// 타도 돼 카드 화면. 값은 서버가 준 것만 쓰고, 없으면 칸을 숨기거나 "확인되지 않아요"라고 말한다.
// 등급은 BIS 노선 분류(앞자리) 기준이다. TAGO routetp는 공식 분류와 달라 쓰지 않는다.
export function gradeOf(no){const n=String(no);if(/^(810|820)(-|$)/.test(n))return 'tour';const d=n[0];if(n.length<3)return 'other';if(d==='1')return 'express';if('235'.includes(d))return 'trunk';if('467'.includes(d))return 'branch';return 'other';}
export const chip=(no,e,t)=>{const g=gradeOf(no);return `<span class="grade-chip grade-${g}" title="${e(t(`grade_${g}`))}"><i aria-hidden="true"></i><b>${e(no)}</b></span>`;};
const direction=(d,e,t)=>!d?'':d.terminus?`<small class="tado-dir">${t('boardTerminus')}</small>`:`<small class="tado-dir">${t('boardNext',{stop:e(d.next)})} · ${t('boardToward',{stop:e(d.end)})}${d.loop?` · ${t('boardLoop')}`:''}</small>`;
function statusLine(r,e,t){const s=r.today;
 if(s.state==='coming'||r.arrivals.length)return '';
 if(s.state==='scheduled')return `<p>${t('boardScheduled',{time:e(s.time)})}</p>`;
 if(s.state==='beforeFirst')return `<p>${t('boardBeforeFirst',{time:e(s.time)})}</p>`;
 if(s.state==='ended')return `<p>${t('boardEnded')}</p>`;
 if(s.state==='notToday')return `<p>${t('boardNotToday')}</p>`;
 if(s.state==='running')return `<p>${t('boardRunning')}</p>`;
 return `<p class="muted">${t('boardUnknown')}</p>`;}
function row(r,e,t){const first=r.arrivals[0],second=r.arrivals[1],d=r.direction||(r.directions.length===1?r.directions[0]:null);
 const main=`<span class="tado-head">${chip(r.no,e,t)}${first?`<strong class="tado-min">${t('arrive',{n:first.minutes})}</strong>${first.remainingStops===null?'':`<small>${t('boardStopsAway',{n:first.remainingStops})}</small>`}`:''}</span>${direction(d,e,t)}`;
 return `<article class="tado-row ${r.notice?'has-notice':''}">${r.notice?`<div class="tado-notice" role="status"><strong>${t('boardChanged')}</strong> ${e(r.notice.title)}${r.notice.sourceUrl?` <a href="${e(r.notice.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('noticeOpen')}</a>`:''}</div>`:''}${r.routeId?`<button class="tado-main" data-arrival-route="${e(r.routeId)}">${main}</button>`:`<div class="tado-main">${main}</div>`}${statusLine(r,e,t)}<div class="tado-after">${second?`<span>${t('boardMissNext',{n:second.minutes})}</span>`:''}<a href="${e(r.scheduleUrl)}" target="_blank" rel="noopener noreferrer">${t('boardSchedule')}</a></div></article>`;}
export function boardMarkup(board,e,t){if(!board)return '';
 const on=board.rows.filter(r=>r.arrivals.length||r.notice),off=board.rows.filter(r=>!r.arrivals.length&&!r.notice);
 return `<div class="tado-card"><h3>${t('boardTitle')}</h3>${on.length?on.map(r=>row(r,e,t)).join(''):`<p class="muted">${t('boardNoArrivals')}</p>`}${off.length?`<details class="tado-more"><summary>${t('boardQuiet',{n:off.length})}</summary>${off.map(r=>row(r,e,t)).join('')}</details>`:''}${board.inNetwork?'':`<p class="muted">${t('boardNoTable')}</p>`}</div>`;}
export function sideFormMarkup(value,side,e,t){return `<form id="side-form" class="side-form"><label for="side-input">${t('sideQuestion')}</label><div><input id="side-input" name="to" list="side-places" maxlength="40" autocomplete="off" value="${e(value||'')}" placeholder="${t('sidePlaceholder')}"><button type="submit">${t('sideCheck')}</button></div><datalist id="side-places"></datalist></form><div id="side-result" aria-live="polite">${sideResultMarkup(side,e,t)}</div>`;}
export function sideResultMarkup(s,e,t){if(!s)return '';const nos=a=>a.map(n=>chip(n,e,t)).join(' ');
 if(s.error)return `<p class="side-result side-none">${t('sideNoPlace')}</p>`;
 const basis=`<small>${t('sideBasis',{to:e(s.to)})}</small>`;
 if(s.verdict==='same')return `<p class="side-result side-here"><strong>${t('sideSame')}</strong></p>`;
 const unsure=s.unsure.length?`<p class="side-result side-unsure"><strong>${t('sideUnsure')}</strong> ${nos(s.unsure)}</p>`:'';
 if(s.verdict==='here')return `<p class="side-result side-here"><strong>${t('sideHere')}</strong> ${nos(s.here)}${s.across.length?`<br><small>${t('sideAlsoAcross')}</small> ${nos(s.across)}`:''}</p>${unsure}${basis}`;
 if(s.verdict==='across')return `<div class="side-result side-across"><strong>${t('sideAcross')}</strong> ${nos(s.across)}${s.acrossStop?`<button data-action="side-across">${t('sideOpenAcross',{stop:e(s.acrossStop.name)})}</button>`:''}</div>${unsure}${basis}`;
 if(s.verdict==='unsure')return `${unsure}${basis}`;
 return `<p class="side-result side-none">${t('sideNone')}</p>${basis}`;}
