// 나의 버스 기록. 이 기기에만 저장하고 서버로 보내지 않는다.
// 환승과 걷기는 기록에서 추정한 값이다. 걷기는 두 정류장 사이 직선거리다.
const LIMIT=300,TRANSFER_MS=3600000,KST=9*3600000;
export const dayOf=at=>new Date(at+KST).toISOString().slice(0,10);
const clock=(at,locale)=>new Date(at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
export const openLeg=legs=>legs.find(l=>!l.offAt)||null;
// 타는 중에는 어느 화면에서나 내렸어요를 누를 수 있게 한다.
export const rideBar=(leg,e,t,locale)=>leg?`<div class="ride-bar" role="status"><b>${e(leg.no)}</b><span>${t('rideNow',{no:e(leg.no)})}<small>${t('logOpen',{stop:e(leg.stopName),time:e(clock(leg.at,locale))})}</small></span><button data-log-off="1">${t('logOff')}</button></div>`:'';
export function startLeg(legs,{no,stopId,stopName,lat,lng,at}){
 const closed=legs.map(l=>l.offAt?l:{...l,offAt:at,auto:true});
 return [...closed,{id:`${at}`,no,stopId,stopName,lat:lat??null,lng:lng??null,at,offAt:null}].slice(-LIMIT);
}
export const finishLeg=(legs,{stopName,lat,lng,at})=>legs.map(l=>l.offAt?l:{...l,offAt:at,offName:stopName,offLat:lat??null,offLng:lng??null});
export function metersBetween(a,b){if(a?.lat==null||b?.lat==null)return null;const r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return Math.round(Math.hypot(x,y)*6371000);}
// 내린 뒤 한 시간 안에 다시 타면 한 여정으로 묶는다.
export function journeysOf(legs){
 const list=[];
 for(const leg of [...legs].sort((a,b)=>a.at-b.at)){
  const last=list.at(-1),prior=last?.legs.at(-1);
  if(prior&&prior.offAt&&leg.at-prior.offAt<=TRANSFER_MS)last.legs.push(leg);else list.push({day:dayOf(leg.at),legs:[leg]});
 }
 return list.reverse();
}
export const tripStats=legs=>({rides:legs.length,routes:new Set(legs.map(l=>l.no)).size,minutes:legs.reduce((n,l)=>n+(l.offAt&&!l.auto?Math.max(0,Math.round((l.offAt-l.at)/60000)):0),0)});
function journeyMarkup(j,e,t,locale){
 return `<ol class="log-line">${j.legs.map((l,i)=>{const prior=j.legs[i-1],walk=prior?metersBetween({lat:prior.offLat,lng:prior.offLng},l):null,wait=prior?Math.max(0,Math.round((l.at-prior.offAt)/60000)):null;
  return `${prior?`<li class="log-gap">${t('logTransfer',{n:wait})}${walk!==null?` · ${t('logWalk',{m:walk})}`:''}</li>`:''}<li class="log-leg"><b>${e(l.no)}</b><div><strong>${e(l.stopName)} → ${e(l.offName||(l.offAt?t('logUnknownOff'):t('logRiding')))}</strong><small>${e(clock(l.at,locale))}${l.offAt&&!l.auto?` ~ ${e(clock(l.offAt,locale))} · ${t('logMinutes',{n:Math.max(0,Math.round((l.offAt-l.at)/60000))})}`:''}${l.ride?.points?` · ${t('qPoints',{n:l.ride.points})}`:''}${l.ride?.kind==='bus'?` · ${t('rideOk')}`:''}</small></div></li>`;}).join('')}</ol>`;
}
export function logMarkup(legs,e,t,locale,now=Date.now()){
 const open=openLeg(legs),journeys=journeysOf(legs),today=journeys.filter(j=>j.day===dayOf(now)),past=journeys.filter(j=>j.day!==dayOf(now)),s=tripStats(legs);
 if(!legs.length)return `<section class="log-card"><h3>${t('logTitle')}</h3><p class="muted">${t('logEmpty')}</p></section>`;
 return `<section class="log-card"><h3>${t('logTitle')}</h3>${open?`<div class="log-open"><div><b>${e(open.no)}</b><span>${t('logOpen',{stop:e(open.stopName),time:e(clock(open.at,locale))})}</span></div><button data-log-off="1">${t('logOff')}</button></div>`:''}${today.length?today.map(j=>journeyMarkup(j,e,t,locale)).join(''):''}<p class="log-stats">${t('logStats',{rides:s.rides,routes:s.routes,minutes:s.minutes})}</p>${past.length?`<details class="log-past"><summary>${t('logPast',{n:past.length})}</summary>${past.slice(0,30).map(j=>`<h4>${e(j.day)}</h4>${journeyMarkup(j,e,t,locale)}`).join('')}<button class="log-clear" data-log-clear="1">${t('logClear')}</button></details>`:''}<p class="log-note">${t('logPrivacy')}</p></section>`;
}
// 내릴 정류장 고르기. 위치를 허용하면 가까운 순으로 올린다. 위치는 이 화면에서만 쓴다.
export function sortByDistance(stops,point){if(!point)return stops;return [...stops].map(s=>({...s,meters:metersBetween(point,s)})).sort((a,b)=>(a.meters??1e9)-(b.meters??1e9));}
export const offSheet=(leg,stops,e,t)=>`<div class="form-modal log-sheet"><h2>${t('logOffTitle',{no:e(leg.no)})}</h2><p class="muted">${t('logOffHelp')}</p><div class="log-stops">${stops.map(s=>`<button data-log-stop="${e(s.id)}"><span>${e(s.name)}</span>${s.meters!=null?`<small>${s.meters}m</small>`:''}</button>`).join('')}</div><button class="log-skip" data-log-skip="1">${t('logSkip')}</button></div>`;
