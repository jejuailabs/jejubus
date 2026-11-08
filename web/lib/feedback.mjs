// 개발자에게 바란다: 커뮤니티의 suggest 글을 어드민에서 상태와 메모로 관리한다.
// 상태는 관리자만 보는 기록(suggest_status)이고, 글 자체는 커뮤니티 글 그대로다.
import {ServiceError} from './catalog.mjs';
import {adminOf} from './admin.mjs';

export const SUGGEST_STATES=['new','review','done','hold'];
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const plain=v=>typeof v==='object'&&v?v.ko||Object.values(v)[0]||'':String(v??'');

export function createFeedback(config,store,{now=Date.now}={}){
 async function posts(){
  // Firestore는 최근 100개만 주는 목록 대신 분류로 바로 찾는다.
  if(store.leasedQuota)return (await store.recordList('posts',{field:'category',value:'suggest',limit:300})).filter(p=>p.status==='published');
  const list=await store.listPosts(null,{includeSamples:false});
  return list.filter(p=>p.category==='suggest'&&!p.sample);
 }
 return {
  async adminList(actor){
   if(!adminOf(config,actor))fail('forbidden',403);
   const [items,marks]=await Promise.all([posts(),store.recordList('suggest_status',{limit:500})]);
   const byId=new Map(marks.map(m=>[m.id,m]));
   const suggestions=items.map(p=>{const m=byId.get(p.id)||{};return {id:p.id,title:plain(p.title),body:plain(p.body),author:p.author||'',created:p.created,replies:p.replies||0,likes:p.likes||0,route:p.route,status:SUGGEST_STATES.includes(m.status)?m.status:'new',note:m.note||'',updated:m.updated||null};}).sort((a,b)=>b.created-a.created);
   const counts=Object.fromEntries(SUGGEST_STATES.map(s=>[s,suggestions.filter(x=>x.status===s).length]));
   return {suggestions,counts,total:suggestions.length};
  },
  async setStatus(actor,id,body){
   if(!adminOf(config,actor))fail('forbidden',403);
   if(typeof id!=='string'||!/^[\w:-]{1,80}$/.test(id)||!body||!SUGGEST_STATES.includes(body.status)||(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>300)))fail('invalidRequest');
   if(!await store.postExists(id))fail('notFound',404);
   await store.recordPut('suggest_status',id,{id,status:body.status,note:(body.note||'').trim(),updated:now(),actor:actor.id});
   return {ok:true};
  }
 };
}
