import {ServiceError,coordinate,distanceMeters} from './catalog.mjs';
import {prepareRoute,project} from '../public/navigation-core.js';
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const safeText=x=>String(x??'').slice(0,200);
export function normalizeDriving(data){
 const raw=data?.routes?.find(r=>Number(r.result_code)===0);if(!raw)fail('navigationNoRoute',422);
 const points=[],guides=[],sections=[];
 for(const section of raw.sections||[]){
  const indices=[];
  for(const road of section.roads||[]){indices.push(Math.max(0,points.length-1));const vertices=road.vertexes||[];for(let i=0;i+1<vertices.length;i+=2){const p=coordinate(vertices[i+1],vertices[i]);if(!p)fail('providerUnavailable',502);if(!points.length||distanceMeters(points.at(-1),p)>0)points.push(p);}}
  for(const g of section.guides||[]){const point=coordinate(g.y,g.x);if(point)guides.push({point,text:safeText(g.guidance),type:Number(g.type),index:indices[g.road_index]??indices[0]??0});}
  sections.push({duration:Number(section.duration),distance:Number(section.distance)});
 }
 const duration=Number(raw.summary?.duration),meters=Number(raw.summary?.distance);
 if(points.length<2||points.length>50000||!Number.isFinite(duration)||duration<=0||!Number.isFinite(meters)||meters<=0||sections.some(s=>!Number.isFinite(s.duration)||s.duration<0))fail('providerUnavailable',502);
 const route=prepareRoute({points,duration,meters,guides:[],sections,source:'Kakao Mobility',receivedAt:new Date().toISOString()});
 let last=0;route.guides=guides.map(g=>{const snap=project(g.point,route,{min:Math.max(last-5,route.cumulative[g.index]||0)});last=Math.max(last,snap?.along||0);return {text:g.text,type:g.type,along:last};}).filter(g=>g.text);
 route.guides.push({text:'목적지 도착',type:101,along:route.length});return route;
}
export function createNavigation(config,{fetchImpl=fetch,consume=async()=>{},observe=async()=>{}}={}){
 const enabled=()=>!!(config.navigationEnabled&&config.kakaoEnabled&&config.kakaoKey&&(!config.navigationApprovalUntil||Date.parse(config.navigationApprovalUntil)>Date.now()));
 const guard=()=>{if(!enabled())fail('navigationNotEnabled',503);};
 async function request(url,provider){
  if(provider==='kakao-driving'&&config.navigationApprovalId&&!config.navigationFreeVerified)await consume('navigation_budget',config.navigationPeriodLimit,`approval:${config.navigationApprovalId}`);
  await consume(provider,provider==='kakao-driving'?config.navigationDailyLimit:config.kakaoDailyLimit||100);
  const started=Date.now();let ok=false;
  try{const response=await fetchImpl(url,{headers:{Authorization:`KakaoAK ${config.kakaoKey}`},signal:AbortSignal.timeout(10000)});
   if(!response.ok)fail(response.status===429?'quotaReached':[401,403].includes(response.status)?'providerPermission':'providerUnavailable',503);
   const data=await response.json();ok=true;return data;
  }catch(error){if(error instanceof ServiceError)throw error;fail('providerUnavailable',503);}
  finally{try{await observe({provider,operation:url.pathname,ok,durationMs:Date.now()-started});}catch{}}
 }
 function point(value){const p=coordinate(value?.lat,value?.lng);if(!p)fail('outsideJeju');return p;}
 async function route(body){
  guard();const from=point(body?.from),to=point(body?.to);if(distanceMeters(from,to)<20)fail('samePlaces');
  if(!['RECOMMEND','TIME','DISTANCE'].includes(body.priority||'RECOMMEND'))fail('invalidRequest');
  const waypoints=body.waypoints??[];if(!Array.isArray(waypoints)||waypoints.length>1)fail('invalidRequest');
  const via=waypoints.map(point),url=new URL('https://apis-navi.kakaomobility.com/v1/directions');
  url.search=new URLSearchParams({origin:`${from.lng},${from.lat}`,destination:`${to.lng},${to.lat}`,priority:body.priority||'RECOMMEND',summary:'false',alternatives:'false',road_details:'false'});
  if(via.length)url.searchParams.set('waypoints',via.map(p=>`${p.lng},${p.lat}`).join('|'));
  return normalizeDriving(await request(url,'kakao-driving'));
 }
 return {enabled,route,async recommend(body){
  guard();const from=point(body?.from),to=point(body?.to),center=point(body?.center),minutes=body?.minutes;
  const started=Date.now();
  if(![5,10].includes(minutes)||!['FD6','CE7','AT4'].includes(body.category))fail('invalidRequest');
  const url=new URL('https://dapi.kakao.com/v2/local/search/category.json');url.search=new URLSearchParams({category_group_code:body.category,x:String(center.lng),y:String(center.lat),radius:'2500',sort:'distance',size:'5'});
  const data=await request(url,'kakao'),candidates=(data.documents||[]).map(p=>({id:safeText(p.id),name:safeText(p.place_name),address:safeText(p.road_address_name||p.address_name),...coordinate(p.y,p.x)})).filter(p=>p.lat!==undefined&&distanceMeters(from,p)>50&&distanceMeters(to,p)>50).slice(0,3);
  if(!candidates.length)return {places:[],source:'Kakao',receivedAt:new Date().toISOString()};
  const baseline=await route({from,to,priority:body.priority});const places=[];let partial=false;
  // Serial and bounded: at most 1 baseline + 3 via routes. No retry/fallback/AI calls.
  for(const place of candidates){if(Date.now()-started>15000){partial=true;break;}try{const via=await route({from,to,waypoints:[place],priority:body.priority});const seconds=via.sections[0]?.duration;if(Number.isFinite(seconds)&&seconds<=minutes*60)places.push({...place,seconds,extraSeconds:Math.max(0,via.duration-baseline.duration)});}catch(error){if(['quotaReached','servicePaused','providerPermission'].includes(error.key))throw error;partial=true;}}
  return {places:places.sort((a,b)=>a.extraSeconds-b.extraSeconds),partial,source:'Kakao Mobility',receivedAt:new Date().toISOString()};
 }};
}
