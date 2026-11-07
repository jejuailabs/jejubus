// 앱 안 시간표. 넓은 표 대신 방향과 정류장을 고르면 그 정류장의 시각만 크게 보여 준다.
import {busFace} from './board.js';
const parts=(g,e,t)=>[g.first&&t('ttFirst',{v:e(g.first)}),g.last&&t('ttLast',{v:e(g.last)}),g.interval&&t('ttGap',{v:e(g.interval)})].filter(Boolean).join(' · ');
function timeChip(item,next,mark,e,t){
 const cls=['tt-time',item.off?'off':'',!item.off&&next?'next':'',!item.off&&item.past?'past':'',item.maybe?'maybe':''].filter(Boolean).join(' ');
 return `<li class="${cls}">${item.off?`<s>${e(item.time)}</s>`:e(item.time)}${mark?`<sup>${mark}</sup>`:''}${!item.off&&next?`<small>${t('ttNext')}</small>`:''}</li>`;
}
export function timetableMarkup(view,e,t){
 if(!view?.groups?.length)return `<div class="form-modal tt-sheet"><h2>${busFace(view?.no||'',e,t)} ${t('ttTitle',{no:e(view?.no||'')})}</h2><p>${t('ttNone')}</p><a class="tt-source" href="${e(view?.sourceUrl||'https://bus.jeju.go.kr/')}" target="_blank" rel="noopener noreferrer">${t('ttSource')}</a></div>`;
 const g=view.groups[view.group]||view.groups[0],stop=g.stops[g.stop]||g.stops[0],notes=[],marks=new Map();
 for(const item of stop.times)if(item.note&&!marks.has(item.note)){notes.push(item.note);marks.set(item.note,notes.length);}
 const times=stop.times.map(x=>({...x,past:x.minutes<view.current})),next=times.find(x=>!x.off&&!x.past);
 return `<div class="form-modal tt-sheet"><div class="tt-head">${busFace(view.no,e,t)}<div><h2>${t('ttTitle',{no:e(view.no)})}</h2><p>${t(`ttDay${view.kind}`)}</p></div></div>
 ${view.groups.length>1?`<div class="tt-groups" role="tablist">${view.groups.map((x,i)=>`<button role="tab" aria-selected="${i===view.group}" class="${i===view.group?'active':''}" data-tt-group="${i}">${t('ttToward',{stop:e(x.end)})}</button>`).join('')}</div>`:`<p class="tt-path">${e(g.path)}</p>`}
 ${parts(g,e,t)?`<p class="tt-line">${parts(g,e,t)}</p>`:''}
 <label class="tt-stop">${t('ttStop')}<select id="tt-stop">${g.stops.map((s,i)=>`<option value="${i}" ${i===g.stop?'selected':''}>${e(s.name)}</option>`).join('')}</select></label>
 <ul class="tt-times">${times.map(x=>timeChip(x,x===next,marks.get(x.note),e,t)).join('')}</ul>
 ${next?'':`<p class="tt-done">${t('ttDone')}</p>`}
 ${times.some(x=>x.maybe)?`<p class="tt-note">${t('ttMaybe')}</p>`:''}
 ${notes.length?`<div class="tt-notes"><strong>${t('ttNotes')}</strong><ol>${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ol></div>`:''}
 <p class="tt-note">${t('ttWarn')}${g.effective?` ${e(g.effective)}`:''}</p>
 <a class="tt-source" href="${e(view.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('ttSource')}</a></div>`;
}
