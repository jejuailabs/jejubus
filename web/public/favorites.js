// 즐겨찾기: 버스·정류장·목적지. 정류장은 도착을 바로 불러와야 해서 개수를 제한한다.
import {busFace} from './board.js';
import {icon} from './icons.js';
export const MAX_STOPS=5,MAX_PLACES=8;
export const placeId=p=>String(p.id||`${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`);
export const toPlace=p=>({id:placeId(p),name:p.name,address:p.address||'',lat:p.lat,lng:p.lng,at:Date.now()});
// 지운 항목을 기억해 다른 기기의 옛 목록이 되살리지 않게 한다.
export const markGone=(gone,key)=>Object.fromEntries(Object.entries({...gone,[key]:Date.now()}).sort((a,b)=>b[1]-a[1]).slice(0,100));
const star=on=>`<span class="fav-star ${on?'is-saved':''}">${icon('star')}</span>`;
const hitRow=(item,index,e,t)=>`<button class="fav-hit" data-fav-toggle="${index}" aria-pressed="${!!item.on}">${item.no?busFace(item.no,e,t):''}<span><strong>${e(item.name)}</strong>${item.sub?`<small>${e(item.sub)}</small>`:''}</span>${star(item.on)}</button>`;
export const favHits=(hits,e,t)=>hits.map((x,i)=>hitRow(x,i,e,t)).join('');
export const savedList=(saved,offset,e,t)=>`<h3 class="tt-section">${t('favSaved')}</h3>${saved.length?saved.map((x,i)=>hitRow({...x,on:true},offset+i,e,t)).join(''):`<p class="muted">${t('favNone')}</p>`}`;
export function favSheet({tab,query,hits,saved},e,t){
 const tabs=[['bus','favBus'],['stop','favStop'],['place','favPlace']];
 return `<div class="form-modal fav-sheet"><h2>${t('favSheetTitle')}</h2><div class="tt-base" role="tablist">${tabs.map(([id,key])=>`<button role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-fav-tab="${id}"><b>${t(key)}</b></button>`).join('')}</div><input id="fav-q" class="tt-input" autocomplete="off" maxlength="40" value="${e(query)}" placeholder="${t(`favHint_${tab}`)}" aria-label="${t(`favHint_${tab}`)}"><div id="fav-hits">${favHits(hits,e,t)}</div><div id="fav-saved">${savedList(saved,hits.length,e,t)}</div></div>`;
}
