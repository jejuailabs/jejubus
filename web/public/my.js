// 마이페이지: 서버가 로그인한 회원의 기록만 돌려준다. 회원번호는 받지 않는다.
import {translate,locales} from './i18n.js';
const root=document.querySelector('#my-app');
let locale;try{locale=JSON.parse(localStorage.getItem('jejubus.locale'))||'ko';}catch{locale='ko';}if(!locales[locale])locale='ko';
const t=(key,values)=>translate(locale,key,values),e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=at=>at?new Date(at).toLocaleDateString(locale):'—',stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
let data=null,status={},failed=false,editing=null;
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error),{key:body.error,status:response.status});return body;}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');setTimeout(()=>el.classList.remove('visible'),4500);}
const header=()=>`<header class="admin-header"><a href="/">${t('brand')} <small>${t('backToApp')}</small></a></header>`;
function loginChoices(){const l=status.login||{};return `<div class="my-login">${l.google?`<a class="primary" href="/auth/google">${t('login')}</a>`:''}${l.kakao?`<a class="primary kakao-signin" href="/auth/kakao">${t('loginKakao')}</a>`:''}${l.naver?`<a class="primary naver-signin" href="/auth/naver">${t('loginNaver')}</a>`:''}</div>`;}
const section=(title,body)=>`<section class="admin-section my-section"><h2>${e(title)}</h2>${body}</section>`;
function reviewRow(r){
 if(editing===r.id)return `<form class="my-review" data-review-form="${e(r.id)}"><label>${t('ratingLabel')}<select name="rating">${[5,4,3,2,1].map(n=>`<option value="${n}" ${n===r.rating?'selected':''}>${stars(n)}</option>`).join('')}</select></label><label>${t('reviewBody')}<textarea name="text" rows="3" minlength="5" maxlength="200" required>${e(r.text)}</textarea></label><p class="form-error" role="alert"></p><div class="detail-tools"><button class="primary" type="submit">${t('edit')}</button><button type="button" data-cancel>${t('close')}</button></div></form>`;
 return `<article class="my-review"><strong>${e(r.contextName||t('route'))} · <span class="review-stars" aria-label="${r.rating}/5">${stars(r.rating)}</span></strong><p>${e(r.text)}</p><small>${date(r.created)}${r.status==='hidden'?` · ${t('statusHiddenReview')}`:''}</small>${r.status==='published'?`<div class="detail-tools"><button data-edit="${e(r.id)}">${t('edit')}</button><button data-delete="${e(r.id)}">${t('delete')}</button></div>`:''}</article>`;
}
const inquiryRow=q=>`<article class="my-review"><strong>${e(q.id)} · <span class="status-label ${q.status==='answered'?'on':'off'}">${t(q.status==='answered'?'statusAnswered':'statusOpen')}</span></strong>${q.contextName?`<small>${e(q.contextName)}</small>`:''}<p>${e(q.question)}</p>${q.answer?`<p class="my-answer"><b>${t('answerFromOperator')}</b> ${e(q.answer)}</p>`:''}<small>${date(q.created)}</small></article>`;
function render(){
 document.documentElement.lang=locale==='zh'?'zh-CN':locale;document.title=`${t('myPage')} · ${t('brand')}`;
 if(failed){root.innerHTML=`${header()}<main class="admin-main">${section(t('myPage'),`<p role="alert">${t('connectionError')}</p>`)}</main>`;return;}
 if(!data){root.innerHTML=`${header()}<main class="admin-main"><div class="admin-title"><h1>${t('myPage')}</h1></div>${status.ready?section(t('myPage'),`<p>${t('myLoggedOut')}</p>${loginChoices()}`):`<p role="status">${t('loading')}</p>`}</main>`;return;}
 const p=data.profile;
 root.innerHTML=`${header()}<main class="admin-main"><div class="admin-title"><p class="eyebrow">MY PAGE</p><h1>${e(t('hello',{name:p.name}))}</h1></div>
 ${section(t('myProfile'),`<dl class="my-profile"><dt>${t('myProvider')}</dt><dd>${e({google:'Google',kakao:'Kakao',naver:'NAVER'}[p.provider]||p.provider)}</dd><dt>${t('myJoined')}</dt><dd>${date(p.created)}</dd><dt>${t('myVisits')}</dt><dd>${p.visits}</dd><dt>${t('myLastLogin')}</dt><dd>${date(p.lastLogin)}</dd></dl><div class="detail-tools">${status.channelId?`<a class="text-btn" href="https://pf.kakao.com/${e(status.channelId)}/chat" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${t('kakaoConsult')}</a>`:''}<button data-logout>${t('logout')}</button>${p.protected?`<small>${t('withdrawNote')}</small>`:`<button data-withdraw>${t('withdraw')}</button>`}</div>`)}
 ${section(t('mySaved'),data.saved.length?`<div class="my-chips">${data.saved.map(r=>`<a class="route-chip" href="/?route=${encodeURIComponent(r.id)}&name=${encodeURIComponent(r.number)}">${e(r.number)}</a>`).join('')}</div>`:`<p class="muted">${t('noSavedRoutes')}</p>`)}
 ${section(t('myInquiries'),data.inquiries.map(inquiryRow).join('')||`<p class="muted">${t('noInquiries')}</p>`)}
 ${section(t('myReviews'),data.reviews.map(reviewRow).join('')||`<p class="muted">${t('noMyReviews')}</p>`)}</main>`;
 root.querySelectorAll('[data-review-form]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{await api(`/api/reviews/${form.dataset.reviewForm}`,{method:'PATCH',body:JSON.stringify({rating:Number(form.elements.rating.value),text:form.elements.text.value})});editing=null;await load();toast(t('reviewSaved'));}catch(error){form.querySelector('.form-error').textContent=t(error.key||'connectionError');button.disabled=false;}}));
}
async function load(){try{status={...await api('/api/status'),ready:true};if(status.user)data=await api('/api/me');else data=null;failed=false;}catch{failed=true;}render();}
root.addEventListener('click',async event=>{
 const el=event.target.closest('button');if(!el||el.disabled)return;const d=el.dataset;
 if(d.edit){editing=d.edit;render();return;}
 if('cancel' in d){editing=null;render();return;}
 el.disabled=true;
 try{
  if(d.delete){if(!confirm(t('deleteConfirm')))return;await api(`/api/reviews/${d.delete}`,{method:'DELETE'});await load();toast(t('reviewDeleted'));}
  else if('logout' in d){await api('/api/logout',{method:'POST',body:'{}'});location.href='/';}
  else if('withdraw' in d){if(!confirm(t('withdrawConfirm')))return;await api('/api/me/withdraw',{method:'POST',body:JSON.stringify({confirm:true})});try{localStorage.removeItem('jejubus.savedRoutes');}catch{}location.href='/';}
 }catch(error){toast(t(error.key||'connectionError'));}finally{if(el.isConnected)el.disabled=false;}
});
render();await load();
