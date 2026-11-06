// 회원 기능: 후기, 찜, 문의, 마이페이지, 탈퇴.
// 작성자와 소유자는 항상 서버가 세션으로 정한다. 화면이 보낸 이름이나 회원번호는 쓰지 않는다.
import {createHash} from 'node:crypto';
import {ServiceError} from './catalog.mjs';
import {adminOf,ownerOf} from './admin.mjs';

export const WITHDRAWN_NAME='탈퇴한 회원';
const CONTEXT=/^(route|stop):[\w:.-]{1,100}$/,REQUEST=/^[\w-]{8,80}$/;
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const length=text=>[...text].length;
function text(value,min,max,key){if(typeof value!=='string')fail(key);const trimmed=value.trim();if(length(trimmed)<min||length(trimmed)>max)fail(key);return trimmed;}
const label=value=>typeof value==='string'?value.trim().slice(0,80):'';
const newest=(a,b)=>(b.created||0)-(a.created||0);

export function createMemberService(config,store,{now=Date.now,notify=async()=>false}={}){
 const review=r=>({id:r.id,nickname:r.nickname,rating:r.rating,text:r.text,created:r.created,updated:r.updated||null,contextName:r.contextName||''});
 const rating=value=>Number.isInteger(value)&&value>=1&&value<=5?value:fail('reviewRating');
 const context=value=>typeof value==='string'&&CONTEXT.test(value)?value:fail('invalidRequest');
 const owned=async(user,id)=>{const r=await store.recordGet('reviews',id);if(!r||r.status==='deleted')fail('notFound',404);if(r.user_id!==user.id)fail('forbidden',403);return r;};
 const requireAdmin=actor=>{if(!adminOf(config,actor))fail('forbidden',403);};
 return {
  async reviews(contextId,uid){
   const rows=(await store.recordList('reviews',{field:'context',value:context(contextId),limit:300})).filter(r=>r.status==='published').sort(newest);
   const total=rows.reduce((sum,r)=>sum+r.rating,0);
   return {summary:{count:rows.length,average:rows.length?Math.round(total/rows.length*10)/10:null},reviews:rows.slice(0,50).map(r=>({...review(r),owned:!!uid&&r.user_id===uid}))};
  },
  // 회원 한 명이 한 노선·정류장에 후기 하나: 다시 쓰면 수정되어 별점 평균이 쏠리지 않는다.
  async saveReview(user,body){
   const contextId=context(body?.context),id=digest(`${user.id}|${contextId}`).slice(0,32),prior=await store.recordGet('reviews',id);
   if(prior?.status==='hidden')fail('reviewHidden',403);
   const data={id,context:contextId,contextName:label(body.contextName),user_id:user.id,nickname:user.name,rating:rating(body.rating),text:text(body.text,5,200,'reviewText'),status:'published',created:prior?.created||now(),...(prior?{updated:now()}:{})};
   await store.recordPut('reviews',id,data);if(!prior)await notify(`⭐ 새 후기 · ${data.contextName||contextId}`);return {id};
  },
  async updateReview(user,id,body){const prior=await owned(user,id);if(prior.status==='hidden')fail('reviewHidden',403);await store.recordPut('reviews',id,{...prior,rating:rating(body?.rating),text:text(body?.text,5,200,'reviewText'),updated:now()});return {ok:true};},
  async deleteReview(user,id){const prior=await owned(user,id);await store.recordPut('reviews',id,{...prior,status:'deleted',updated:now()});return {ok:true};},
  async adminReviews(actor){requireAdmin(actor);return {reviews:(await store.recordList('reviews',{limit:300})).filter(r=>r.status!=='deleted').sort(newest).map(r=>({...review(r),status:r.status}))};},
  async setReviewHidden(actor,id,hide){requireAdmin(actor);if(typeof hide!=='boolean')fail('invalidRequest');const prior=await store.recordGet('reviews',id);if(!prior||prior.status==='deleted')fail('notFound',404);await store.recordPut('reviews',id,{...prior,status:hide?'hidden':'published',updated:now()});return {ok:true};},

  async saved(user){return {saved:(await store.recordList('saved',{field:'user_id',value:user.id,limit:60})).sort(newest).map(s=>s.item)};},
  // saved가 true/false면 그 상태로 맞추고, 없으면 뒤집는다(기기의 관심 노선을 올릴 때 true로 합친다).
  async toggleSaved(user,body){
   const item=body?.item,itemId=item?.id;if(typeof itemId!=='string'||!/^[\w:.-]{1,100}$/.test(itemId)||typeof item.number!=='string'||!item.number)fail('invalidRequest');
   const id=digest(`${user.id}|${itemId}`).slice(0,32),prior=await store.recordGet('saved',id);
   if(prior&&body.saved!==true){await store.recordDelete('saved',id);return {saved:false};}
   if(prior)return {saved:true};if(body.saved===false)return {saved:false};
   if((await store.recordList('saved',{field:'user_id',value:user.id,limit:60})).length>=50)fail('savedLimit',409);
   await store.recordPut('saved',id,{id,user_id:user.id,created:now(),item:{id:itemId,number:label(item.number),start:label(item.start),end:label(item.end),type:label(item.type)}});return {saved:true};
  },

  // 접수 번호는 요청 번호에서 만들어 두 번 눌러도 같은 번호, 같은 한 건이 된다.
  async createInquiry(user,body){
   if(typeof body?.requestId!=='string'||!REQUEST.test(body.requestId))fail('invalidRequest');
   const question=text(body.question,5,200,'inquiryText'),contextId=body.context===undefined||body.context===''||body.context==='general'?'':context(body.context);
   const id=`Q${digest(`${user.id}|${body.requestId}`).slice(0,8).toUpperCase()}`;if(await store.recordGet('inquiries',id))return {id};
   await store.recordPut('inquiries',id,{id,user_id:user.id,context:contextId,contextName:label(body.contextName),question,answer:'',status:'open',created:now(),answered:null});
   await notify(`💬 새 문의 · 접수 번호 ${id}`);return {id};
  },
  async adminInquiries(actor){requireAdmin(actor);const rows=(await store.recordList('inquiries',{limit:300})).sort(newest);return {inquiries:rows.map(({user_id,...q})=>q),open:rows.filter(q=>q.status==='open').length};},
  async answerInquiry(actor,id,body){requireAdmin(actor);if(!/^Q[0-9A-F]{8}$/.test(id))fail('invalidRequest');const prior=await store.recordGet('inquiries',id);if(!prior)fail('notFound',404);await store.recordPut('inquiries',id,{...prior,answer:text(body?.answer,2,500,'inquiryAnswer'),status:'answered',answered:now()});return {ok:true};},

  // 회원번호(user_id)는 화면으로 보내지 않는다.
  async me(user){
   const [account,saved,reviews,inquiries]=await Promise.all([store.accountOf(user.id),store.recordList('saved',{field:'user_id',value:user.id,limit:60}),store.recordList('reviews',{field:'user_id',value:user.id,limit:200}),store.recordList('inquiries',{field:'user_id',value:user.id,limit:200})]);
   return {profile:{name:user.name,provider:user.id.split(':')[0],created:account?.created||null,lastLogin:account?.lastLogin||null,visits:account?.visits||0,protected:ownerOf(config,user)},
    saved:saved.sort(newest).map(s=>s.item),
    reviews:reviews.filter(r=>r.status!=='deleted').sort(newest).map(r=>({...review(r),status:r.status})),
    inquiries:inquiries.sort(newest).map(({user_id,...q})=>q)};
  },
  async withdraw(user,body){
   if(body?.confirm!==true)fail('invalidRequest');if(ownerOf(config,user))fail('protectedAccount',403);
   const [saved,reviews,inquiries]=await Promise.all([store.recordList('saved',{field:'user_id',value:user.id,limit:60}),store.recordList('reviews',{field:'user_id',value:user.id,limit:300}),store.recordList('inquiries',{field:'user_id',value:user.id,limit:300})]);
   for(const s of saved)await store.recordDelete('saved',s.id);
   for(const q of inquiries)await store.recordDelete('inquiries',q.id);
   for(const r of reviews)await store.recordPut('reviews',r.id,{...r,user_id:null,nickname:WITHDRAWN_NAME});
   await store.withdraw(user.id,WITHDRAWN_NAME);return {ok:true};
  }
 };
}
