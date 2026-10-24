import {icon} from './icons.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urls=new Set(['https://bus.jeju.go.kr','https://map.kakao.com','https://www.odsay.com']);
export function createBusChatUI({dialog,t,request,getStatus,getContext,onLogin,onRoute}){
  let messages=[],draft='',error=null,pending=false,context={},includeContext=false,opener=null;
  const timestamp=at=>new Date(at).toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function render(){
    const status=getStatus(),ready=!!status.capabilities?.ai,logged=!!status.user;
    dialog.classList.add('ai-chat-dialog');dialog.setAttribute('aria-label',t('aiChat'));
    dialog.innerHTML=`<div class="bus-chat"><header class="chat-header"><div><span class="eyebrow">JEJU BUS ASSISTANT</span><h2>${t('aiChat')}</h2></div><button data-chat-clear ${pending?'disabled':''}>${t('chatNew')}</button><button data-chat-close aria-label="${t('close')}">${icon('close')}</button></header><p class="chat-intro">${t('chatIntro')}</p><div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">${messages.length?messages.map((m,index)=>`<article class="chat-message chat-${m.role}"><strong>${t(m.role==='user'?'chatYou':'aiChat')}</strong><p>${escape(m.content)}</p>${(m.sources||[]).length?`<details class="chat-sources"><summary>${t('chatSources',{n:m.sources.length})}</summary>${m.sources.map(s=>`<div><a href="${urls.has(s.url)?s.url:'https://bus.jeju.go.kr'}" target="_blank" rel="noopener noreferrer">${escape(s.id)} · ${escape(s.provider)} · ${t('chatData'+s.label)}</a><small>${t('receivedAt',{time:timestamp(s.receivedAt)})}</small>${s.data?.routeId?`<button data-chat-map="${escape(s.data.routeId)}">${t('chatMap')}</button>`:''}</div>`).join('')}</details>`:''}${(m.choices||[]).length?`<div class="chat-choices">${m.choices.map((c,i)=>`<button data-chat-choice="${index}:${i}" ${pending?'disabled':''}><strong>${escape(c.name)}</strong><small>${escape(c.start||'')}${c.end?' → '+escape(c.end):''}${['from','to'].includes(c.kind)?' · '+t(c.kind==='from'?'origin':'destination'):''}</small></button>`).join('')}</div>`:''}</article>`).join(''):`<div class="chat-empty">${icon('sparkles')}<h3>${t('chatWelcome')}</h3><div class="chat-examples">${['chatExampleRoute','chatExampleJourney','chatExampleStop'].map(key=>`<button data-chat-example="${key}">${t(key)}</button>`).join('')}</div></div>`}${pending?`<p class="chat-pending" role="status">${t('chatThinking')}</p>`:''}</div>${error?`<p class="chat-error" role="alert">${t(error)}</p>`:''}${!ready?`<p class="chat-availability">${t('aiNotEnabled')}</p>`:!logged?`<button class="primary chat-login" data-chat-login>${t('chatLogin')}</button>`:''}<form class="chat-form"><label class="chat-context"><input type="checkbox" ${includeContext?'checked':''} ${pending?'disabled':''}>${t('chatUseContext')}</label>${Object.keys(context).length?`<p class="chat-selected">${t('chatSelected')}: ${escape(Object.entries(context).map(([k,v])=>`${t(k==='route'?'route':k==='stop'?'stopMode':k==='from'?'origin':'destination')} ${v.name||v.number||v.id}`).join(' · '))}</p>`:''}<label class="sr-only" for="chat-question">${t('chatQuestion')}</label><div class="chat-composer"><textarea id="chat-question" rows="2" maxlength="800" placeholder="${t('chatPlaceholder')}" ${pending?'disabled':''}>${escape(draft)}</textarea><button type="submit" ${pending||!ready||!logged?'disabled':''} aria-label="${t('chatSend')}">${icon('arrow')}</button></div><small>${t('chatPrivacy')}</small></form></div>`;
    const input=dialog.querySelector('#chat-question');
    input.addEventListener('input',()=>{draft=input.value;});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(ready&&logged&&!pending)send();}});
    dialog.querySelector('.chat-context input').addEventListener('change',event=>{includeContext=event.target.checked;context=includeContext?getContext():{};render();});
    dialog.querySelector('.chat-form').addEventListener('submit',event=>{event.preventDefault();if(ready&&logged&&!pending)send();});
    const log=dialog.querySelector('.chat-messages');log.scrollTop=log.scrollHeight;
  }
  async function send(value=draft){
    if(pending||!value.trim())return;
    const content=value.trim().slice(0,800);draft='';error=null;messages.push({role:'user',content});pending=true;render();
    const history=messages.slice(-8).map(m=>({role:m.role,content:m.content.slice(0,1600)}));
    while(history.reduce((n,m)=>n+m.content.length,0)>4000&&history.length>1)history.shift();
    try{
      const result=await request('/api/chat',{method:'POST',body:JSON.stringify({messages:history,context,locale:document.documentElement.lang.startsWith('zh')?'zh':document.documentElement.lang})});
      messages.push({role:'assistant',content:result.answer,sources:result.sources,choices:result.choices});
    }catch(reason){error=reason.key||'connectionError';draft=content;messages.pop();}
    finally{pending=false;if(dialog.open&&dialog.classList.contains('ai-chat-dialog')){render();dialog.querySelector('#chat-question').focus({preventScroll:true});}}
  }
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-chat-close'))dialog.close();
    if(button.hasAttribute('data-chat-clear')&&!pending){messages=[];context={};includeContext=false;error=null;draft='';render();}
    if(button.hasAttribute('data-chat-login')){dialog.close();onLogin();}
    if(button.dataset.chatExample){draft=t(button.dataset.chatExample);render();dialog.querySelector('#chat-question').focus();}
    if(button.dataset.chatChoice&&!pending){const [index,i]=button.dataset.chatChoice.split(':').map(Number),choice=messages[index]?.choices?.[i];if(!choice)return;context[choice.kind]={...choice};send(t('chatChoiceQuestion',{name:choice.name}));}
    if(button.dataset.chatMap){dialog.close();onRoute(button.dataset.chatMap,context.route?.name);}
  });
  dialog.addEventListener('close',()=>{dialog.classList.remove('ai-chat-dialog');dialog.removeAttribute('aria-label');opener?.focus({preventScroll:true});});
  return {open(){opener=document.activeElement;render();if(!dialog.open)dialog.showModal();}};
}
