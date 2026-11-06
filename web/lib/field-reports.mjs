// 원탭 제보와 수리 소식. 위치, 차량번호, 사진은 받지 않는다. 기사 민원은 받지 않고 공식 창구로 안내한다.
// 현장 제보는 공식 정보가 아니므로 짧게만 보이고, 데이터 오류는 사람이 원문과 대조해 고친다.
import {randomBytes} from 'node:crypto';
import {ServiceError} from './catalog.mjs';
import {adminOf} from './admin.mjs';
import {koreaDay} from './telemetry.mjs';

export const REPORT_TYPES={notcame:'situation',full:'situation',timetable:'data',stop:'data',other:'data'};
export const SITUATION_MINUTES=60,SITUATION_THRESHOLD=2;
const DAILY_LIMIT=500,KEEP_DAYS=30,MINUTE=60000;
const NUMBER=/^[\w가-힣-]{1,20}$/,STOP=/^[\w:.-]{1,100}$/,REQUEST=/^[\w-]{8,80}$/;
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const kst=now=>new Date(now+9*3600000);
export const maskText=text=>String(text||'').replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g,'[전화번호]').replace(/\d{2,3}[가-힣]\s?\d{4}/g,'[차량번호]').trim().slice(0,200);

export function createFieldReports(config,store,{now=Date.now}={}){
 const guard=actor=>{if(!adminOf(config,actor))fail('forbidden',403);};
 const value=(text,max,key)=>{if(typeof text!=='string'||!text.trim()||[...text.trim()].length>max)fail(key);return text.trim();};
 return {
  async submit(body,user=null){
   const type=body?.type,kind=REPORT_TYPES[type];
   if(!kind||typeof body.routeNo!=='string'||!NUMBER.test(body.routeNo)||typeof body.stopId!=='string'||!STOP.test(body.stopId)||typeof body.requestId!=='string'||!REQUEST.test(body.requestId))fail('invalidRequest');
   if(await store.recordGet('field_reports',body.requestId))return {ok:true,duplicate:true};
   const at=now(),day=koreaDay(at),date=kst(at);
   if((await store.recordList('field_reports',{field:'day',value:day,limit:DAILY_LIMIT})).length>=DAILY_LIMIT)fail('rateLimited',429);
   await store.recordPut('field_reports',body.requestId,{id:body.requestId,kind,type,routeNo:body.routeNo,stopId:body.stopId,stopName:typeof body.stopName==='string'?body.stopName.slice(0,80):'',hourBucket:date.getUTCHours(),dayType:[0,6].includes(date.getUTCDay())?'weekend':'weekday',day,status:kind==='situation'?'auto':'open',text:kind==='data'?maskText(body.text):'',member:!!user,created:at});
   return {ok:true};
  },
  // 공개 집계: 최근 현장 제보만, 임계치를 넘은 것만 보여 준다.
  async summary(stopId){
   if(typeof stopId!=='string'||!STOP.test(stopId))fail('invalidRequest');
   const since=now()-SITUATION_MINUTES*MINUTE,counts=new Map();
   for(const r of await store.recordList('field_reports',{field:'stopId',value:stopId,limit:100})){if(r.kind!=='situation'||r.created<since||r.status==='dismissed')continue;const key=`${r.routeNo}|${r.type}`;counts.set(key,(counts.get(key)||0)+1);}
   return {minutes:SITUATION_MINUTES,reports:[...counts].filter(([,n])=>n>=SITUATION_THRESHOLD).map(([key,count])=>{const [no,type]=key.split('|');return {no,type,count};})};
  },
  async adminList(actor){
   guard(actor);
   const list=await store.recordList('field_reports',{limit:1000}),expired=now()-KEEP_DAYS*86400000,groups=new Map();
   for(const r of list.filter(r=>r.created<expired))await store.recordDelete('field_reports',r.id);
   for(const r of list){if(r.created<expired||r.status==='fixed'||r.status==='dismissed'||r.kind!=='data')continue;const key=`${r.routeNo}|${r.stopId}|${r.type}`;if(!groups.has(key))groups.set(key,{key,routeNo:r.routeNo,stopName:r.stopName,type:r.type,ids:[],texts:[],latest:0});const g=groups.get(key);g.ids.push(r.id);if(r.text)g.texts.push(r.text);g.latest=Math.max(g.latest,r.created);}
   const situation=new Map();
   for(const r of list){if(r.kind!=='situation'||r.created<now()-7*86400000)continue;situation.set(r.type,(situation.get(r.type)||0)+1);}
   return {groups:[...groups.values()].sort((a,b)=>b.ids.length-a.ids.length||b.latest-a.latest),week:Object.fromEntries(situation)};
  },
  async closeGroup(actor,ids,action){
   guard(actor);if(!['fixed','dismissed'].includes(action)||!Array.isArray(ids)||!ids.length||ids.length>200)fail('invalidRequest');
   for(const id of ids){if(typeof id!=='string'||!REQUEST.test(id))fail('invalidRequest');const r=await store.recordGet('field_reports',id);if(r)await store.recordPut('field_reports',id,{...r,status:action,closed:now()});}
   return {ok:true,count:ids.length};
  },
  async changelog(){return {changes:(await store.recordList('change_log',{limit:50})).filter(c=>c.status==='published').sort((a,b)=>b.created-a.created).slice(0,10).map(({id,title,body,routeNo,reportCount,created})=>({id,title,body,routeNo,reportCount,created}))};},
  async saveChange(actor,body){
   guard(actor);
   const id=randomBytes(16).toString('hex'),reportCount=Number(body?.reportCount||0);
   if(!Number.isInteger(reportCount)||reportCount<0||reportCount>9999)fail('invalidRequest');
   const change={id,title:value(body?.title,60,'noticeTitle'),body:value(body?.body,300,'noticeBody'),routeNo:typeof body?.routeNo==='string'&&NUMBER.test(body.routeNo)?body.routeNo:'',reportCount,status:'published',created:now()};
   await store.recordPut('change_log',id,change);return change;
  }
 };
}
