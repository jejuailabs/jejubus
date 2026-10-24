import {ServiceError} from './catalog.mjs';
import {chatConfigured,CHAT_MODEL} from './bus-chat.mjs';
import {koreaDay} from './telemetry.mjs';
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
export const ownerOf=(config,user)=>!!(user&&((config.adminSubjects||[]).includes(user.id.replace(/^google:/,''))||(user.email&&config.adminEmails?.includes(user.email.toLowerCase()))));
export const adminOf=(config,user)=>!!(user&&(ownerOf(config,user)||user.role==='admin'));

export function createAdminService(config,store,{now=Date.now}={}){
 const cache=new Map();
 const definitions=()=>[
  {id:'tago',name:'TAGO',configured:!!config.tagoKey,available:!!config.tagoKey,max:config.tagoDailyLimit},
  {id:'kakao',name:'Kakao Places',configured:!!config.kakaoKey,available:!!(config.kakaoKey&&config.kakaoEnabled),max:config.kakaoDailyLimit},
  {id:'kakao-routing',name:'Kakao Routing',configured:!!config.kakaoKey,available:!!(config.kakaoKey&&config.kakaoEnabled),max:100},
  {id:'odsay',name:'ODsay',configured:!!config.odsayKey,available:!!(config.odsayKey&&config.odsayEnabled),max:config.odsayDailyLimit},
  {id:'ai',name:'OpenAI',configured:!!config.aiKey,available:chatConfigured(config,now()),max:config.aiDailyLimit},
 ];
 async function control(id){const entry=cache.get(id);if(entry?.until>now())return entry.value;const value=await store.control?.(id)||{};cache.set(id,{value,until:now()+10000});return value;}
 return {
  async allowed(id){return (await control(id)).enabled!==false;},
  async consume(provider,limit,period){const key=provider==='ai_budget'?'ai':provider,c=await control(key);if(c.enabled===false)fail('servicePaused',503);const effective=Math.min(limit,provider==='ai_budget'?c.periodLimit||limit:c.dailyLimit||limit);return store.consumeApi(provider,effective,period);},
  async dashboard(actor){
   if(!adminOf(config,actor))fail('forbidden',403);
   const [usage,metrics,users,controls,audit]=await Promise.all([store.usage(500),store.metrics(),store.adminUsers(),store.controls(),store.audit()]);
   const today=koreaDay(now()),period=`approval:${config.aiApprovalId}`;
   const providers=definitions().map(p=>{const c=controls.find(c=>c.provider===p.id)||{},limit=Math.min(p.max,c.dailyLimit||p.max),count=usage.find(r=>r.provider===p.id&&r.day===today)?.count||0;return {...p,enabled:c.enabled!==false,limit,count,remaining:Math.max(0,limit-count)};});
   const stats=metrics.filter(m=>m.provider==='ai'&&m.period===config.aiApprovalId).reduce((a,m)=>{for(const k of Object.keys(a))a[k]+=m[k]||0;return a;},{inputTokens:0,outputTokens:0,cachedTokens:0,estimatedMicroUsd:0,unreported:0,requests:0,failures:0});
   const periodLimit=Math.min(config.aiPeriodCalls,(controls.find(c=>c.provider==='ai')||{}).periodLimit||config.aiPeriodCalls),periodCalls=usage.find(r=>r.provider==='ai_budget'&&r.day===period)?.count||0;
   return {generatedAt:new Date(now()).toISOString(),today,actor:{id:actor.id,name:actor.name,owner:ownerOf(config,actor)},providers,metrics,usage,
    ai:{model:CHAT_MODEL,approved:chatConfigured(config,now()),approvalId:config.aiApprovalId,expiresAt:config.aiApprovalUntil,periodLimit,periodCalls,remaining:Math.max(0,periodLimit-periodCalls),reservationMicroUsd:periodCalls*30000,approvedCeilingMicroUsd:config.aiPeriodCalls*30000,...stats},
    users:users.filter(u=>!u.id.startsWith('sample:')).map(u=>({id:u.id,name:u.name,email:u.email||'',role:ownerOf(config,u)?'owner':u.role||'member',status:u.status||'active',created:u.created||null,lastLogin:u.lastLogin||null})),audit};
  },
  async updateUser(actor,id,body){
   if(!adminOf(config,actor))fail('forbidden',403);
   if(typeof id!=='string'||id.length>300||!body||!['suspend','restore','revoke','promote','demote'].includes(body.action))fail('invalidRequest');
   const target=(await store.adminUsers()).find(u=>u.id===id);if(!target)fail('notFound',404);
   if(ownerOf(config,target)||id===actor.id)fail('protectedAccount',403);
   if(['promote','demote'].includes(body.action)&&!ownerOf(config,actor))fail('forbidden',403);
   if(target.role==='admin'&&!ownerOf(config,actor))fail('forbidden',403);
   const patch=body.action==='suspend'?{status:'suspended'}:body.action==='restore'?{status:'active'}:body.action==='promote'?{role:'admin'}:body.action==='demote'?{role:'member'}:{};
   await store.adminUserUpdate(id,{...patch,action:body.action,actor:actor.id});return {ok:true};
  },
  async updateProvider(actor,id,body){
   if(!adminOf(config,actor))fail('forbidden',403);
   const definition=definitions().find(p=>p.id===id);if(!definition||!body||typeof body.enabled!=='boolean'||!Number.isInteger(body.dailyLimit)||body.dailyLimit<1||body.dailyLimit>definition.max||Object.keys(body).some(k=>!['enabled','dailyLimit','periodLimit'].includes(k)))fail('invalidRequest');
   if(body.periodLimit!==undefined&&(id!=='ai'||!Number.isInteger(body.periodLimit)||body.periodLimit<1||body.periodLimit>config.aiPeriodCalls))fail('invalidRequest');
   if(body.enabled&&!definition.available)fail('providerActivationRequired',403);
   await store.setControl(id,body,actor.id);cache.delete(id);return {ok:true};
  }
 };
}
