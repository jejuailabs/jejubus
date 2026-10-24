import {icon} from './icons.js';

// Neighbourhood view centres, never bus stops or boarding positions.
const views={airport:[33.507,126.493],cityhall:[33.500,126.531],market:[33.512,126.526],terminal:[33.500,126.515],park:[33.470,126.493]};
let map=null,observer=null,selectedDestination=null,currentLocation=null,locationMarker=null,locationCircle=null,viewport=null,overlay=null,focusKey=null;
export function mapMarkup({t,live=false,summary=''}) {
  return `<div id="real-map" class="real-map" role="region" aria-label="${t('realMap')}"></div>
    <div class="map-top"><div class="map-status"><span class="status-dot"></span><strong>${t('realMap')}</strong><small>OpenStreetMap</small></div></div>
    ${live?`<div class="live-map-card"><div id="map-live-summary" role="status">${summary}</div><button data-action="choose-live-route">${icon('search')}${t('chooseLiveRoute')}</button><p>${icon('bus')}${t('busLegend')} · ${t('stopLegend')}</p><small>${t('liveRefreshHelp')}</small></div>`:''}
    <div id="map-load-error" class="map-load-error" hidden role="alert">${icon('info')}<span>${t('mapLoadError')}</span><button data-action="map-retry">${t('retry')}</button></div>
    <div class="map-note">${icon('info')}<span>${t(live?'liveMapHelp':'mapPickHelp')}</span></div>
    <div class="map-controls"><button data-action="zoom-in" aria-label="${t('zoomIn')}">${icon('plus')}</button><button data-action="zoom-out" aria-label="${t('zoomOut')}">${icon('minus')}</button><span></span><button data-action="map-reset" aria-label="${t('resetMap')}">${icon('locate')}</button></div>`;
}
export function destroyMap(){
  if(map){viewport={center:map.getCenter(),zoom:map.getZoom()};map.remove();}
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
  overlay=L.layerGroup().addTo(map);
  if(onPick)map.on('click',event=>{const point=event.latlng;const box=document.createElement('div');box.className='map-pick';for(const kind of ['origin','destination']){const button=document.createElement('button');button.textContent=t(kind==='origin'?'pickOrigin':'pickDestination');button.addEventListener('click',()=>onPick(kind,{lat:point.lat,lng:point.lng,name:`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}));box.append(button);}L.popup().setLatLng(point).setContent(box).openOn(map);});
  updateMapData(data,t,onStop);
  if(currentLocation)drawLocation(t);
}
export function updateMapData(data={},t,onStop){
  if(!map||!overlay)return;overlay.clearLayers();const L=window.L,bounds=[];
  function point(p,color,radius,label,callback){if(!p||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lng)))return;const ll=[Number(p.lat),Number(p.lng)];bounds.push(ll);const marker=L.circleMarker(ll,{radius,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(overlay);const node=document.createElement('span');node.textContent=label||p.name||'';marker.bindTooltip(node);if(callback)marker.on('click',callback);}
  for(const stop of data.stops||[])point(stop,'#6a819b',5,`${stop.order||''} ${stop.name}`,()=>onStop?.(stop));
  for(const vehicle of data.vehicles||[]){
    if(!Number.isFinite(Number(vehicle.lat))||!Number.isFinite(Number(vehicle.lng)))continue;
    const ll=[Number(vehicle.lat),Number(vehicle.lng)];bounds.push(ll);
    const node=document.createElement('span');node.className='live-bus-symbol';node.innerHTML=icon('bus');
    const number=document.createElement('strong');number.textContent=vehicle.number||data.routeNumber||'';node.append(number);
    const label=`${vehicle.number||data.routeNumber||''} · ${vehicle.id} · ${vehicle.stop||''}`;
    const marker=L.marker(ll,{icon:L.divIcon({className:'live-bus-marker',html:node,iconSize:[44,42],iconAnchor:[22,21]}),title:label,alt:label,zIndexOffset:500}).addTo(overlay);
    const element=marker.getElement();element.dataset.vehicleId=vehicle.id;element.dataset.lat=vehicle.lat;element.dataset.lng=vehicle.lng;
    const tooltip=document.createElement('span');tooltip.textContent=label;marker.bindTooltip(tooltip);marker.on('click',()=>marker.openTooltip());
  }
  point(data.from,'#20a078',8,t('origin'));point(data.to,'#ff785c',8,t('destination'));
  for(const line of data.lines||[]){if(line.length<2)continue;const pts=line.map(p=>[p.lat,p.lng]);L.polyline(pts,{color:'#2167ff',weight:5,opacity:.8}).addTo(overlay);bounds.push(...pts);}
  // A render can recreate the map immediately after a live update. Finish the
  // bounds change synchronously so its saved viewport includes the whole route.
  if(bounds.length&&data.focusKey&&focusKey!==data.focusKey){
    focusKey=data.focusKey;
    const card=document.querySelector('.live-map-card'),size=map.getSize();
    const cardHeight=card?.getBoundingClientRect().height||0;
    const top=Math.min(cardHeight?cardHeight+24:32,Math.max(24,size.y*.4));
    const side=Math.min(35,size.x*.08),bottom=Math.min(55,size.y*.15);
    map.fitBounds(L.latLngBounds(bounds),{paddingTopLeft:[side,top],paddingBottomRight:[side,bottom],maxZoom:16,animate:false});
  }
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
