import {icon} from './icons.js';

// 챗봇 답에 나온 곳을 한 지도 모달에 모두 띄운다. 선택지는 번호를 달고, 눌러서 바로 고를 수 있다.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let dialog=null,map=null;
const ROLE={choice:'chat-pin-choice',board:'chat-pin-board',off:'chat-pin-off',dest:'chat-pin-dest',from:'chat-pin-from',stop:'chat-pin-stop',me:'chat-pin-me'};
export function placesList({choices=[],points=[],me=null}){
 const list=choices.map((c,i)=>Number.isFinite(c.lat)?{name:c.name,sub:c.address||c.end||'',lat:c.lat,lng:c.lng,role:'choice',mark:String(i+1),choice:i}:null).filter(Boolean);
 for(const p of points)if(!list.some(x=>Math.abs(x.lat-p.lat)<1e-5&&Math.abs(x.lng-p.lng)<1e-5))list.push({...p,mark:p.role==='board'||p.role==='off'?p.label:''});
 if(me&&Number.isFinite(me.lat))list.push({name:'',lat:me.lat,lng:me.lng,role:'me',mark:''});
 return list;
}
const roleText=(p,t)=>p.role==='choice'?t('chatPinChoice'):p.role==='board'?t('chatPinBoard',{no:p.label}):p.role==='off'?t('chatPinOff',{no:p.label}):p.role==='dest'?t('destination'):p.role==='from'?t('origin'):p.role==='me'?t('chatPinMe'):t('chatPinStop');
export function openPlacesMap({t,me,choices,points,onChoose,onStop}){
 const L=window.L,list=placesList({choices,points,me});if(!L||!list.length)return;
 if(!dialog){dialog=document.createElement('dialog');dialog.className='chat-map-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>{map?.remove();map=null;dialog.innerHTML='';});dialog.addEventListener('click',ev=>{if(ev.target===dialog)dialog.close();});}
 const named=list.filter(p=>p.role!=='me');
 dialog.innerHTML=`<div class="chat-map"><header><h2>${t('chatMapTitle',{n:named.length})}</h2><button class="chat-icon" data-map-close aria-label="${t('close')}">${icon('close')}</button></header><div class="chat-map-canvas"></div><ol class="chat-map-list">${named.map((p,i)=>`<li><button data-map-focus="${i}"><i class="chat-pin ${ROLE[p.role]}">${esc(p.mark)}</i><span><strong>${esc(p.name)}</strong><small>${esc(roleText(p,t))}${p.sub?' · '+esc(p.sub):''}</small></span></button>${p.role==='choice'?`<button class="chat-map-pick" data-map-pick="${p.choice}">${t('chatPick')}</button>`:(p.role==='stop'||p.role==='board'||p.role==='off')&&p.id?`<button class="chat-map-pick" data-map-stop="${i}">${t('chatSeeStop')}</button>`:''}</li>`).join('')}</ol></div>`;
 dialog.showModal();
 map=L.map(dialog.querySelector('.chat-map-canvas'),{zoomControl:false,attributionControl:true});
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; OpenStreetMap'}).addTo(map);
 L.control.zoom({position:'bottomright'}).addTo(map);
 const markers=list.map(p=>L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:`<i class="chat-pin ${ROLE[p.role]}">${esc(p.mark)}</i>`,iconSize:[30,30],iconAnchor:[15,15]}),title:p.name}).addTo(map));
 const focus=i=>{const p=named[i];map.setView([p.lat,p.lng],Math.max(map.getZoom(),16));dialog.querySelectorAll('[data-map-focus]').forEach((b,j)=>b.classList.toggle('on',j===i));};
 markers.forEach((m,j)=>{const i=named.indexOf(list[j]);if(i>=0)m.on('click',()=>{focus(i);dialog.querySelectorAll('[data-map-focus]')[i]?.scrollIntoView({block:'nearest',behavior:'smooth'});});});
 requestAnimationFrame(()=>{map.invalidateSize();const pts=list.map(p=>[p.lat,p.lng]);if(pts.length===1)map.setView(pts[0],16);else map.fitBounds(pts,{padding:[34,34],maxZoom:16});});
 dialog.onclick=ev=>{const b=ev.target.closest('button');if(!b)return;
  if(b.dataset.mapClose!==undefined)dialog.close();
  else if(b.dataset.mapFocus)focus(Number(b.dataset.mapFocus));
  else if(b.dataset.mapPick){dialog.close();onChoose?.(Number(b.dataset.mapPick));}
  else if(b.dataset.mapStop){const p=named[Number(b.dataset.mapStop)];dialog.close();onStop?.(p);}
  else if(ev.target===dialog)dialog.close();};
}
