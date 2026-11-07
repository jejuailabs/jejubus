import {icon} from './icons.js';

// 글쓰기의 "어느 버스·정류장 이야기인가요?" 칸. 글자를 치면 정류장·노선 후보가 아래로 펼쳐진다.
export function pickerMarkup({value='general',name=''},t,e){
 return `<div class="ctx-pick"><span class="ctx-label" id="ctx-label">${t('ctxWhich')}</span><input type="hidden" name="route" value="${e(value)}"><div class="ctx-chip"><span class="ctx-chip-name">${e(value==='general'?t('general'):name)}</span>${value==='general'?'':`<button type="button" class="ctx-clear" aria-label="${t('close')}">×</button>`}</div><div class="ctx-box">${icon('search')}<input class="ctx-q" autocomplete="off" maxlength="40" placeholder="${t('ctxPlaceholder')}" aria-labelledby="ctx-label" role="combobox" aria-expanded="false" aria-controls="ctx-list"></div><div class="ctx-list" id="ctx-list" role="listbox" hidden></div></div>`;
}
export function groupResults({routes=[],stops=[]},t){
 const out=[];
 if(stops.length)out.push({head:t('stopMode')},...stops.map(s=>({id:`stop:${s.id}`,name:s.name,sub:s.next?t('ctxToward',{next:s.next}):'',kind:'stop'})));
 if(routes.length)out.push({head:t('route')},...routes.map(r=>({id:`route:${r.id}`,name:r.number,sub:r.start&&r.end?`${r.start} → ${r.end}`:'',kind:'route'})));
 out.push({head:t('ctxOther')},{id:'general',name:t('general'),sub:'',kind:'general'});
 return out;
}
export function mountPicker(root,{t,e,api,quick}){
 if(!root)return;
 const hidden=root.querySelector('input[name=route]'),q=root.querySelector('.ctx-q'),list=root.querySelector('.ctx-list'),chip=root.querySelector('.ctx-chip');
 let items=[],timer=null,seq=0,active=-1;
 const close=()=>{list.hidden=true;q.setAttribute('aria-expanded','false');active=-1;};
 const draw=rows=>{items=rows.filter(r=>!r.head);let i=-1;list.innerHTML=rows.map(r=>r.head?`<div class="ctx-head">${e(r.head)}</div>`:`<button type="button" role="option" data-i="${++i}" class="ctx-opt ${hidden.value===r.id?'on':''}"><i class="ctx-ic ctx-${r.kind}">${r.kind==='route'?icon('bus'):r.kind==='stop'?icon('pin'):icon('chat')}</i><span><strong>${e(r.name)}</strong>${r.sub?`<small>${e(r.sub)}</small>`:''}</span></button>`).join('')||`<p class="ctx-empty">${t('ctxNone')}</p>`;list.hidden=false;q.setAttribute('aria-expanded','true');};
 const choose=r=>{hidden.value=r.id;chip.innerHTML=`<span class="ctx-chip-name">${e(r.kind==='stop'&&r.sub?`${r.name} (${r.sub})`:r.kind==='route'?`${t('route')} ${r.name}`:r.name)}</span>${r.id==='general'?'':`<button type="button" class="ctx-clear" aria-label="${t('close')}">×</button>`}`;q.value='';close();};
 const showQuick=()=>{const rows=quick();draw([{head:t('ctxQuick')},...rows.map(r=>({...r,sub:''}))]);};
 const search=async()=>{const text=q.value.trim();if(!text){showQuick();return;}if(text.length<2&&!/\d/.test(text))return;const mine=++seq;list.hidden=false;list.innerHTML=`<p class="ctx-empty">…</p>`;try{const r=await api(`/api/contexts?q=${encodeURIComponent(text)}`);if(mine===seq)draw(groupResults(r,t));}catch{if(mine===seq)list.innerHTML=`<p class="ctx-empty">${t('connectionError')}</p>`;}};
 q.addEventListener('focus',()=>{if(!q.value.trim())showQuick();});
 q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,200);});
 q.addEventListener('keydown',ev=>{const opts=[...list.querySelectorAll('.ctx-opt')];if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();if(!opts.length)return;active=(active+(ev.key==='ArrowDown'?1:-1)+opts.length)%opts.length;opts.forEach((o,i)=>o.classList.toggle('focus',i===active));opts[active].scrollIntoView({block:'nearest'});}else if(ev.key==='Enter'){ev.preventDefault();if(active>=0&&items[active])choose(items[active]);}else if(ev.key==='Escape')close();});
 list.addEventListener('mousedown',ev=>ev.preventDefault());
 list.addEventListener('click',ev=>{const b=ev.target.closest('.ctx-opt');if(b)choose(items[Number(b.dataset.i)]);});
 chip.addEventListener('click',ev=>{if(ev.target.closest('.ctx-clear'))choose({id:'general',name:t('general'),kind:'general'});});
 q.addEventListener('blur',()=>setTimeout(close,150));
}
