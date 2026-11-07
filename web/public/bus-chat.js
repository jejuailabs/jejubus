import {icon} from './icons.js';
import {busFace} from './board.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urls=new Set(['https://bus.jeju.go.kr','https://map.kakao.com','https://www.odsay.com']);
const MIC='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SPEECH_LANG={ko:'ko-KR',en:'en-US','zh-CN':'zh-CN',zh:'zh-CN',ja:'ja-JP'};
// 답변의 승차 카드. 모델 문장이 아니라 서버가 계산한 값만 그린다.
function legOption(o,t){
 const b=o.board||{},a=o.arrival||{},when=a.minutes?.length?t('arrive',{n:a.minutes[0]}):a.live?t('chatNoArrival'):t('chatLiveUnknown');
 const walk=b.walkMeters===undefined?'':` · ${t('chatWalk',{m:b.walkMeters,dir:t(`dir_${b.heading}`)})}`;
 return `<section class="chat-trip-option"><div class="chat-trip-head">${busFace(o.no,escape,t)}<strong>${escape(when)}</strong>${a.remainingStops===null||a.remainingStops===undefined?'':`<small>${t('boardStopsAway',{n:a.remainingStops})}</small>`}</div><ol><li><b>${t('chatBoard')}</b> ${escape(b.name||'')}${walk}${b.next?`<small>${t('chatSign',{stop:escape(b.next)})}${b.towards?` · ${t('boardToward',{stop:escape(b.towards)})}`:''}</small>`:''}${b.opposite?.nearer?`<em>${t('chatCross',{stop:escape(b.opposite.next||b.opposite.name)})}</em>`:''}</li>${(o.then||[]).map(l=>`<li><b>${t('chatTransfer')}</b> ${escape(l.board||'')} · ${escape((l.numbers||[]).join(', '))}</li>`).join('')}<li><b>${t('chatOff')}</b> ${escape(o.off?.name||'')}${o.stops?` · ${t('chatStops',{n:o.stops})}`:''}${o.off?.walkToDestination?`<small>${t('chatWalkEnd',{m:o.off.walkToDestination})}</small>`:''}</li></ol></section>`;
}
export const tripCard=(trip,t)=>trip?.options?.length?`<div class="chat-trip">${trip.options.slice(0,2).map(o=>legOption(o,t)).join('')}</div>`:'';
const actionLabel=(a,t)=>a.kind==='stop'?t('chatActStop',{stop:escape(a.stop.name)}):a.kind==='save'?t('chatActSave'):a.kind==='live'?t('chatActLive',{no:escape(a.no)}):a.kind==='timetable'?t('chatActTable',{no:escape(a.no)}):a.kind==='journey'?t('chatActJourney'):t('chatActWhen',{no:escape(a.no)});
export function createBusChatUI({dialog,t,request,getStatus,getContext,getRide=()=>null,onLogin,onRoute,onAction=()=>{}}){
  let messages=[],draft='',error=null,pending=false,context={},includeContext=false,opener=null,me=null,locating=false,listening=false,voice=false,recognizer=null;
  let useLocation=false;try{useLocation=localStorage.getItem('jb.chatLoc')==='on';}catch{}
  const speechApi=()=>window.SpeechRecognition||window.webkitSpeechRecognition,Speech=!!speechApi();
  const lang=()=>SPEECH_LANG[document.documentElement.lang]||'ko-KR';
  const stopVoice=()=>{try{speechSynthesis?.cancel();}catch{}};
  const say=text=>{try{const u=new SpeechSynthesisUtterance(text);u.lang=lang();speechSynthesis.cancel();speechSynthesis.speak(u);}catch{}};
  function remember(on){useLocation=on;try{localStorage.setItem('jb.chatLoc',on?'on':'off');}catch{}}
  // 버스는 움직이므로 물어볼 때마다 위치를 새로 받는다.
  function locate(){
   if(!navigator.geolocation){error='geolocationUnsupported';render();return Promise.resolve(null);}
   locating=true;render();
   return new Promise(done=>navigator.geolocation.getCurrentPosition(p=>{const {latitude:lat,longitude:lng,accuracy}=p.coords;locating=false;if(lat<33||lat>34.2||lng<125.8||lng>127.3){me=null;error='outsideJeju';render();done(null);return;}me={lat,lng,accuracy:Math.round(accuracy||0)};remember(true);render();done(me);},()=>{locating=false;me=null;error='geolocationError';render();done(null);},{enableHighAccuracy:true,timeout:9000,maximumAge:15000}));
  }
  function listen(){
   if(listening){recognizer?.stop();return;}
   if(!Speech)return;stopVoice();
   let heard='';const Listener=speechApi();recognizer=new Listener();recognizer.lang=lang();recognizer.interimResults=true;recognizer.continuous=false;
   recognizer.onresult=ev=>{heard=[...ev.results].map(r=>r[0].transcript).join('');draft=heard;const box=dialog.querySelector('#chat-question');if(box)box.value=heard;};
   recognizer.onerror=ev=>{if(ev.error==='not-allowed'||ev.error==='service-not-allowed')error='chatMicDenied';else if(ev.error!=='no-speech'&&ev.error!=='aborted')error='chatMicError';};
   recognizer.onend=()=>{listening=false;render();if(heard.trim()&&!pending){voice=true;send(heard);}};
   listening=true;error=null;render();try{recognizer.start();}catch{listening=false;render();}
  }
  const timestamp=at=>new Date(at).toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function render(){
    const status=getStatus(),ready=!!status.capabilities?.ai,logged=!!status.user;
    dialog.classList.add('ai-chat-dialog');dialog.setAttribute('aria-label',t('aiChat'));
    const selectable=Object.keys(getContext()).length>0,blocked=pending||!ready||!logged;
    const sources=m=>(m.sources||[]).length?`<details class="chat-sources"><summary>${t('chatSources',{n:m.sources.length})}</summary>${m.sources.map(s=>`<div><a href="${urls.has(s.url)?s.url:'https://bus.jeju.go.kr'}" target="_blank" rel="noopener noreferrer">${escape(s.id)} · ${escape(s.provider)} · ${t('chatData'+s.label)}</a><small>${t('receivedAt',{time:timestamp(s.receivedAt)})}</small>${s.data?.routeId?`<button data-chat-map="${escape(s.data.routeId)}">${t('chatMap')}</button>`:''}</div>`).join('')}</details>`:'';
    const choices=(m,index)=>(m.choices||[]).length?`<div class="chat-choices">${m.choices.map((c,i)=>`<button data-chat-choice="${index}:${i}" ${pending?'disabled':''}><strong>${escape(c.name)}</strong><small>${escape(c.start||'')}${c.end?' → '+escape(c.end):''}${['from','to'].includes(c.kind)?' · '+t(c.kind==='from'?'origin':'destination'):''}</small></button>`).join('')}</div>`:'';
    const row=(m,index)=>m.role==='user'?`<div class="chat-message chat-user"><span class="sr-only">${t('chatYou')}</span><p class="chat-bubble">${escape(m.content)}</p></div>`:`<div class="chat-message chat-assistant"><img class="chat-mini" src="/art/scene/ai-avatar.webp" alt=""><div class="chat-body"><span class="sr-only">${t('aiChat')}</span><p class="chat-bubble">${escape(m.content)}</p>${choices(m,index)}${tripCard(m.trip,t)}${m.needsLocation?`<button class="chat-need-loc" data-chat-locate="retry" ${locating?'disabled':''}>${icon('locate')}${t('chatShareLocation')}</button>`:''}${(m.actions||[]).length?`<div class="chat-actions">${m.actions.map((a,i)=>`<button data-chat-action="${index}:${i}">${actionLabel(a,t)}</button>`).join('')}</div>`:''}${sources(m)}</div></div>`;
    const empty=`<div class="chat-empty"><img class="chat-hero" src="/art/scene/ai-avatar.webp" alt=""><h3>${t('chatWelcome')}</h3><p>${t('chatIntro')}</p><div class="chat-examples">${['chatExampleBoard','chatExampleOff','chatExampleWhen','chatExampleNear'].map(key=>`<button data-chat-example="${key}" ${blocked?'disabled':''}>${t(key)}</button>`).join('')}</div><small>${t('chatPrivacy')}</small></div>`;
    dialog.innerHTML=`<div class="bus-chat"><header class="chat-header"><img class="chat-art" src="/art/scene/ai-avatar.webp" alt=""><h2>${t('aiChat')}</h2><button class="chat-icon" data-chat-clear ${pending||!messages.length?'disabled':''} aria-label="${t('chatNew')}" title="${t('chatNew')}">${icon('refresh')}</button><button class="chat-icon" data-chat-close aria-label="${t('close')}">${icon('close')}</button></header><div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">${messages.length?messages.map(row).join(''):empty}${pending?`<div class="chat-message chat-assistant chat-typing" role="status"><img class="chat-mini" src="/art/scene/ai-avatar.webp" alt=""><p class="chat-bubble"><span class="sr-only">${t('chatThinking')}</span><i></i><i></i><i></i></p></div>`:''}</div>${error?`<p class="chat-error" role="alert">${t(error)}</p>`:''}${!ready?`<p class="chat-availability">${t('aiNotEnabled')}</p>`:!logged?`<button class="primary chat-login" data-chat-login>${t('chatLogin')}</button>`:''}<form class="chat-form">${selectable||includeContext?`<label class="chat-context ${includeContext?'on':''}"><input type="checkbox" ${includeContext?'checked':''} ${pending?'disabled':''}>${includeContext&&Object.keys(context).length?escape(Object.values(context).map(v=>v.name||v.number||v.id).join(' · ')):t('chatUseContext')}</label>`:''}<label class="sr-only" for="chat-question">${t('chatQuestion')}</label><div class="chat-composer"><button type="button" class="chat-loc ${useLocation?'on':''}" data-chat-locate="toggle" aria-pressed="${useLocation}" aria-label="${t(locating?'chatLocating':useLocation?'chatLocationOn':'chatLocationOff')}" title="${t(useLocation?'chatLocationOn':'chatLocationOff')}" ${locating?'disabled':''}>${icon('locate')}</button><textarea id="chat-question" rows="1" maxlength="800" placeholder="${t(listening?'chatListening':locating?'chatLocating':'chatAsk')}" ${pending?'disabled':''}>${escape(draft)}</textarea>${Speech?`<button type="button" class="chat-mic ${listening?'on':''}" data-chat-mic aria-pressed="${listening}" aria-label="${t(listening?'chatMicStop':'chatMic')}" ${blocked?'disabled':''}>${MIC}</button>`:''}<button type="submit" class="chat-send" ${blocked?'disabled':''} aria-label="${t('chatSend')}">${icon('arrow')}</button></div></form></div>`;
    const input=dialog.querySelector('#chat-question');
    // 한 줄에서 시작해 내용만큼 늘어난다.
    const grow=()=>{if(!input.value){input.style.height='';return;}input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,112)}px`;};grow();
    input.addEventListener('input',()=>{draft=input.value;grow();});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(ready&&logged&&!pending)send();}});
    dialog.querySelector('.chat-context input')?.addEventListener('change',event=>{includeContext=event.target.checked;context=includeContext?getContext():{};render();});
    dialog.querySelector('.chat-form').addEventListener('submit',event=>{event.preventDefault();if(ready&&logged&&!pending)send();});
    const log=dialog.querySelector('.chat-messages');log.scrollTop=log.scrollHeight;
  }
  async function send(value=draft){
    if(pending||!value.trim())return;
    const content=value.trim().slice(0,800);draft='';error=null;messages.push({role:'user',content});pending=true;render();
    const history=messages.slice(-8).map(m=>({role:m.role,content:m.content.slice(0,1600)}));
    while(history.reduce((n,m)=>n+m.content.length,0)>4000&&history.length>1)history.shift();
    try{
      if(useLocation)await locate();
      const ride=getRide();
      const result=await request('/api/chat',{method:'POST',body:JSON.stringify({messages:history,context:{...context,...(useLocation&&me?{me}:{}),...(ride?{ride}:{})},locale:document.documentElement.lang.startsWith('zh')?'zh':document.documentElement.lang})});
      messages.push({role:'assistant',content:result.answer,sources:result.sources,choices:result.choices,actions:result.actions,trip:result.trip,needsLocation:result.needsLocation});if(voice)say(result.answer);
    }catch(reason){error=reason.key||'connectionError';draft=content;messages.pop();}
    finally{pending=false;voice=false;if(dialog.open&&dialog.classList.contains('ai-chat-dialog')){render();dialog.querySelector('#chat-question').focus({preventScroll:true});}}
  }
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-chat-close'))dialog.close();
    if(button.hasAttribute('data-chat-mic'))listen();
    if(button.dataset.chatLocate==='toggle'){if(useLocation){remember(false);me=null;render();}else locate();}
    if(button.dataset.chatLocate==='retry'&&!pending)locate().then(where=>{if(where)send(t('chatLocationSent'));});
    if(button.dataset.chatAction&&!pending){const [index,i]=button.dataset.chatAction.split(':').map(Number),action=messages[index]?.actions?.[i];if(!action)return;if(action.kind==='ask')send(t('chatAsk_when',{no:action.no,stop:action.stop}));else onAction(action);}
    if(button.hasAttribute('data-chat-clear')&&!pending){stopVoice();messages=[];context={};includeContext=false;error=null;draft='';render();}
    if(button.hasAttribute('data-chat-login')){dialog.close();onLogin();}
    if(button.dataset.chatExample&&!pending)send(t(button.dataset.chatExample));
    if(button.dataset.chatChoice&&!pending){const [index,i]=button.dataset.chatChoice.split(':').map(Number),choice=messages[index]?.choices?.[i];if(!choice)return;context[choice.kind]={...choice};send(t('chatChoiceQuestion',{name:choice.name}));}
    if(button.dataset.chatMap){dialog.close();onRoute(button.dataset.chatMap,context.route?.name);}
  });
  dialog.addEventListener('close',()=>{stopVoice();recognizer?.abort?.();dialog.classList.remove('ai-chat-dialog');dialog.removeAttribute('aria-label');opener?.focus({preventScroll:true});});
  return {open(){opener=document.activeElement;render();if(!dialog.open)dialog.showModal();}};
}
