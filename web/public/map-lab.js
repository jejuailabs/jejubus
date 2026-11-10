// 지도 실험 화면: 실제 지도 위 노선, 줌별 구체화, 도보 범위 확대 경로 찾기.
import {indexNetwork,search,stopsWithin,numbersAt,radiusOf,distanceM,directionGroups,numberFamilies,searchNumbers,baseNumber} from './map-lab-search.js';
import {gradeOf} from './board.js';

const maplibregl=window.maplibregl;
maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js');
const $=s=>document.querySelector(s);
const WALK_STEPS=[0,5,10],CAP=8,Z_ISLAND=11.3,Z_ROUTES=13.6,Z_NAMES=15.6;
const GRADE_COLOR={express:'#e5484d',trunk:'#2f6fed',branch:'#2fa36b',tour:'#c99600',other:'#6b7688'},GRADE_ORDER=['express','trunk','branch','tour','other'];
const HUE={express:[-22,40],trunk:[196,60],branch:[92,80],tour:[40,12],other:[268,50]};
const END_NAME={from:'출발',to:'도착'};
// 대표 버튼. 승객 수 자료가 없어 시간표 운행 횟수와 노선의 역할로 골랐다.
const QUICK=[{id:'ring',label:'일주 동·서',numbers:['201','202']},{id:'peace',label:'평화로',numbers:['251','252','253','254','282']},{id:'516',label:'5·16 도로',numbers:['281']},{id:'express',label:'급행',numbers:['101','102','111','121','122','131','132','151','181','182']},{id:'limo',label:'공항 리무진',numbers:['600','601']},{id:'uni',label:'제주대 축',numbers:['360','365']}];
const state={from:null,to:null,walk:{from:0,to:0},result:null,baseline:0,selected:0,sheet:null,near:false,number:null,prevSheet:null,render:null,quick:null};
let net,segs,map,pins={},stopovers=[],labelMarkers=[];
const overflow=[],lineNumbers=new Map(),pairNumbers=new Map();let families;

function h(tag,props={},...children){const el=document.createElement(tag);for(const [k,v]of Object.entries(props)){if(k==='class')el.className=v;else if(k==='on')for(const [e,f]of Object.entries(v))el.addEventListener(e,f);else if(k==='style')el.style.cssText=v;else if(v!==false&&v!==null&&v!==undefined)el.setAttribute(k,v===true?'':v);}el.append(...children.flat().filter(c=>c!==null&&c!==undefined&&c!==false));return el;}
const natural=(a,b)=>a.localeCompare(b,'ko',{numeric:true});
function numberSeed(no){let n=0;for(const c of no)n=n*31+c.charCodeAt(0)|0;return Math.abs(n);}
function lineColor(no){const g=gradeOf(no),[h0,span]=HUE[g],seed=numberSeed(no),f=x=>(seed*x)%1;return `hsl(${Math.round(h0+span*f(.618034)+360)%360} ${Math.round(70+20*f(.7548))}% ${Math.round(36+16*f(.381966))}%)`;}
const gradeRank=no=>GRADE_ORDER.indexOf(gradeOf(no));
const byImportance=(a,b)=>gradeRank(a)-gradeRank(b)||natural(a,b);
const segKey=(a,b)=>a*100000+b;

function decode(raw){const m=new Map();for(const [a,b,flat]of raw){const pts=[[flat[0],flat[1]]];for(let i=2;i<flat.length;i+=2){const p=pts.at(-1);pts.push([p[0]+flat[i],p[1]+flat[i+1]]);}m.set(segKey(a,b),pts.map(([x,y])=>[x/1e5,y/1e5]));}return m;}
const line=(coords,props)=>({type:'Feature',properties:props,geometry:{type:'LineString',coordinates:coords}});
const point=(p,props)=>({type:'Feature',properties:props,geometry:{type:'Point',coordinates:[p.lng,p.lat]}});
const fc=features=>({type:'FeatureCollection',features});

function buildNetworkLayers(){
 const directed=new Map(),pairs=new Map();
 for(const v of net.variants)for(let i=1;i<v.stops.length;i++){const a=v.stops[i-1],b=v.stops[i],k=segKey(a,b);if(!segs.has(k))continue;if(!directed.has(k))directed.set(k,new Set());directed.get(k).add(v.no);const sa=net.stops[a].station,sb=net.stops[b].station;if(sa===sb)continue;const pk=sa<sb?segKey(sa,sb):segKey(sb,sa);if(!pairs.has(pk))pairs.set(pk,{k,nos:new Set()});pairs.get(pk).nos.add(v.no);}
 const routeFeatures=[],corridors=[];
 for(const [k,set]of directed){const nos=[...set].sort(byImportance),coords=segs.get(k);lineNumbers.set(k,nos);nos.slice(0,CAP).forEach((no,r)=>routeFeatures.push(line(coords,{k,no,c:lineColor(no),off:r+.5})));if(nos.length>CAP){const mid=coords[Math.floor(coords.length/2)];overflow.push({lng:mid[0],lat:mid[1],more:nos.length-CAP,total:nos.length});}}
 for(const [pk,{k,nos}]of pairs){const list=[...nos].sort(byImportance);pairNumbers.set(pk,list);const grade=GRADE_ORDER.find(g=>list.some(n=>gradeOf(n)===g)),top=list.some(n=>gradeOf(n)==='express'||n==='201'||n==='202');corridors.push(line(segs.get(k),{pk,load:list.length,c:GRADE_COLOR[grade],top:top?1:0}));}
 overflow.sort((a,b)=>b.total-a.total);
 const stopFeatures=[];for(const s of net.stops){if(s.virtual||!net.at[s.i].length)continue;const n=numbersAt(net,s.i).length;stopFeatures.push(point(s,{i:s.i,n,hub:n>=12||/환승정류장|환승센터|버스터미널|제주국제공항/.test(s.name)?1:0}));}
 return {routeFeatures,corridors,stopFeatures};
}

function chevronImage(){const size=26,c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');g.strokeStyle='#fff';g.lineWidth=4;g.lineCap='round';g.lineJoin='round';g.beginPath();g.moveTo(9,6);g.lineTo(17,13);g.lineTo(9,20);g.stroke();return g.getImageData(0,0,size,size);}

function addLayers({routeFeatures,corridors,stopFeatures}){
 const empty=fc([]);
 for(const [id,data]of [['corridors',fc(corridors)],['routes',fc(routeFeatures)],['stops',fc(stopFeatures)],['area',empty],['candidates',empty],['near',empty],['hi',empty],['hi-stops',empty],['walks',empty]])map.addSource(id,{type:'geojson',data,tolerance:.3});
 const round={'line-join':'round','line-cap':'round'};
 map.addImage('chev',chevronImage());
 map.addLayer({id:'corridor-top',type:'line',source:'corridors',maxzoom:Z_ISLAND,filter:['==',['get','top'],1],layout:round,paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],8,1,11,2.6],'line-opacity':.9}});
 map.addLayer({id:'corridor-all',type:'line',source:'corridors',minzoom:Z_ISLAND,maxzoom:Z_ROUTES,layout:round,paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['get','load'],1,.9,5,2,10,3.4,20,6,45,9.5],'line-opacity':['interpolate',['linear'],['get','load'],1,.45,5,.8,10,.95]}});
 map.addLayer({id:'route-lines',type:'line',source:'routes',minzoom:Z_ROUTES,layout:{'line-join':'round','line-cap':'butt'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],Z_ROUTES,1.1,16,2,18,3],'line-offset':['interpolate',['linear'],['zoom'],Z_ROUTES,['*',['get','off'],1.4],16,['*',['get','off'],2.3],18,['*',['get','off'],3.4]],'line-opacity':.92}});
 map.addLayer({id:'area-fill',type:'fill',source:'area',paint:{'fill-color':['get','c'],'fill-opacity':.11}});
 map.addLayer({id:'area-line',type:'line',source:'area',paint:{'line-color':['get','c'],'line-width':1.6,'line-dasharray':[2,2],'line-opacity':.8}});
 map.addLayer({id:'near-lines',type:'line',source:'near',layout:{'line-join':'round','line-cap':'butt'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],11,1.5,16,3,18,4.6],'line-offset':['interpolate',['linear'],['zoom'],11,['*',['get','off'],1.5],16,['*',['get','off'],3.2],18,['*',['get','off'],5]]}});
 map.addLayer({id:'stops-hub',type:'circle',source:'stops',minzoom:Z_ISLAND,maxzoom:14,filter:['==',['get','hub'],1],paint:{'circle-radius':['interpolate',['linear'],['zoom'],11.3,2.2,14,4.5],'circle-color':'#fff','circle-stroke-color':'#1c2531','circle-stroke-width':1.2}});
 map.addLayer({id:'stops-all',type:'circle',source:'stops',minzoom:14,paint:{'circle-radius':['interpolate',['linear'],['zoom'],14,['case',['==',['get','hub'],1],4.5,2.6],17,['case',['==',['get','hub'],1],8,6]],'circle-color':'#fff','circle-stroke-color':'#1c2531','circle-stroke-width':['interpolate',['linear'],['zoom'],14,1,17,1.8]}});
 map.addLayer({id:'hi-casing',type:'line',source:'hi',layout:round,paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],9,6,14,10,18,15]}});
 map.addLayer({id:'hi-line',type:'line',source:'hi',layout:round,paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,3.6,14,6.5,18,11]}});
 map.addLayer({id:'hi-arrows',type:'symbol',source:'hi',minzoom:10.5,layout:{'symbol-placement':'line','symbol-spacing':64,'icon-image':'chev','icon-size':['interpolate',['linear'],['zoom'],10.5,.35,14,.5,18,.8],'icon-allow-overlap':true,'icon-rotation-alignment':'map'}});
 map.addLayer({id:'hi-stops',type:'circle',source:'hi-stops',minzoom:9.5,paint:{'circle-radius':['interpolate',['linear'],['zoom'],9.5,1.4,12,2.6,16,5.5],'circle-color':'#fff','circle-stroke-color':['get','c'],'circle-stroke-width':['interpolate',['linear'],['zoom'],9.5,1,14,2.2]}});
 map.addLayer({id:'walk-lines',type:'line',source:'walks',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#37465a','line-width':3.2,'line-dasharray':[.1,2.1]}});
 map.addLayer({id:'cand-ring',type:'circle',source:'candidates',paint:{'circle-radius':['interpolate',['linear'],['zoom'],11,4,15,8,18,13],'circle-color':'#fff','circle-stroke-color':['get','c'],'circle-stroke-width':['interpolate',['linear'],['zoom'],11,2,15,3.6]}});
}

const DIM_LAYERS=[['corridor-top','line-opacity',.9],['route-lines','line-opacity',.92],['stops-hub','circle-opacity',1],['stops-hub','circle-stroke-opacity',1],['stops-all','circle-opacity',1],['stops-all','circle-stroke-opacity',1]];
let dimmed=false;
function setDim(on){
 if(on===dimmed)return;dimmed=on;
 for(const [layer,prop,full]of DIM_LAYERS)map.setPaintProperty(layer,prop,on?full*.16:full);
 map.setPaintProperty('corridor-all','line-opacity',on?.14:['interpolate',['linear'],['get','load'],1,.45,5,.8,10,.95]);
 refreshLabels();
}
const padding=()=>{const top=$('.lab-top').getBoundingClientRect().bottom+44,sheet=$('#sheet'),bottom=(sheet.hidden?40:sheet.getBoundingClientRect().height)+26,narrow=innerWidth<720;return {top,bottom,left:narrow?26:Math.min(440,innerWidth/2),right:56};};
const fitPoints=(points,maxZoom=16)=>{if(!points.length)return;const b=new maplibregl.LngLatBounds();for(const p of points)b.extend(p);map.fitBounds(b,{padding:padding(),maxZoom,duration:750});};
function toast(text,ms=2600){const el=$('#toast');el.textContent=text;el.hidden=false;clearTimeout(toast.t);if(ms)toast.t=setTimeout(()=>el.hidden=true,ms);}
function circleCoords(p,meters,n=56){const out=[];for(let i=0;i<=n;i++){const a=2*Math.PI*i/n;out.push([p.lng+Math.cos(a)*meters/92900,p.lat+Math.sin(a)*meters/111000]);}return out;}

function makePin(kind){const el=h('div',{class:`pin ${kind}`},h('b',{},END_NAME[kind]||''));return el;}
function placePin(kind,place){pins[kind]?.remove();pins[kind]=new maplibregl.Marker({element:makePin(kind)}).setLngLat([place.lng,place.lat]).addTo(map);}
const END_COLOR={from:'#0e9f7e',to:'#ee5236'};
function refreshCandidates(){
 const areas=[],cands=[];
 for(const kind of ['from','to']){const place=state[kind],minutes=state.walk[kind],button=$(`#${kind}-walk`);
  if(!place){button.textContent=minutes?`도보 ${minutes}분`:'가까이';button.classList.toggle('on',minutes>0);button.setAttribute('aria-label',`${END_NAME[kind]} 도보 범위: ${minutes?`${minutes}분`:'가장 가까운 정류장'}. 누르면 바뀝니다`);continue;}
  const list=stopsWithin(net,place,minutes);place.count=list.length;
  button.textContent=`${minutes?`${minutes}분`:'가까이'} · ${list.length}곳`;button.classList.toggle('on',minutes>0);button.setAttribute('aria-label',`${END_NAME[kind]} 도보 범위: ${minutes?`${minutes}분, `:'가장 가까운 곳, '}정류장 ${list.length}곳. 누르면 바뀝니다`);
  if(minutes)areas.push({type:'Feature',properties:{c:END_COLOR[kind]},geometry:{type:'Polygon',coordinates:[circleCoords(place,radiusOf(minutes))]}});
  for(const o of list)cands.push(point(o.stop,{c:END_COLOR[kind]}));
 }
 map.getSource('area').setData(fc(areas));map.getSource('candidates').setData(fc(cands));
}
function clearHighlight(){state.number=null;state.prevSheet=null;state.quick=null;syncQuick();map.setLayoutProperty('near-lines','visibility','visible');map.getSource('hi').setData(fc([]));map.getSource('hi-stops').setData(fc([]));map.getSource('walks').setData(fc([]));for(const m of stopovers)m.remove();stopovers=[];setDim(false);}
function clearNear(){if(!state.near)return;state.near=false;map.setLayoutProperty('near-lines','visibility','visible');map.getSource('near').setData(fc([]));}
function focusEnd(kind){const place=state[kind];if(!place)return;
 if(state.from&&state.to)return fitPoints([[state.from.lng,state.from.lat],[state.to.lng,state.to.lat]],15);
 const minutes=state.walk[kind];
 if(minutes)return fitPoints(circleCoords(place,radiusOf(minutes)*1.15,12),17);
 const {top,bottom}=padding();map.flyTo({center:[place.lng,place.lat],zoom:Math.max(map.getZoom(),15.6),offset:[0,(top-bottom)/2],duration:750});
}
function syncFind(){$('#find').disabled=!(state.from&&state.to);$('#find-row').hidden=!(state.from||state.to);$('#quick').hidden=!!(state.from&&state.to)||!$('#num-box').hidden;}
function syncQuick(){document.querySelectorAll('.q[data-quick]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quick===state.quick)));}
function setEnd(kind,place){
 state[kind]=place;$(`#${kind}-input`).value=place.name;placePin(kind,place);
 state.result=null;closeSheet();clearHighlight();if(kind==='to')clearNear();
 refreshCandidates();syncFind();focusEnd(kind);hideSuggest();
}
function reset(){for(const kind of ['from','to']){state[kind]=null;state.walk[kind]=0;$(`#${kind}-input`).value='';pins[kind]?.remove();delete pins[kind];}state.result=null;clearNear();closeSheet();clearHighlight();refreshCandidates();syncFind();}
function legCoords(l){const v=net.variants[l.variant],out=[];for(let k=l.from;k<l.to;k++){const c=segs.get(segKey(v.stops[k],v.stops[k+1]));if(c)out.push(...(out.length?c.slice(1):c));}return out;}
function runSearch(){
 if(!state.from||!state.to)return;
 const {from,to,walk}=state;
 state.result=search(net,from,to,{walkFrom:walk.from,walkTo:walk.to});
 state.baseline=walk.from||walk.to?search(net,from,to).total:state.result.total;
 state.selected=0;clearNear();renderResults();
 if(state.result.options.length)selectOption(0);else clearHighlight();
}
function selectOption(index){
 const option=state.result.options[index];state.selected=index;
 document.querySelectorAll('.option').forEach((el,i)=>el.setAttribute('aria-current',String(i===index)));
 const features=option.legs.map(l=>line(legCoords(l),{c:lineColor(l.no),no:l.no})),all=features.flatMap(f=>f.geometry.coordinates);
 map.getSource('hi').setData(fc(features));map.getSource('hi-stops').setData(fc(stopPoints(option.legs)));
 const dots=[],ll=s=>[s.lng,s.lat];
 dots.push(line([ll(state.from),ll(option.boardStop)],{}));
 for(const w of option.transferWalks)if(w.from!==w.to)dots.push(line([ll(net.stops[w.from]),ll(net.stops[w.to])],{}));
 dots.push(line([ll(option.exitStop),ll(state.to)],{}));
 map.getSource('walks').setData(fc(dots));
 for(const m of stopovers)m.remove();
 stopovers=[option.boardStop,...option.legs.slice(1).map(l=>net.stops[l.board]),option.exitStop].map(s=>new maplibregl.Marker({element:h('div',{class:'pin stopover'})}).setLngLat(ll(s)).addTo(map));
 setDim(true);
 fitPoints([...all,ll(state.from),ll(state.to)]);
}
function stopPoints(items){const seen=new Set(),out=[];for(const l of items){const v=net.variants[l.variant];for(let k=l.from;k<=l.to;k++){const i=v.stops[k];if(seen.has(i))continue;seen.add(i);out.push(point(net.stops[i],{i,c:lineColor(l.no)}));}}return out;}
const wholeRoute=(no,g)=>({no,variant:g.v.i,from:0,to:g.v.stops.length-1});
function drawRoutes(items){
 const features=items.map(l=>line(legCoords(l),{c:lineColor(l.no),no:l.no}));
 map.getSource('hi').setData(fc(features));map.getSource('hi-stops').setData(fc(stopPoints(items)));map.getSource('walks').setData(fc([]));for(const m of stopovers)m.remove();stopovers=[];
 map.setLayoutProperty('near-lines','visibility','none');setDim(true);
 fitPoints(features.flatMap(f=>f.geometry.coordinates));
}
function endNumber(){state.number=null;state.prevSheet=null;state.quick=null;syncQuick();map.setLayoutProperty('near-lines','visibility','visible');map.getSource('hi').setData(fc([]));map.getSource('hi-stops').setData(fc([]));if(!state.near&&!state.result)setDim(false);}
function closeFocus(){const previous=state.prevSheet;endNumber();if(previous)previous();else closeSheet();}
const isGroup=()=>String(state.number||'').startsWith('group:');
function openNumber(no,direction=-1){
 const previous=state.number&&!isGroup()?state.prevSheet:state.render;
 state.number=no;state.prevSheet=previous;
 const groups=directionGroups(net,no);if(!groups.length)return;
 const family=families.get(baseNumber(no))||[no],lead=groups[0];
 openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},`${no}번`),h('p',{},`정류장 ${lead.v.stops.length}개 · ${lead.from} ↔ ${lead.to}`)),closeButton(closeFocus)),
  family.length>1?h('p',{class:'sec'},'가지 번호'):null,
  family.length>1?h('div',{class:'chips'},family.map(n=>h('button',{class:'chip',style:`--c:${lineColor(n)}`,'aria-pressed':String(n===no),on:{click:()=>openNumber(n)}},n))):null,
  groups.length>1?h('p',{class:'sec'},`운행 방향 ${groups.length}가지`):null,
  groups.length>1?h('div',{class:'dirs'},h('button',{class:'dir','aria-pressed':String(direction<0),on:{click:()=>openNumber(no)}},'전체 보기'),groups.map((g,i)=>h('button',{class:'dir','aria-pressed':String(i===direction),on:{click:()=>openNumber(no,i)}},`${g.from} → ${g.to}`,h('small',{},`정류장 ${g.v.stops.length}개`)))):null].filter(Boolean),()=>openNumber(no,direction));
 drawRoutes((direction<0?groups:[groups[direction]]).map(g=>wholeRoute(no,g)));
}
function showGroup(g){
 state.number=`group:${g.id}`;state.prevSheet=null;state.quick=g.id;syncQuick();
 const shown=g.numbers.filter(no=>directionGroups(net,no).length);
 openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},g.label),h('p',{},`${shown.length}개 번호 · 하나만 보려면 번호를 누르세요`)),closeButton(closeFocus)),h('div',{class:'chips'},shown.map(no=>numberChip(no,()=>openNumber(no))))],()=>showGroup(g));
 drawRoutes(shown.flatMap(no=>directionGroups(net,no).map(x=>wholeRoute(no,x))));
}
function pressQuick(g){
 if(state.quick===g.id)return closeFocus();
 state.number=null;state.prevSheet=null;state.render=null;
 if(g.numbers.length===1){openNumber(g.numbers[0]);state.quick=g.id;syncQuick();}else showGroup(g);
}
function openLine(numbers){openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},`이 길을 지나는 번호 ${numbers.length}개`),h('p',{},'하나를 누르면 그 노선만 선명하게 보여 줍니다')),closeButton()),h('div',{class:'chips'},numbers.map(no=>numberChip(no,()=>openNumber(no))))],()=>openLine(numbers));}
function showNear(place,list){
 const numbers=[...new Set(list.flatMap(o=>numbersAt(net,o.stop.i)))].sort(byImportance),order=new Map(numbers.map((n,i)=>[n,i])),directed=new Map();
 for(const v of net.variants){if(!order.has(v.no))continue;for(let i=1;i<v.stops.length;i++){const k=segKey(v.stops[i-1],v.stops[i]);if(!segs.has(k))continue;if(!directed.has(k))directed.set(k,new Set());directed.get(k).add(v.no);}}
 const features=[];for(const [k,set]of directed)[...set].sort(byImportance).slice(0,CAP).forEach((no,r)=>features.push(line(segs.get(k),{c:lineColor(no),off:r+.5})));
 map.getSource('near').setData(fc(features));state.near=true;setDim(true);
 return numbers;
}
function openSheet(content,render=null){state.render=render;const sheet=$('#sheet');sheet.replaceChildren(...content);sheet.hidden=false;sheet.scrollTop=0;document.body.classList.add('sheet-open');}
function closeSheet(){$('#sheet').hidden=true;document.body.classList.remove('sheet-open');state.sheet=null;}
const closeButton=(fn=closeSheet)=>h('button',{class:'sheet-close','aria-label':'닫기',on:{click:fn}},'✕');
const numberChip=(no,click)=>h(click?'button':'span',{class:'chip',style:`--c:${lineColor(no)}`,...(click?{on:{click}}:{})},no);
function renderEndButtons(place){const back=state.result?h('button',{class:'back',on:{click:()=>{renderResults();selectOption(state.selected);}}},'경로로 돌아가기'):null;return h('div',{class:'sheet-actions'},h('button',{class:'from',on:{click:()=>setEnd('from',place)}},'출발지로'),h('button',{class:'to',on:{click:()=>setEnd('to',place)}},'목적지로'),back);}
function openStop(stop){
 state.sheet='stop';const numbers=[...numbersAt(net,stop.i)].sort(byImportance),place={name:stop.base||stop.name,lat:stop.lat,lng:stop.lng};
 openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},stop.name),h('p',{},`버스 ${numbers.length}개 번호 · 번호를 누르면 노선을 보여 줍니다`)),closeButton(()=>{if(state.result){renderResults();selectOption(state.selected);}else{closeSheet();clearHighlight();if(state.near)setDim(true);}})),renderEndButtons(place),h('div',{class:'chips'},numbers.map(no=>numberChip(no,()=>openNumber(no))))],()=>openStop(stop));
 // 누른 정류장이 시트에 가리면 보이는 곳으로 올린다.
 const y=map.project([stop.lng,stop.lat]).y,limit=innerHeight-$('#sheet').getBoundingClientRect().height-70;if(y>limit)map.panBy([0,y-limit],{duration:300});
}
function openPoint(lngLat){state.sheet='point';const place={name:'지도에서 고른 곳',lat:lngLat.lat,lng:lngLat.lng};openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},'지도에서 고른 곳'),h('p',{},'이곳을 어디로 정할까요?')),closeButton()),renderEndButtons(place)]);}
const TAG_TEXT={best:'추천',leastWalk:'가장 적게 걷기',fewestStops:'정류장 최소'};
function optionCard(o,i){
 const chain=o.legs.flatMap((l,k)=>[k?h('i',{},'›'):null,numberChip(l.no)]),transfer=o.transfers?`환승 ${o.transfers}회`:'환승 없음';
 const via=o.legs.slice(1).map(l=>net.stops[l.board].base).join(' · ');
 return h('li',{},h('button',{class:'option','aria-current':String(i===state.selected),on:{click:()=>selectOption(i)}},
  h('div',{class:'opt-top'},chain,o.tags.map(t=>h('span',{class:'tag'},TAG_TEXT[t]))),
  h('div',{class:'opt-sum'},`${transfer} · 도보 약 ${Math.max(1,Math.round(o.walkMinutes))}분 · 정류장 ${o.rideStops}개`),
  h('div',{class:'opt-way'},`${o.boardStop.base}에서 승차${via?` → ${via} 환승`:''} → ${o.exitStop.base} 하차`)));
}
function renderResults(){
 const {options,total,walkOnly}=state.result;state.sheet='results';
 const widened=state.walk.from||state.walk.to,note=widened?`후보 ${total}가지 · 가까운 정류장만이면 ${state.baseline}가지`:`후보 ${total}가지 · 도보 범위를 넓히면 더 늘어납니다`;
 openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},options.length?'경로 선택':'경로를 찾지 못했습니다'),h('p',{},options.length?note:'도보 범위를 5분이나 10분으로 넓혀 보세요.')),closeButton(()=>{closeSheet();clearHighlight();state.result=null;})),
  walkOnly!==null?h('p',{class:'empty'},`걸어서도 약 ${Math.max(1,Math.round(walkOnly))}분 거리입니다.`):null,
  options.length?h('ul',{class:'options'},options.map(optionCard)):null].filter(Boolean),()=>{renderResults();selectOption(state.selected);});
}
function pickAt(e){
 if(!$('#suggest').hidden)return hideSuggest();
 const box=[[e.point.x-13,e.point.y-13],[e.point.x+13,e.point.y+13]],layers=['stops-all','stops-hub'].filter(l=>map.getLayer(l)),hits=map.queryRenderedFeatures(box,{layers});
 if(hits.length){const best=hits.map(f=>net.stops[f.properties.i]).sort((a,b)=>distanceM(a,map.unproject(e.point))-distanceM(b,map.unproject(e.point)))[0];return openStop(best);}
 if(!state.result){
  const lineLayers=['route-lines','corridor-all','corridor-top'].filter(l=>map.getLayer(l)),found=new Set(),near=r=>map.queryRenderedFeatures([[e.point.x-r,e.point.y-r],[e.point.x+r,e.point.y+r]],{layers:lineLayers}),hitsAt=near(2),lineHits=hitsAt.length?hitsAt:near(8);
  for(const f of lineHits)for(const no of f.properties.k?lineNumbers.get(f.properties.k)||[]:pairNumbers.get(f.properties.pk)||[])found.add(no);
  if(found.size){if(state.number)endNumber();state.render=null;const numbers=[...found].sort(byImportance);return numbers.length===1?openNumber(numbers[0]):openLine(numbers);}
  if(state.number)return closeFocus();
  openPoint(e.lngLat);
 }
}
function refreshLabels(){
 for(const m of labelMarkers)m.remove();labelMarkers=[];
 const zoom=map.getZoom(),b=map.getBounds();
 if(zoom>=Z_NAMES){
  const seen=new Set(),used=new Set(),out=[];
  for(const s of net.stops){if(s.virtual||!net.at[s.i].length||!b.contains([s.lng,s.lat])||seen.has(s.station))continue;seen.add(s.station);out.push(s);}
  out.sort((a,c)=>numbersAt(net,c.i).length-numbersAt(net,a.i).length);
  let shown=0;for(const s of out){if(shown>=70)break;const p=map.project([s.lng,s.lat]),key=`${Math.floor(p.x/84)}:${Math.floor(p.y/30)}`;if(used.has(key))continue;used.add(key);shown++;labelMarkers.push(new maplibregl.Marker({element:h('div',{class:'stop-name'},s.base),anchor:'top'}).setLngLat([s.lng,s.lat]).addTo(map));}
 }
 if(zoom>=Z_ROUTES&&!dimmed){let shown=0;const used=new Set();for(const o of overflow){if(shown>=16)break;if(!b.contains([o.lng,o.lat]))continue;const p=map.project([o.lng,o.lat]),key=`${Math.floor(p.x/70)}:${Math.floor(p.y/70)}`;if(used.has(key))continue;used.add(key);shown++;labelMarkers.push(new maplibregl.Marker({element:h('div',{class:'more-lines'},`+${o.more}`)}).setLngLat([o.lng,o.lat]).addTo(map));}}
 const chip=$('#zoom-chip');chip.textContent=zoom<Z_ISLAND?'섬 전체 · 급행과 일주 노선':zoom<Z_ROUTES?'줄기 노선 · 굵을수록 번호가 많음':zoom<Z_NAMES?'번호별 노선':'번호별 노선 · 정류장 이름';
}
function reopenNear(list,numbers){openSheet([h('div',{class:'sheet-head'},h('div',{},h('h2',{},`내 주변 도보 ${state.walk.from}분`),h('p',{},`정류장 ${list.length}곳 · 번호 ${numbers.length}개`)),closeButton(()=>{closeSheet();clearNear();setDim(false);})),h('div',{class:'chips'},numbers.map(no=>numberChip(no,()=>openNumber(no))))],()=>reopenNear(list,numbers));}
function locate(){
 if(!navigator.geolocation)return toast('이 기기에서는 위치를 쓸 수 없습니다.');
 toast('현재 위치를 찾는 중입니다.',0);
 navigator.geolocation.getCurrentPosition(({coords})=>{
  $('#toast').hidden=true;const place={name:'현재 위치',lat:coords.latitude,lng:coords.longitude};
  if(place.lat<33.1||place.lat>34||place.lng<126.1||place.lng>127)return toast('제주 안에서만 내 주변을 보여 줄 수 있습니다.');
  state.walk.from=Math.max(state.walk.from,10);setEnd('from',place);
  const list=stopsWithin(net,place,state.walk.from),numbers=showNear(place,list);
  state.sheet='near';reopenNear(list,numbers);
  focusEnd('from');
 },()=>toast('위치를 가져오지 못했습니다. 권한을 확인해 주세요.'),{enableHighAccuracy:true,timeout:9000,maximumAge:15000});
}
let activeInput=null,suggestTimer=null,suggestRequest=0;
function hideSuggest(){$('#suggest').hidden=true;$('#suggest').replaceChildren();activeInput=null;}
// 이름이 같은 정류장이 제주시와 서귀포시에 따로 있어 역 묶음별로 나누고 어느 쪽인지 적는다.
const AREAS=[['제주시내',33.5,126.53],['서귀포시내',33.25,126.56],['애월',33.46,126.33],['한림',33.41,126.27],['대정',33.22,126.25],['안덕',33.25,126.33],['중문',33.25,126.42],['남원',33.28,126.71],['표선',33.33,126.83],['성산',33.46,126.92],['구좌',33.52,126.8],['조천',33.53,126.65]];
const areaOf=s=>AREAS.reduce((a,b)=>distanceM(s,{lat:b[1],lng:b[2]})<distanceM(s,{lat:a[1],lng:a[2]})?b:a)[0];
function localStops(q){const key=q.replace(/\s+/g,''),seen=new Map();for(const s of net.stops){if(s.virtual||!net.at[s.i].length||!s.base.includes(key))continue;const n=numbersAt(net,s.i).length,p=seen.get(s.station);if(!p||n>p.n)seen.set(s.station,{n,s});}return [...seen.values()].sort((a,b)=>(b.s.base.startsWith(key)-a.s.base.startsWith(key))||b.n-a.n).slice(0,5).map(({s,n})=>({name:s.base,lat:s.lat,lng:s.lng,sub:`정류장 · ${areaOf(s)} · 번호 ${n}개`}));}
function showSuggest(items,kind){const ul=$('#suggest');ul.replaceChildren(...items.map(item=>h('li',{},h('button',{type:'button',on:{click:()=>setEnd(kind,{name:item.name,lat:item.lat,lng:item.lng})}},h('b',{},item.name),h('small',{},item.sub)))));ul.hidden=!items.length;}
function onType(kind){
 const input=$(`#${kind}-input`),q=input.value.trim();activeInput=kind;clearTimeout(suggestTimer);const request=++suggestRequest;
 if(q.length<2)return hideSuggest();
 const local=localStops(q);showSuggest(local,kind);activeInput=kind;
 suggestTimer=setTimeout(async()=>{try{const response=await fetch(`/api/places?q=${encodeURIComponent(q)}`);if(!response.ok||request!==suggestRequest)return;const body=await response.json(),places=(body.places||[]).slice(0,5).filter(p=>Number.isFinite(Number(p.lat))).map(p=>({name:p.name,lat:Number(p.lat),lng:Number(p.lng),sub:p.address||'장소'}));const key=q.replace(/\s+/g,''),exact=local.filter(s=>s.name===key),others=local.filter(s=>s.name!==key);if(request===suggestRequest&&activeInput===kind)showSuggest([...exact,...places,...others].slice(0,8),kind);}catch{}},420);
}
function openNumberSearch(){$('#num-box').hidden=false;$('#quick').hidden=true;const input=$('#num-input');input.value='';input.focus();}
function closeNumberSearch(){$('#num-box').hidden=true;$('#num-input').blur();hideSuggest();syncFind();}
function chooseNumber(no){closeNumberSearch();state.number=null;state.prevSheet=null;state.render=null;state.quick=null;syncQuick();openNumber(no);}
function renderNumberResults(){
 const q=$('#num-input').value,ul=$('#suggest');if(!q.trim())return hideSuggest();
 const results=searchNumbers(families,q);
 ul.replaceChildren(...(results.length?results.map(({no,family})=>{const g=directionGroups(net,no)[0];return h('li',{},h('button',{type:'button',class:'num-row',on:{click:()=>chooseNumber(no)}},numberChip(no),h('small',{},`${g?`${g.from} ↔ ${g.to}`:''}${family.length>1?` · 가지 ${family.length}개`:''}`)));}):[h('li',{class:'none'},'그런 번호가 없습니다.')]));
 ul.hidden=false;
}
function wire(){
 $('#quick').append(h('button',{type:'button',class:'q search',on:{click:openNumberSearch}},'번호 검색'),...QUICK.map(g=>h('button',{type:'button',class:'q','data-quick':g.id,'aria-pressed':'false',on:{click:()=>pressQuick(g)}},g.label)));
 $('#num-input').addEventListener('input',renderNumberResults);
 $('#num-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#suggest button')?.click();}else if(e.key==='Escape')closeNumberSearch();});
 $('#num-close').addEventListener('click',closeNumberSearch);
 for(const kind of ['from','to']){
  const input=$(`#${kind}-input`);
  input.addEventListener('input',()=>onType(kind));
  input.addEventListener('focus',()=>{input.select();});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('#suggest button');if(first){e.preventDefault();first.click();}}else if(e.key==='Escape')hideSuggest();});
  $(`#${kind}-walk`).addEventListener('click',()=>{const i=WALK_STEPS.indexOf(state.walk[kind]);state.walk[kind]=WALK_STEPS[(i+1)%WALK_STEPS.length];refreshCandidates();if(state.result)runSearch();else if(state[kind])focusEnd(kind);});
 }
 $('#search').addEventListener('submit',e=>{e.preventDefault();runSearch();});
 $('#reset').addEventListener('click',reset);
 $('#zoom-in').addEventListener('click',()=>map.zoomIn());
 $('#zoom-out').addEventListener('click',()=>map.zoomOut());
 $('#locate').addEventListener('click',locate);
 map.on('click',pickAt);
 map.on('moveend',refreshLabels);
 for(const layer of ['stops-all','stops-hub']){map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');}
}
async function start(){
 toast('노선을 불러오는 중입니다.',0);
 const [network,shapes]=await Promise.all(['/data/network.json','/data/map-lab-shapes.json'].map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error(u);return r.json();})));
 net=indexNetwork(network,shapes.station);segs=decode(shapes.segs);families=numberFamilies(net);
 map=new maplibregl.Map({container:'map',attributionControl:{compact:true},style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}},layers:[{id:'bg',type:'background',paint:{'background-color':'#eef1ec'}},{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.72,'raster-contrast':-.08,'raster-opacity':.92}}]},bounds:[[126.14,33.17],[126.98,33.58]],fitBoundsOptions:{padding:{top:120,bottom:30,left:12,right:12}},maxBounds:[[125.7,32.8],[127.4,34.3]],minZoom:7.5,maxZoom:19,dragRotate:false,pitchWithRotate:false,touchPitch:false});
 map.touchZoomRotate.disableRotation();
 await new Promise(resolve=>map.once('load',resolve));
 addLayers(buildNetworkLayers());wire();refreshCandidates();refreshLabels();$('#toast').hidden=true;
 window.mapLab={map,state,net,setEnd,runSearch,QUICK,families};
}
start().catch(()=>toast('지도를 불러오지 못했습니다. 새로고침해 주세요.',0));
