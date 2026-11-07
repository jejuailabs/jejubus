import {gradeOf,pinClass,pinInner} from './board.js';
import {icon} from './icons.js';

// Neighbourhood view centres, never bus stops or boarding positions.
const views={airport:[33.507,126.493],cityhall:[33.500,126.531],market:[33.512,126.526],terminal:[33.500,126.515],park:[33.470,126.493]};
const LEGEND=['hub','express','trunk','branch','tour','one'];let stopFilter=null,lastStops=null;
let stopLayer=null,stopTimer=null,stopRequest=0,stopsOn=true,stopContext={};const stopCache=new Map();
let map=null,observer=null,selectedDestination=null,currentLocation=null,locationMarker=null,locationCircle=null,viewport=null,overlay=null,focusKey=null;
export function mapMarkup({t,live=false,bar=''}) {
  return `<div id="real-map" class="real-map" role="region" aria-label="${t('realMap')}"></div>
    <div class="map-top"><div class="map-status"><span class="status-dot"></span><strong>${t('realMap')}</strong><small id="map-stop-count">OpenStreetMap</small></div></div>
    ${live?bar:''}<div id="stop-legend" ${live?'hidden':''} class="stop-legend" role="group" aria-label="${t('stopLegend')}">${LEGEND.map(id=>`<button data-stop-filter="${id}" aria-pressed="${stopFilter===id}" class="${stopFilter===id?'on':''}"><span class="stop-pin ${id==='hub'?'kind-hub pin-trunk':id==='one'?'kind-one pin-branch':`kind-some pin-${id}`}">${id==='hub'?'<i aria-hidden="true">⇄</i>':''}</span>${t(`stopLegend_${id}`)}</button>`).join('')}</div>
    <div id="map-load-error" class="map-load-error" hidden role="alert">${icon('info')}<span>${t('mapLoadError')}</span><button data-action="map-retry">${t('retry')}</button></div>
    ${live?'':`<div class="map-note">${icon('info')}<span>${t('mapPickHelp')}</span></div>`}
    <div class="map-controls"><button data-action="zoom-in" aria-label="${t('zoomIn')}">${icon('plus')}</button><button data-action="zoom-out" aria-label="${t('zoomOut')}">${icon('minus')}</button><span></span><button data-action="map-reset" aria-label="${t('resetMap')}">${icon('locate')}</button></div>`;
}
export function destroyMap(){
  if(map){viewport={center:map.getCenter(),zoom:map.getZoom()};map.eachLayer(layer=>{if(!(layer instanceof L.Renderer))map.removeLayer(layer);});map.eachLayer(layer=>{if(layer instanceof L.Renderer&&layer._redrawRequest){L.Util.cancelAnimFrame(layer._redrawRequest);layer._redrawRequest=null;}});map.remove();}
  clearTimeout(stopTimer);stopLayer=null;
  observer?.disconnect();map=null;locationMarker=null;locationCircle=null;
}
export function mountMap({destination,t,data={},onPick,onStop,tilesUrl='https://tile.openstreetmap.org/{z}/{x}/{y}.png'}){
  const container=document.querySelector('#real-map');if(!container)return;
  if(!container.getBoundingClientRect().width||!container.getBoundingClientRect().height)return;
  const L=window.L;
  if(!L){document.querySelector('#map-load-error').hidden=false;return;}
  map=L.map(container,{zoomControl:false,minZoom:7,maxZoom:19,preferCanvas:true});
  if(destination!==selectedDestination){map.setView(views[destination]||[33.500,126.520],14);selectedDestination=destination;}
  else if(viewport)map.setView(viewport.center,viewport.zoom);
  else map.setView([33.500,126.520],13);
  const layer=L.tileLayer(tilesUrl,{maxZoom:19,keepBuffer:1,updateWhenIdle:true,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
  let loaded=0,failed=0;
  layer.on('tileload',()=>{loaded++;const el=document.querySelector('#map-load-error');if(el)el.hidden=true;});
  layer.on('tileerror',()=>{failed++;});
  layer.on('load',()=>{const el=document.querySelector('#map-load-error');if(el)el.hidden=loaded>0||failed===0;});
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  observer=new ResizeObserver(()=>{if(map)map.invalidateSize({pan:false});});observer.observe(container);
  stopLayer=L.layerGroup().addTo(map);overlay=L.layerGroup().addTo(map);
  document.querySelector('#stop-legend')?.addEventListener('click',event=>{const button=event.target.closest('[data-stop-filter]');if(!button)return;stopFilter=stopFilter===button.dataset.stopFilter?null:button.dataset.stopFilter;document.querySelectorAll('[data-stop-filter]').forEach(b=>{const on=b.dataset.stopFilter===stopFilter;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});if(lastStops)drawStops(...lastStops);});
  map.on('moveend',()=>{clearTimeout(stopTimer);stopTimer=setTimeout(loadStops,180);});
  if(onPick)map.on('click',event=>{const point=event.latlng;const box=document.createElement('div');box.className='map-pick';for(const kind of ['origin','destination']){const button=document.createElement('button');button.textContent=t(kind==='origin'?'pickOrigin':'pickDestination');button.addEventListener('click',()=>onPick(kind,{lat:point.lat,lng:point.lng,name:`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}));box.append(button);}L.popup().setLatLng(point).setContent(box).openOn(map);});
  updateMapData(data,t,onStop);
  if(currentLocation)drawLocation(t);
}
export function updateMapData(data={},t,onStop){
  if(!map||!overlay)return;overlay.clearLayers();const L=window.L,bounds=[];
  stopContext={t,onStop,mine:data.myStops||[]};const show=!data.live&&!data.routeNumber&&!data.lines?.length;if(show!==stopsOn||!stopLayer?.getLayers().length){stopsOn=show;loadStops();}
  function point(p,color,radius,label,callback){if(!p||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lng)))return;const ll=[Number(p.lat),Number(p.lng)];bounds.push(ll);const marker=L.circleMarker(ll,{radius,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(overlay);const node=document.createElement('span');node.textContent=label||p.name||'';marker.bindTooltip(node);if(callback)marker.on('click',callback);}
  for(const stop of data.stops||[]){if(show&&(data.stops.length>1||stop.lat===undefined)){const ll=[Number(stop.lat),Number(stop.lng)];if(ll.every(Number.isFinite))bounds.push(ll);continue;}point(stop,show?'#c2540a':'#6a819b',show?10:5,`${stop.order||''} ${stop.name}`,()=>onStop?.(stop));}
  for(const vehicle of data.vehicles||[]){
    if(!Number.isFinite(Number(vehicle.lat))||!Number.isFinite(Number(vehicle.lng)))continue;
    const ll=[Number(vehicle.lat),Number(vehicle.lng)];bounds.push(ll);
    const node=document.createElement('span');const grade=gradeOf(vehicle.number||data.routeNumber||'');node.className='live-bus-symbol art-bus';node.innerHTML=`<img src="/art/bus/bus-${grade==='other'?'trunk':grade}.webp" alt="">`;
    const number=document.createElement('strong');number.textContent=vehicle.number||data.routeNumber||'';node.append(number);
    const label=`${vehicle.number||data.routeNumber||''} · ${vehicle.id} · ${vehicle.stop||''}`;
    const marker=L.marker(ll,{icon:L.divIcon({className:'live-bus-marker',html:node,iconSize:[50,48],iconAnchor:[25,24]}),title:label,alt:label,zIndexOffset:500}).addTo(overlay);
    const element=marker.getElement();element.dataset.vehicleId=vehicle.id;element.dataset.lat=vehicle.lat;element.dataset.lng=vehicle.lng;
    const tooltip=document.createElement('span');tooltip.textContent=label;marker.bindTooltip(tooltip);marker.on('click',()=>marker.openTooltip());
  }
  point(data.from,'#20a078',8,t('origin'));point(data.to,'#ff785c',8,t('destination'));
  for(const line of data.lines||[]){if(line.length<2)continue;const pts=line.map(p=>[p.lat,p.lng]);L.polyline(pts,{color:'#c2540a',weight:5,opacity:.85}).addTo(overlay);bounds.push(...pts);}
  // A render can recreate the map immediately after a live update. Finish the
  // bounds change synchronously so its saved viewport includes the whole route.
  if(bounds.length&&data.focusKey&&focusKey!==data.focusKey){
    focusKey=data.focusKey;
    const card=document.querySelector('.live-bar'),size=map.getSize();
    const cardHeight=card?.getBoundingClientRect().height||0;
    const top=Math.min(cardHeight?cardHeight+24:32,Math.max(24,size.y*.4));
    const side=Math.min(35,size.x*.08),bottom=Math.min(55,size.y*.15);
    map.fitBounds(L.latLngBounds(bounds),{paddingTopLeft:[side,top],paddingBottomRight:[side,bottom],maxZoom:16,animate:false});
  }
}
// 화면에 보이는 정류장. 칸을 넓게 잡아 조금 움직여도 같은 응답을 다시 쓴다.
async function loadStops(){
 if(!map||!stopLayer)return;
 if(!stopsOn){stopLayer.clearLayers();stopCount(null);return;}
 const b=map.getBounds(),zoom=Math.round(map.getZoom()),step=zoom>=15?.01:zoom>=12?.05:.5,down=x=>(Math.floor(x/step)*step).toFixed(2),up=x=>(Math.ceil(x/step)*step).toFixed(2),key=`${down(b.getSouth())},${down(b.getWest())},${up(b.getNorth())},${up(b.getEast())}`,cacheKey=`${key}:${zoom}`,request=++stopRequest;
 try{
  if(!stopCache.has(cacheKey)){const response=await fetch(`/api/board/map?b=${key}&z=${zoom}`);if(!response.ok)throw new Error('stops');if(stopCache.size>40)stopCache.clear();stopCache.set(cacheKey,await response.json());}
  if(request===stopRequest&&map)drawStops(stopCache.get(cacheKey),zoom);
 }catch{if(request===stopRequest){stopLayer?.clearLayers();lastStops=null;const el=document.querySelector('#map-stop-count');if(el)el.textContent=stopContext.t?.('mapStopsError')||'';clearTimeout(stopTimer);stopTimer=setTimeout(loadStops,5000);}}
}
function stopCount(data){const el=document.querySelector('#map-stop-count'),t=stopContext.t;if(!el||!t)return;el.textContent=!data?'OpenStreetMap':t(data.thinned?'mapStopsThin':'mapStops',{n:data.stops.length});}
function drawStops(data,zoom){lastStops=[data,zoom];
 const L=window.L,{onStop,mine=[]}=stopContext,view=map.getBounds().pad(.1),far=zoom<14;stopLayer.clearLayers();
 const match=s=>!stopFilter||(stopFilter==='hub'?s.kind==='hub':stopFilter==='one'?s.kind==='one':s.grade===stopFilter);
 const visible=data.stops.filter(s=>view.contains([s.lat,s.lng])&&match(s));
 for(const stop of visible){
  const own=mine.includes(stop.id),html=`<span class="${pinClass(stop)} ${far?'far':''} ${own?'mine':''}">${far?'':pinInner(stop)}</span>`;
  const marker=L.marker([stop.lat,stop.lng],{title:stop.name,alt:stop.name,icon:L.divIcon({className:'stop-marker',html,iconSize:[0,0]}),zIndexOffset:own?400:stop.kind==='hub'?300:stop.kind==='many'?200:stop.kind==='some'?100:0});
  const label=document.createElement('span');label.textContent=stop.name;marker.bindTooltip(label,zoom>=17?{permanent:true,direction:'bottom',offset:[0,14],className:'stop-label'}:{direction:'top',offset:[0,-10]});
  marker.on('click',()=>onStop?.({id:stop.id,name:stop.name,number:stop.number,lat:stop.lat,lng:stop.lng}));marker.addTo(stopLayer);
 }
 stopCount({stops:visible,thinned:data.thinned});
}
function drawLocation(t){
  if(!map||!currentLocation)return;
  const L=window.L,{lat,lng,accuracy}=currentLocation;
  locationMarker?.remove();locationCircle?.remove();
  locationCircle=L.circle([lat,lng],{radius:accuracy,color:'#2167ff',weight:1,fillOpacity:.08}).addTo(map);
  locationMarker=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#2167ff',fillOpacity:1}).addTo(map);
  const label=document.createElement('span');label.textContent=t('current');locationMarker.bindTooltip(label);
}
export function locateOnMap(coords,t){
  currentLocation={lat:coords.latitude,lng:coords.longitude,accuracy:coords.accuracy};
  if(map){drawLocation(t);map.setView([coords.latitude,coords.longitude],16);}
}
export function mapAction(action){
  if(!map)return;
  if(action==='zoom-in')map.zoomIn();
  if(action==='zoom-out')map.zoomOut();
  if(action==='map-reset')map.setView(views[selectedDestination]||[33.500,126.520],14);
}
