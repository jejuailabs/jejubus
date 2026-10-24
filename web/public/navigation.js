import {icon} from './icons.js';
import {locales} from './i18n.js';
import {navigationText} from './navigation-copy.js';
import {attachPlaceAutocomplete,createPlaceLookup} from './place-autocomplete.js';
import {prepareRoute,project,pointAt,distance,bearing,createTracker} from './navigation-core.js';
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
const locale=Object.hasOwn(locales,read('jejubus.locale','ko'))?read('jejubus.locale','ko'):'ko',t=(k,v)=>navigationText(locale,k,v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={from:null,to:null,via:null,route:null,tracker:null,fix:null,result:null,mode:'idle',paused:false,follow:true,busy:false,request:0,recommendVersion:0,spots:[],available:false,lastReroute:0,rerouteCount:0,spoken:new Set(),simulation:0};
let map,routeLayer,marker,accuracyCircle,endpointLayer,watchId=null,replayTimer,healthTimer,wake=null,pick=null,recommendBusy=false,wakeRequested=false;
const $=s=>document.querySelector(s),active=()=>['driving','replay'].includes(state.mode),meters=n=>n>=1000?`${(n/1000).toFixed(1)} km`:`${Math.round(n)} m`,mins=n=>`${Math.max(1,Math.ceil(n/60))} ${t('minutes')}`;
async function api(url,body){const res=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const result=await res.json();if(!res.ok)throw Object.assign(Error(result.error),{key:result.error});return result;}
function notice(key){$('#drive-status').textContent=t(key);}
function nav(){return [['explore','search','explore'],['map','bus','liveMap'],['navigation','locate','navigation'],['community','chat','community'],['favorites','star','myBus'],['ai','sparkles','aiChat']].map(([view,i,key])=>`<a class="nav-item ${view==='navigation'?'active':''}" ${view==='navigation'?'aria-current="page"':''} href="${view==='navigation'?'/navigation':`/?view=${view}`}">${icon(i)}<span>${t(key)}</span></a>`).join('');}
function shell(){
 document.documentElement.lang=locale==='zh'?'zh-CN':locale;document.title=`${t('title')} · ${t('brand')}`;
 $('#drive-app').innerHTML=`<header class="site-header"><a class="brand" href="/"><span class="brand-icon">${icon('bus')}</span><span>${t('brand')}<small>JEJU DRIVE</small></span></a><nav class="desktop-nav">${nav()}</nav><div class="header-tools"><button id="drive-theme" class="drive-icon" role="switch" aria-checked="${document.documentElement.dataset.theme==='dark'}" aria-label="${t('themeLabel')}">${icon(document.documentElement.dataset.theme==='dark'?'moon':'sun')}</button><label class="language-picker"><span class="sr-only">${t('language')}</span><select id="drive-language">${Object.entries(locales).map(([v,label])=>`<option value="${v}" ${v===locale?'selected':''}>${label}</option>`).join('')}</select></label></div></header>
 <main class="drive-shell"><section id="drive-controls" class="drive-controls"><div class="drive-heading"><span class="eyebrow">JEJU, ON YOUR WAY</span><h1>${t('title')}<small>BETA</small></h1><p>${t('subtitle')}</p></div><p id="drive-connection" class="drive-connection" role="status">${t('loading')}</p>
 <form id="drive-form"><div class="drive-fields"><label><span class="sr-only">${t('origin')}</span>${icon('locate')}<input id="drive-from" autocomplete="off" placeholder="${t('from')}"><button type="button" id="drive-gps" aria-label="${t('gps')}">${icon('locate')}</button></label><label><span class="sr-only">${t('destination')}</span>${icon('pin')}<input id="drive-to" autocomplete="off" placeholder="${t('to')}"></label></div><div class="drive-row"><select id="drive-priority" aria-label="${t('route')}"><option value="RECOMMEND">${t('recommended')}</option><option value="TIME">${t('fastest')}</option><option value="DISTANCE">${t('distance')}</option></select><button type="button" class="text-btn" id="drive-map-from">${t('mapFrom')}</button><button type="button" class="text-btn" id="drive-map-pick">${t('mapPick')}</button></div><button id="drive-search" class="primary drive-wide" disabled>${icon('search')}${t('route')}</button></form>
 <button id="drive-demo" class="drive-demo">${icon('sparkles')}${t('demo')}<span>→</span></button><p id="drive-status" class="drive-status" role="status" aria-live="polite">${t('select')}</p>
 <section id="drive-trip" hidden><div class="drive-stats"><div><small>${t('eta')}</small><strong id="drive-time">—</strong></div><div><small>${t('remaining')}</small><strong id="drive-distance">—</strong></div></div><small id="drive-source"></small><p class="drive-note">${t('estimated')}</p><p id="drive-via"></p><div class="drive-row"><button id="drive-start" class="primary">${t('start')}</button><button id="drive-stop" class="drive-secondary" hidden>${t('stop')}</button><button id="drive-pause" class="drive-secondary" hidden>${t('pause')}</button><button id="drive-step" class="drive-secondary" hidden>${t('next')}</button><button id="drive-retry" class="drive-secondary" hidden>${t('retryRoute')}</button></div></section>
 <div class="drive-options"><label><input type="checkbox" id="drive-voice">${t('voice')}</label><label><input type="checkbox" id="drive-wake" checked>${t('screen')}</label></div><p class="drive-note">${t('screenHelp')}</p><p class="drive-note">${t('privacy')}</p>
 <section id="drive-discover" hidden><div class="drive-discover-heading"><span class="eyebrow">ALONG THE WAY</span><h2>${t('along')}</h2></div><div class="drive-row"><select id="drive-category" aria-label="${t('spots')}"><option value="FD6">${t('food')}</option><option value="CE7">${t('cafe')}</option><option value="AT4">${t('sights')}</option></select><select id="drive-window" aria-label="${t('spots')}"><option value="5">${t('within5')}</option><option value="10">${t('within10')}</option></select></div><button id="drive-spots" class="drive-secondary drive-wide">${t('spots')}</button><p class="drive-note">${t('spotsHelp')}</p><div id="drive-spots-list" aria-live="polite"></div></section></section>
 <section class="drive-map-wrap" aria-label="${t('navigation')}"><div id="drive-map"></div><div class="drive-turn" id="drive-turn"><span class="drive-arrow">${icon('locate')}</span><div><small id="drive-turn-distance">${t('beta')}</small><strong id="drive-instruction">${t('ready')}</strong></div></div><div id="drive-demo-badge" class="drive-demo-badge" hidden><strong>${t('demoTag')}</strong><span>${t('demoHelp')}</span></div><div class="drive-map-actions"><button id="drive-follow" aria-label="${t('follow')}" title="${t('follow')}">${icon('locate')}</button><button id="drive-overview" aria-label="${t('overview')}" title="${t('overview')}">${icon('map')}</button></div><div class="drive-speed"><strong id="drive-speed">—</strong><span>km/h</span></div></section></main><nav class="mobile-nav">${nav()}</nav>`;
}
function drawMap(){
 if(!window.L){notice('mapFailed');return;}
 map=L.map('drive-map',{zoomControl:false}).setView([33.49,126.53],12);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map).on('tileerror',()=>notice('mapFailed'));
 L.control.zoom({position:'bottomright'}).addTo(map);endpointLayer=L.layerGroup().addTo(map);
 map.on('dragstart',()=>{state.follow=false;});map.on('click',ev=>{if(!pick||active())return;const p={lat:ev.latlng.lat,lng:ev.latlng.lng,name:`${ev.latlng.lat.toFixed(5)}, ${ev.latlng.lng.toFixed(5)}`};selectPlace(pick,p);pick=null;notice('select');});
 new ResizeObserver(()=>map.invalidateSize()).observe($('#drive-map'));
}
function selectPlace(which,place){resetRoute();state[which]=place;$(`#drive-${which}`).value=place.name;drawEndpoints();}
function drawEndpoints(){if(!endpointLayer)return;endpointLayer.clearLayers();for(const [key,color]of [['from','#2167ff'],['to','#f56850'],['via','#00a787']]){const p=state[key];if(p)L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:3,fillColor:color,fillOpacity:1}).bindTooltip(String(p.name||t(key))).addTo(endpointLayer);}}
function clearTrack(){if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}clearInterval(replayTimer);clearInterval(healthTimer);window.speechSynthesis?.cancel();wakeRequested=false;wake?.release().catch(()=>{});wake=null;}
function endTracking(message='ready'){clearTrack();++state.request;++state.recommendVersion;state.busy=false;recommendBusy=false;state.mode=state.route?'preview':'idle';state.paused=false;state.fix=null;state.result=null;$('#drive-speed').textContent='—';$('#drive-instruction').textContent=t(message);notice(message);controls();}
function resetRoute(){endTracking();state.route=null;state.via=null;state.spots=[];state.mode='idle';state.tracker=null;state.spoken.clear();if(routeLayer){routeLayer.remove();routeLayer=null;}if(marker){marker.remove();marker=null;}if(accuracyCircle){accuracyCircle.remove();accuracyCircle=null;}$('#drive-trip').hidden=true;$('#drive-discover').hidden=true;$('#drive-demo-badge').hidden=true;$('#drive-spots-list').replaceChildren();controls();}
function controls(){
 const live=active(),demo=state.route?.synthetic;
 $('#drive-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=live||state.busy);
 $('#drive-search').disabled=!state.available||live||state.busy;
 $('#drive-demo').disabled=state.busy;$('#drive-start').hidden=live||!!demo;$('#drive-start').disabled=state.busy;
 $('#drive-stop').hidden=!live;$('#drive-pause').hidden=state.mode!=='replay';$('#drive-step').hidden=state.mode!=='replay';$('#drive-pause').textContent=t(state.paused?'resume':'pause');
 $('#drive-spots').disabled=state.busy||recommendBusy||!state.route;$('#drive-retry').hidden=state.mode!=='driving';$('#drive-retry').disabled=state.busy;
 document.body.classList.toggle('is-driving',live);$('#drive-demo-badge').hidden=!demo;
}
function setRoute(route){
 state.route=prepareRoute(route);state.tracker=createTracker(state.route);state.result=null;state.spoken.clear();state.spots=[];++state.recommendVersion;$('#drive-spots-list').replaceChildren();
 if(routeLayer)routeLayer.remove();if(map)routeLayer=L.polyline(state.route.points.map(p=>[p.lat,p.lng]),{color:route.synthetic?'#e68c22':'#2167ff',weight:7,opacity:.9}).addTo(map);
 drawEndpoints();$('#drive-trip').hidden=false;$('#drive-discover').hidden=false;$('#drive-time').textContent=mins(route.duration);$('#drive-distance').textContent=meters(route.meters||state.route.length);
 $('#drive-source').textContent=route.synthetic?t('demoTag'):`${route.source} · ${new Date(route.receivedAt).toLocaleTimeString(locale)}${locale==='ko'?'':` · ${t('providerLanguage')}`}`;
 $('#drive-via').replaceChildren();if(state.via){$('#drive-via').append(`${t('via')}: ${state.via.name} `);const button=document.createElement('button');button.className='text-btn';button.textContent=t('remove');button.onclick=()=>requestRoute({removeVia:true});$('#drive-via').append(button);}
 $('#drive-instruction').textContent=t(active()?'continue':'preview');$('#drive-turn-distance').textContent=t('navigation');controls();
}
function overview(){if(routeLayer){state.follow=false;map.fitBounds(routeLayer.getBounds(),{paddingTopLeft:[35,100],paddingBottomRight:[45,65]});}}
async function requestRoute({reroute=false,via,removeVia=false}={}){
 if(state.busy)return;if(!state.to||(!state.from&&!state.fix)){notice('select');return;}
 if(state.route?.synthetic){if(via||removeVia)demoRoute(via);return;}
 const running=state.mode==='driving',from=running?state.fix:state.from;
 if(running&&(!from||Date.now()-from.timestamp>15000||from.accuracy>60)){notice('gpsWeak');return;}
 const waypoint=removeVia?null:via||state.via,version=++state.request;state.busy=true;controls();notice(reroute?'rerouting':'waiting');
 try{const {route}=await api('/api/navigation/route',{from,to:state.to,waypoints:waypoint?[waypoint]:[],priority:$('#drive-priority').value});if(version!==state.request)return;
  state.via=waypoint;state.from=from;setRoute(route);if(!running){state.mode='preview';overview();}else{state.result=null;state.follow=true;}
  notice('continue');
 }catch(error){if(version===state.request){notice(error.key||'connectionError');if(running)$('#drive-instruction').textContent=t('offroute');}}
 finally{if(version===state.request){state.busy=false;controls();}}
}
function speak(text,id){if(!$('#drive-voice').checked||!window.speechSynthesis||state.spoken.has(id)||document.hidden)return;state.spoken.add(id);const u=new SpeechSynthesisUtterance(text);u.lang=state.route&&!state.route.synthetic?'ko-KR':{ko:'ko-KR',en:'en-US',zh:'zh-CN',ja:'ja-JP'}[locale];speechSynthesis.cancel();speechSynthesis.speak(u);}
async function acquireWake(){if(!active()||!$('#drive-wake').checked||document.hidden||wake||wakeRequested)return;if(!navigator.wakeLock){$('#drive-wake').checked=false;$('#drive-wake').parentElement.title=t('screenOff');return;}wakeRequested=true;try{const lock=await navigator.wakeLock.request('screen');if(!active()||!$('#drive-wake').checked){await lock.release();return;}wake=lock;lock.addEventListener('release',()=>{if(wake===lock)wake=null;});}catch{$('#drive-wake').parentElement.title=t('screenOff');}finally{wakeRequested=false;}}
function fixPoint(position){const c=position.coords;return {lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,speed:c.speed,heading:c.heading,timestamp:position.timestamp};}
function showFix(fix){if(!map)return;const p=[fix.lat,fix.lng];if(!marker){marker=L.marker(p,{icon:L.divIcon({className:'drive-user',html:'<span>▲</span>',iconSize:[32,32],iconAnchor:[16,16]}),zIndexOffset:1000}).addTo(map);accuracyCircle=L.circle(p,{radius:fix.accuracy,color:'#2167ff',weight:1,fillOpacity:.08}).addTo(map);}else{marker.setLatLng(p);accuracyCircle.setLatLng(p).setRadius(fix.accuracy);}const arrow=marker.getElement()?.firstChild;if(arrow)arrow.style.transform=`rotate(${Number.isFinite(fix.heading)?fix.heading:0}deg)`;if(state.follow)map.setView(p,Math.max(16,map.getZoom()),{animate:false});}
function acceptFix(fix){
 if(!active()||document.hidden||state.busy)return;
 if(fix.lat<33||fix.lat>34.2||fix.lng<125.8||fix.lng>127.3){notice('outsideJeju');$('#drive-instruction').textContent=t('outsideJeju');return;}
 const result=state.tracker.update(fix);state.result=result;
 if(['weak','stale','jump'].includes(result.quality)){notice('gpsWeak');$('#drive-instruction').textContent=t('gpsWeak');return;}
 state.fix=fix;showFix(fix);$('#drive-speed').textContent=Number.isFinite(fix.speed)?Math.round(Math.max(0,fix.speed)*3.6):'—';
 $('#drive-time').textContent=mins(result.seconds);$('#drive-distance').textContent=meters(result.remaining);
 if(state.via&&distance(fix,state.via)<40){state.via=null;$('#drive-via').replaceChildren();drawEndpoints();}
 if(result.quality==='offroute'){notice('offroute');$('#drive-instruction').textContent=t('offroute');if(result.reroute&&state.mode==='driving'&&state.rerouteCount<5&&Date.now()-state.lastReroute>30000){state.lastReroute=Date.now();state.rerouteCount++;requestRoute({reroute:true});}return;}
 notice(state.mode==='replay'?'demoHelp':'continue');
 const next=result.next;$('#drive-instruction').textContent=next?.type===101?t('destination'):next?.text||t('continue');$('#drive-turn-distance').textContent=meters(result.turnDistance);
 const threshold=result.turnDistance<80?'near':result.turnDistance<300?'ahead':null;
 if(next&&threshold&&next.type!==101)speak(`${Math.round(result.turnDistance/10)*10} ${!state.route.synthetic||locale==='ko'?'미터':locale==='ja'?'メートル':locale==='zh'?'米':'meters'}, ${next.text}`,`${next.along}-${threshold}`);
 if(result.arrived){$('#drive-time').textContent=`0 ${t('minutes')}`;$('#drive-distance').textContent='0 m';endTracking('arrived');speak(t('arrived'),'arrival');}
}
async function start(){
 if(!state.route||state.route.synthetic||state.busy)return;if(!navigator.geolocation){notice('gpsError');return;}
 clearTrack();const version=++state.request;state.mode='driving';state.fix=null;state.tracker=createTracker(state.route);state.rerouteCount=0;state.lastReroute=0;state.follow=true;controls();notice('gpsWaiting');await acquireWake();if(version!==state.request||state.mode!=='driving')return;
 watchId=navigator.geolocation.watchPosition(p=>acceptFix(fixPoint(p)),()=>{notice('gpsError');$('#drive-instruction').textContent=t('gpsError');},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 healthTimer=setInterval(()=>{if(state.mode==='driving'&&(!state.fix||Date.now()-state.fix.timestamp>15000)){notice('stale');$('#drive-instruction').textContent=t('stale');$('#drive-speed').textContent='—';window.speechSynthesis?.cancel();}},5000);
}
function synthetic(points){const r=prepareRoute({points,guides:[],duration:180,synthetic:true});r.duration=r.length/8;r.meters=r.length;r.guides=points.slice(1).map((p,i)=>({along:r.cumulative[i+1],type:i===points.length-2?101:2,text:i===points.length-2?t('arrived'):t(i%2?'turnLeft':'turnRight')}));return r;}
function demoRoute(via){
 const origin=state.route?.synthetic&&state.fix?state.fix:{lat:33.5005,lng:126.519},destination={lat:33.508,lng:126.531,name:t('demoTo')};
 clearTrack();++state.request;state.busy=false;state.mode='replay';state.paused=false;state.simulation=0;state.fix=null;state.from={...origin,name:t('demoFrom')};state.to=destination;state.via=via||null;state.follow=true;
 const points=via?[origin,{lat:origin.lat,lng:via.lng},via,{lat:destination.lat,lng:via.lng},destination]:[origin,{lat:33.5005,lng:126.523},{lat:33.504,lng:126.523},{lat:33.504,lng:126.531},destination];
 $('#drive-from').value=state.from.name;$('#drive-to').value=state.to.name;setRoute(synthetic(points));notice('demoHelp');overview();stepDemo();replayTimer=setInterval(()=>{if(!state.paused&&!document.hidden)stepDemo();},1000);acquireWake();
}
function stepDemo(){if(state.mode!=='replay')return;state.simulation=Math.min(state.route.length,state.simulation+25);const p=pointAt(state.route,state.simulation),next=pointAt(state.route,state.simulation+10);acceptFix({...p,accuracy:5,speed:state.route.length-state.simulation<30?0:8,heading:bearing(p,next),timestamp:Date.now()});}
async function recommendations(){
 if(recommendBusy||!state.route)return;const current=state.fix||state.from;if(state.mode==='driving'&&(!state.fix||Date.now()-state.fix.timestamp>15000)){notice('gpsWeak');return;}
 const version=++state.recommendVersion;recommendBusy=true;controls();$('#drive-spots-list').textContent=t('waiting');
 try{let result;if(state.route.synthetic){result={places:[{id:'demo-cafe',name:t('demoCafe'),address:t('demoTag'),lat:33.506,lng:126.527,seconds:120,extraSeconds:80},{id:'demo-spot',name:t('demoSpot'),address:t('demoTag'),lat:33.507,lng:126.529,seconds:180,extraSeconds:130}]};}
 else{const progress=state.result?.progress||0;result=await api('/api/navigation/recommend',{from:current,to:state.to,center:pointAt(state.route,Math.min(state.route.length,progress+1500)),minutes:Number($('#drive-window').value),category:$('#drive-category').value,priority:$('#drive-priority').value});}
 if(version!==state.recommendVersion)return;state.spots=result.places;$('#drive-spots-list').innerHTML=state.spots.length?state.spots.map((p,i)=>`<article class="drive-spot"><span>${icon('pin')}</span><div><h3>${esc(p.name)}</h3><small>${esc(p.address)}</small><p>${t('reach')} <strong>${mins(p.seconds)}</strong> · ${t('extra')} <strong>+${Math.ceil(p.extraSeconds/60)} ${t('minutes')}</strong></p><button data-drive-spot="${i}" class="text-btn">${t('add')} ${icon('plus')}</button></div></article>`).join(''):`<p>${t('none')}</p>`;
 if(result.partial)$('#drive-spots-list').append(Object.assign(document.createElement('p'),{textContent:t('partial')}));
 }catch(error){if(version===state.recommendVersion)$('#drive-spots-list').textContent=t(error.key||'connectionError');}
 finally{if(version===state.recommendVersion){recommendBusy=false;controls();}}
}
shell();drawMap();
const lookup=createPlaceLookup(async query=>(await api(`/api/places?q=${encodeURIComponent(query)}`)).places);
for(const [which,target]of [['from','origin'],['to','destination']]){const input=$(`#drive-${which}`);attachPlaceAutocomplete(input,{target,t,lookup,isSelected:()=>!!state[which],onSelect:p=>selectPlace(which,p)});input.addEventListener('input',()=>{resetRoute();state[which]=null;drawEndpoints();});}
$('#drive-form').onsubmit=ev=>{ev.preventDefault();requestRoute();};$('#drive-demo').onclick=()=>{resetRoute();demoRoute();};$('#drive-start').onclick=start;$('#drive-stop').onclick=()=>endTracking();
$('#drive-pause').onclick=()=>{state.paused=!state.paused;controls();};$('#drive-step').onclick=()=>{state.paused=true;controls();stepDemo();};
$('#drive-follow').onclick=()=>{state.follow=true;if(state.fix)showFix(state.fix);};$('#drive-overview').onclick=overview;$('#drive-retry').onclick=()=>requestRoute({reroute:true});
$('#drive-spots').onclick=recommendations;$('#drive-spots-list').onclick=ev=>{const button=ev.target.closest('[data-drive-spot]');if(button){const place=state.spots[Number(button.dataset.driveSpot)];if(place)requestRoute({via:place});}};
$('#drive-category').onchange=$('#drive-window').onchange=()=>{++state.recommendVersion;recommendBusy=false;state.spots=[];$('#drive-spots-list').replaceChildren();controls();};
$('#drive-map-from').onclick=()=>{pick='from';notice('chooseMap');$('#drive-map').scrollIntoView({block:'center',behavior:'smooth'});};$('#drive-map-pick').onclick=()=>{pick='to';notice('chooseMap');$('#drive-map').scrollIntoView({block:'center',behavior:'smooth'});};
$('#drive-gps').onclick=()=>{if(!navigator.geolocation){notice('gpsError');return;}const version=state.request;notice('gpsWaiting');navigator.geolocation.getCurrentPosition(p=>{if(version!==state.request||active())return;const fix=fixPoint(p);if(fix.lat<33||fix.lat>34.2||fix.lng<125.8||fix.lng>127.3){notice('outsideJeju');return;}if(fix.accuracy>100){notice('gpsWeak');return;}selectPlace('from',{...fix,name:t('gps')});state.follow=true;showFix(fix);},()=>notice('gpsError'),{enableHighAccuracy:true,maximumAge:0,timeout:15000});};
$('#drive-voice').onchange=()=>{if(!window.speechSynthesis){$('#drive-voice').checked=false;notice('voiceUnsupported');}else if($('#drive-voice').checked)speak(t('voice'),`test-${Date.now()}`);else speechSynthesis.cancel();};
$('#drive-wake').onchange=()=>{$('#drive-wake').checked?acquireWake():wake?.release().catch(()=>{});};
$('#drive-theme').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;$('#drive-theme').setAttribute('aria-checked',String(next==='dark'));$('#drive-theme').innerHTML=icon(next==='dark'?'moon':'sun');try{localStorage.setItem('jejubus.theme',next);}catch{}};
$('#drive-language').onchange=ev=>{endTracking();try{localStorage.setItem('jejubus.locale',JSON.stringify(ev.target.value));}catch{}location.reload();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active()){window.speechSynthesis?.cancel();state.fix=null;notice('hidden');$('#drive-instruction').textContent=t('hidden');}else if(active())acquireWake();});
window.addEventListener('pagehide',()=>{clearTrack();++state.request;++state.recommendVersion;});
window.addEventListener('pageshow',ev=>{if(ev.persisted){endTracking();notice('gpsWaiting');}});
try{const status=await api('/api/status');state.available=!!status.capabilities?.navigation;$('#drive-connection').textContent=t(state.available?'connected':'disabled');controls();}catch{notice('connectionError');}
