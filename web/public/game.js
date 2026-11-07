import {art,TYPE_ART,CARD_ART,ART_V} from './art.js';
// 내 제주: 탑승 기록과 도장. 기록은 이 기기에만 저장하고 서버로 보내지 않는다.
// 도장은 "탔어요"를 누른 사용자의 자기 기록이다. 현금 보상, 순위, 위치 추적은 없다.
export const REGIONS=['east','west','south','north'];
const KST=9*3600000;
export function regionOf(lat,lng){
 lat=Number(lat);lng=Number(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
 if(lng>=126.72)return 'east';if(lng<=126.38)return 'west';return lat>=33.38?'north':'south';
}
const hour=at=>new Date(at+KST).getUTCHours(),day=at=>new Date(at+KST).toISOString().slice(0,10);
export function addRide(rides,{no,stopId,lat,lng,at}){
 const today=day(at);
 if(rides.some(r=>r.no===no&&r.stopId===stopId&&day(r.at)===today))return {rides,added:false};
 return {rides:[...rides,{no,stopId,region:regionOf(lat,lng),at}].slice(-500),added:true};
}
export function stampsOf(rides){
 const routes=new Set(rides.map(r=>r.no)),stops=new Set(rides.map(r=>r.stopId)),regions=new Set(rides.map(r=>r.region).filter(Boolean)),hours=rides.map(r=>hour(r.at));
 const list=[['first-ride',rides.length>=1],['new-route',routes.size>=3],['new-stop',stops.size>=5],['first-bus',hours.some(h=>h>=5&&h<7)],['sunset',hours.some(h=>h>=17&&h<19)],['last-bus',hours.some(h=>h>=21||h<1)],['east',regions.has('east')],['west',regions.has('west')],['south',regions.has('south')],['north',regions.has('north')],['four-way',regions.size===4]];
 return list.map(([id,earned])=>({id,earned}));
}
export const newStamps=(before,after)=>{const had=new Set(stampsOf(before).filter(s=>s.earned).map(s=>s.id));return stampsOf(after).filter(s=>s.earned&&!had.has(s.id)).map(s=>s.id);};
export function regionCounts(rides){return Object.fromEntries(REGIONS.map(id=>[id,rides.filter(r=>r.region===id).length]));}
export function titleOf(rides){
 if(rides.length<5)return null;
 const count=regionCounts(rides),top=REGIONS.reduce((a,b)=>count[b]>count[a]?b:a),late=rides.filter(r=>{const h=hour(r.at);return h>=21||h<1;}).length;
 if(late/rides.length>=.4)return 'typeNight';
 return {east:'typeEast',west:'typeWest',south:'typeSouth',north:'typeNorth'}[top];
}
// 공유 카드: 날짜, 시각, 자주 타는 정류장은 넣지 않는다.
export function shareStats(rides){const count=regionCounts(rides);return {rides:rides.length,routes:new Set(rides.map(r=>r.no)).size,stamps:stampsOf(rides).filter(s=>s.earned).length,regions:REGIONS.filter(id=>count[id]>0)};}
const load=src=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src;});
// 공유 카드 그림을 미리 불러온다. 못 불러오면 그림 없이 만든다.
export async function shareImages(rides){const title=titleOf(rides),count=regionCounts(rides),[bg,type,base,...lit]=await Promise.all([load(`/art/share/card-${CARD_ART[title]||'oreum'}.webp?v=${ART_V}`),title?load(`/art/share/type-${TYPE_ART[title]}.webp?v=${ART_V}`):load(`/art/bus/face-happy.webp?v=${ART_V}`),load(`/art/map/jeju-base-gray.webp?v=${ART_V}`),...REGIONS.filter(id=>count[id]).map(id=>load(`/art/map/jeju-${id}.webp?v=${ART_V}`))]);return {bg,type,base,lit:lit.filter(Boolean)};}
export function drawShareCard(canvas,rides,t,images={}){
 const s=shareStats(rides),g=canvas.getContext('2d'),title=titleOf(rides),night=title==='typeNight',ink=night?'#fff':'#2a2c33';canvas.width=720;canvas.height=1080;
 g.fillStyle='#f6ecd8';g.fillRect(0,0,720,1080);if(images.bg)g.drawImage(images.bg,0,0,720,1080);
 g.fillStyle=ink;g.textAlign='center';g.font='800 60px sans-serif';g.fillText(t('gameTitle'),360,110);
 if(title){g.font='700 38px sans-serif';g.fillStyle=night?'#ffc38a':'#a84806';g.fillText(t(title),360,170);}
 g.fillStyle=ink;g.font='700 30px sans-serif';g.fillText(t('gameSummary',{rides:s.rides,routes:s.routes,stamps:s.stamps,total:stampsOf(rides).length}),360,225);
 if(images.base){const w=620,h=w*images.base.height/images.base.width,y=270;g.drawImage(images.base,50,y,w,h);for(const part of images.lit||[])g.drawImage(part,50,y,w,h);}
 if(images.type){const w=300,h=w*images.type.height/images.type.width;g.drawImage(images.type,210,640,w,h);}
 g.fillStyle=ink;g.font='600 26px sans-serif';g.fillText(t('brand'),360,1040);
 return canvas;
}
export function gameMarkup(rides,e,t){
 const stamps=stampsOf(rides),earned=stamps.filter(s=>s.earned).length,count=regionCounts(rides),title=titleOf(rides);
 return `<section class="my-jeju"><span class="eyebrow">MY JEJU</span><h2>${t('gameTitle')}</h2><p class="muted">${t('gameSummary',{rides:rides.length,routes:new Set(rides.map(r=>r.no)).size,stamps:earned,total:stamps.length})}</p>${title?`<p class="game-title title-art">${art(`share/type-${TYPE_ART[title]}`,78)}<span>${t(title)}</span></p>`:''}<div class="region-art" role="img" aria-label="${t('gameRegions')}"><div class="region-stack">${art('map/jeju-base-gray',640)}${REGIONS.filter(id=>count[id]).map(id=>art(`map/jeju-${id}`,640)).join('')}</div><div class="region-labels">${['north','west','east','south'].map(id=>`<span class="${count[id]?'lit':''}">${t(`region_${id}`)} ${count[id]}</span>`).join('')}</div></div><div class="stamp-grid">${stamps.map(s=>`<figure class="stamp ${s.earned?'earned':''}">${art(`stamp/${s.id}`,62)}<figcaption>${t(`stamp_${s.id.replaceAll('-','_')}`)}</figcaption></figure>`).join('')}</div><p class="muted game-note">${t('gamePrivacy')}</p><div class="game-actions"><button data-action="game-off">${t('gameOff')}</button>${rides.length?`<button data-action="game-share">${t('gameShare')}</button><button data-action="game-clear">${t('gameClear')}</button>`:''}</div></section>`;}
