// 어드민: 노선별 운행 변경 안내와 운영 통계.
// 노선 자체는 TAGO 공공데이터라 고치지 않는다. 운영자는 공식 출처가 있는 안내만 덧붙인다.
import {randomBytes} from 'node:crypto';
import {ServiceError} from './catalog.mjs';
import {adminOf} from './admin.mjs';
import {koreaDay} from './telemetry.mjs';
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const CONTEXT=/^(route|stop):[\w:.-]{1,100}$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const newest=(a,b)=>(b.created||0)-(a.created||0);
const text=(value,min,max,key)=>{if(typeof value!=='string')fail(key);const t=value.trim();if([...t].length<min||[...t].length>max)fail(key);return t;};
function https(value){if(value===undefined||value==='')return '';try{const u=new URL(value);if(u.protocol==='https:')return u.href;}catch{}fail('noticeSource');}
function period(value){if(value===undefined||value==='')return '';if(typeof value!=='string'||!DAY.test(value)||Number.isNaN(Date.parse(value)))fail('noticePeriod');return value;}

export function createRouteAdmin(config,store,{now=Date.now}={}){
 const guard=actor=>{if(!adminOf(config,actor))fail('forbidden',403);};
 const live=(n,today)=>n.status==='published'&&(!n.startsOn||n.startsOn<=today)&&(!n.endsOn||today<=n.endsOn);
 const view=({author,...n})=>n;
 return {
  // 고객 화면: 공개 상태이고 오늘이 적용 기간 안에 있는 안내만 준다.
  async notices(context){
   if(typeof context!=='string'||!CONTEXT.test(context))fail('invalidRequest');
   const today=koreaDay(now());
   return {notices:(await store.recordList('notices',{field:'context',value:context,limit:50})).filter(n=>live(n,today)).sort(newest).slice(0,5).map(({id,title,body,startsOn,endsOn,sourceUrl,created})=>({id,title,body,startsOn,endsOn,sourceUrl,created}))};
  },
  async saveNotice(actor,body){
   guard(actor);
   const prior=body?.id?await store.recordGet('notices',String(body.id)):null;if(body?.id&&(!prior||prior.status==='deleted'))fail('notFound',404);
   if(typeof body?.context!=='string'||!CONTEXT.test(body.context))fail('noticeRoute');
   const startsOn=period(body.startsOn),endsOn=period(body.endsOn);if(startsOn&&endsOn&&endsOn<startsOn)fail('noticePeriod');
   const id=prior?.id||randomBytes(16).toString('hex');
   await store.recordPut('notices',id,{id,context:body.context,routeName:text(body.routeName,1,40,'noticeRoute'),title:text(body.title,2,80,'noticeTitle'),body:text(body.body,5,500,'noticeBody'),startsOn,endsOn,sourceUrl:https(body.sourceUrl),status:prior?.status||'published',author:actor.id,created:prior?.created||now(),updated:now()});
   return {id};
  },
  async setNotice(actor,id,action){
   guard(actor);if(!['hide','show','delete'].includes(action))fail('invalidRequest');
   const prior=await store.recordGet('notices',id);if(!prior||prior.status==='deleted')fail('notFound',404);
   await store.recordPut('notices',id,{...prior,status:action==='hide'?'hidden':action==='show'?'published':'deleted',updated:now()});return {ok:true};
  },
  // 대시보드: 개인정보 없이 건수와 노선별 관심도만 모은다.
  async overview(actor){
   guard(actor);
   const [reviews,saved,inquiries,notices,reports,users]=await Promise.all([store.recordList('reviews',{limit:1000}),store.recordList('saved',{limit:1000}),store.recordList('inquiries',{limit:1000}),store.recordList('notices',{limit:300}),store.listReports(),store.adminUsers()]);
   const today=koreaDay(now()),weekAgo=now()-7*86400000,routes=new Map();
   const row=(context,name)=>{if(!routes.has(context))routes.set(context,{context,name:name||context.split(':')[1],saved:0,reviews:0,total:0,inquiries:0,notices:0});const r=routes.get(context);if(name&&r.name===context.split(':')[1])r.name=name;return r;};
   for(const s of saved)if(s.item?.id)row(`route:${s.item.id}`,s.item.number).saved++;
   for(const r of reviews)if(r.status==='published'){const x=row(r.context,r.contextName);x.reviews++;x.total+=r.rating;}
   for(const q of inquiries)if(q.context)row(q.context,q.contextName).inquiries++;
   const active=notices.filter(n=>n.status!=='deleted');
   for(const n of active)if(live(n,today))row(n.context,n.routeName).notices++;
   const people=users.filter(u=>!String(u.id).startsWith('sample:')&&u.status!=='withdrawn');
   return {today,counts:{members:people.length,newMembers:people.filter(u=>(u.created||0)>=weekAgo).length,activeMembers:people.filter(u=>(u.lastLogin||0)>=weekAgo).length,openInquiries:inquiries.filter(q=>q.status==='open').length,reviews:reviews.filter(r=>r.status==='published').length,hiddenReviews:reviews.filter(r=>r.status==='hidden').length,openReports:reports.filter(r=>r.status==='open').length,liveNotices:active.filter(n=>live(n,today)).length,saved:saved.length,samplePaid:inquiries.filter(q=>['paid','test_paid'].includes(q.payStatus)).length},
    routes:[...routes.values()].map(({total,...r})=>({...r,average:r.reviews?Math.round(total/r.reviews*10)/10:null})).sort((a,b)=>(b.saved+b.reviews+b.inquiries)-(a.saved+a.reviews+a.inquiries)).slice(0,30),
    notices:active.sort(newest).map(view)};
  }
 };
}
