// 시간표 배치: 공개 BIS 시간표 페이지가 쓰는 자료를 번호별로 한 번씩 읽어 public/data/timetable.json을 만든다.
// 로컬에서만 실행하고, 요청 사이에 2초를 둔다. 개정 공지가 있거나 월 1회 시행일을 비교할 때 돌린다.
// 실행: node scripts/build-timetable.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const BASE='https://bus.jeju.go.kr',GAP=2000,CACHE='data/timetable-raw.json',OUT='public/data/timetable.json';
const network=JSON.parse(await readFile('public/data/network.json','utf8'));
const numbers=[...new Set(network.variants.map(v=>v.no.split('-')[0]))].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
let raw={};try{raw=JSON.parse(await readFile(CACHE,'utf8'));}catch{}
let calls=0;
async function get(path,options){
 for(let attempt=0;;attempt++){
  try{calls++;const response=await fetch(BASE+path,{...options,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);await delay(GAP);return response;}
  catch(error){if(attempt>=2)throw error;await delay(5000*(attempt+1));}
 }
}
const post=async(path,scheduleId)=>(await get(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({scheduleId})})).json();
const clean=x=>String(x??'').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
let failed=0;
for(const no of numbers){
 if(raw[no])continue;
 try{
  const html=await (await get(`/schedule/viewNew/${encodeURIComponent(no)}`)).text();
  const found=[...html.matchAll(/showTab\('(\d+)'\);">\s*<p[^>]*>([^<]*)<\/p>\s*<p[^>]*>([^<]*)<\/p>/g)],tabs=[];
  for(const [,id,label,path]of found){
   const info=await post('/data/schedule/getScheduleInfo',id),cells=await post('/data/schedule/getScheduleTableInfo',id);
   tabs.push({id,label:label.trim(),path:path.trim(),info,cells:cells.map(c=>[c.ROW_SEQ,c.COLUMN_SEQ,c.COLUMN_NM??''])});
  }
  raw[no]={tabs};
  await writeFile(CACHE,JSON.stringify(raw));
  console.log(no,tabs.length,`호출 ${calls}`);
 }catch(error){failed++;console.log(no,'실패',error.message);}
}
const routes={};
for(const [no,{tabs}]of Object.entries(raw)){
 const seen=new Set();
 routes[no]={tabs:tabs.filter(t=>{const key=`${t.label}|${t.path}|${JSON.stringify(t.cells)}`;if(seen.has(key))return false;seen.add(key);return true;}).map(({id,label,path,info,cells})=>{
  const rows=new Map();for(const [row,col,value]of cells){if(!rows.has(row))rows.set(row,[]);rows.get(row)[col]=clean(value);}
  const ordered=[...rows.keys()].sort((a,b)=>a-b).map(k=>Array.from(rows.get(k),x=>x??''));
  return {id,no:label,path,title:clean(info.SCHEDULE_NUM),waypoint:clean(info.SCHEDULE_WAYPOINT),via:clean(info.SCHEDULE_VIA),run:clean(info.SCHEDULE_RUN_TM),effective:clean(info.ENFORCEMENT_NM),kind:clean(info.ROUTE_BUS_DETAIL_TP_NM),columns:ordered[0]||[],rows:ordered.slice(1)};
 })};
}
await writeFile(OUT,JSON.stringify({builtAt:new Date().toISOString(),source:'제주버스정보시스템 공개 시간표',routes}));
console.log(`완료: 번호 ${Object.keys(routes).length}/${numbers.length}, 실패 ${failed}, 호출 ${calls}`);
