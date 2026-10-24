import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../server.mjs';
import {createAdminService,ownerOf} from '../lib/admin.mjs';
import {metricEvent,accumulateMetric} from '../lib/telemetry.mjs';
const baseConfig={adminSubjects:['owner'],adminEmails:['owner@example.com'],tagoKey:'SERVER-SECRET',tagoDailyLimit:1000,kakaoKey:'KAKAO-SECRET',kakaoEnabled:true,kakaoDailyLimit:100,odsayKey:'',odsayEnabled:false,odsayDailyLimit:25,aiKey:'OPENAI-SECRET',aiEnabled:true,aiModel:'gpt-5.4-mini',aiApprovalId:'approval-admin-test',aiApprovalUntil:new Date(Date.now()+86400000).toISOString(),aiDailyLimit:20,aiPeriodCalls:100};
const owner={id:'google:owner',name:'Owner'},member={id:'google:member',name:'Member'};

test('members can be suspended, restored and globally signed out while the owner stays protected',async()=>{
 const store=createStore(':memory:');try{
  store.createSession(owner.id,owner.name);const token=store.createSession(member.id,member.name,{email:'member@example.com'});const admin=createAdminService(baseConfig,store);
  await assert.rejects(admin.dashboard(member),{key:'forbidden'});await assert.rejects(admin.updateUser(member,owner.id,{action:'promote'}),{key:'forbidden'});
  await admin.updateUser(owner,member.id,{action:'suspend'});assert.equal(store.user(token),null);assert.throws(()=>store.createSession(member.id,member.name),{key:'accountSuspended'});
  await admin.updateUser(owner,member.id,{action:'restore'});assert.equal(store.user(token),null);const fresh=store.createSession(member.id,member.name);assert.ok(store.user(fresh));
  await admin.updateUser(owner,member.id,{action:'revoke'});assert.equal(store.user(fresh),null);
  await assert.rejects(admin.updateUser(owner,owner.id,{action:'suspend'}),{key:'protectedAccount'});
  await admin.updateUser(owner,member.id,{action:'promote'});assert.equal(store.adminUsers().find(u=>u.id===member.id).role,'admin');assert.equal(store.audit().length,4);
 }finally{store.close();}
});

test('API controls cap approved usage, block new requests and cannot renew billing approval',async()=>{
 const store=createStore(':memory:');try{
  let now=Date.now();const a=createAdminService(baseConfig,store,{now:()=>now}),b=createAdminService(baseConfig,store,{now:()=>now});
  await assert.rejects(a.updateProvider(owner,'ai',{enabled:true,dailyLimit:21,periodLimit:100}),{key:'invalidRequest'});
  await assert.rejects(a.updateProvider(owner,'ai',{enabled:true,dailyLimit:20,periodLimit:101}),{key:'invalidRequest'});
  await assert.rejects(a.updateProvider(owner,'ai',{enabled:true,dailyLimit:20,expiresAt:'2099'}),{key:'invalidRequest'});
  await assert.rejects(a.updateProvider(owner,'odsay',{enabled:true,dailyLimit:25}),{key:'providerActivationRequired'});
  await a.updateProvider(owner,'tago',{enabled:false,dailyLimit:3});await assert.rejects(a.consume('tago',1000),{key:'servicePaused'});
  await a.updateProvider(owner,'tago',{enabled:true,dailyLimit:1});await a.consume('tago',1000);await assert.rejects(a.consume('tago',1000),{key:'quotaReached'});
  assert.equal(await b.allowed('ai'),true);await a.updateProvider(owner,'ai',{enabled:false,dailyLimit:20,periodLimit:100});now+=10001;assert.equal(await b.allowed('ai'),false);
 }finally{store.close();}
});

test('dashboard redacts credentials, aggregates actual tokens and isolates approval-period spending',async()=>{
 const store=createStore(':memory:');try{
  store.createSession(owner.id,owner.name);store.consumeApi('ai_budget',100,'approval:approval-admin-test');store.consumeApi('ai',20);
  store.recordMetric({provider:'ai',period:'approval-admin-test',ok:true,usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200}},durationMs:50});
  store.recordMetric({provider:'ai',period:'old-approval',ok:true,usage:{input_tokens:1000000,output_tokens:1000000},durationMs:50});
  const result=await createAdminService(baseConfig,store).dashboard(owner),serialized=JSON.stringify(result);
  for(const secret of ['SERVER-SECRET','KAKAO-SECRET','OPENAI-SECRET','token_hash','private_key'])assert.equal(serialized.includes(secret),false);
  assert.equal(result.ai.inputTokens,1000);assert.equal(result.ai.cachedTokens,200);assert.equal(result.ai.estimatedMicroUsd,1065);assert.equal(result.ai.periodCalls,1);assert.equal(result.ai.remaining,99);
  assert.equal(result.users[0].role,'owner');assert.equal(result.providers.find(p=>p.id==='ai').configured,true);
 }finally{store.close();}
});

test('telemetry stores integer costs and no prompt, token, key or request payload',()=>{
 const event=metricEvent({provider:'ai',usage:{input_tokens:100,output_tokens:10},ok:true,secret:'never',prompt:'never',durationMs:5});
 assert.equal(event.estimatedMicroUsd,120);assert.equal(JSON.stringify(event).includes('never'),false);
 const aggregate=accumulateMetric({},event);assert.equal(aggregate.inputTokens,100);assert.equal(aggregate.outputTokens,10);assert.equal(aggregate.successes,1);
 assert.equal(ownerOf(baseConfig,{id:'google:other',email:'owner@example.com'}),true);assert.equal(ownerOf(baseConfig,{id:'google:other'}),false);
});

test('dashboard HTTP API enforces server role and same-origin checks',async()=>{
 const store=createStore(':memory:');const ownerToken=store.createSession(owner.id,owner.name),memberToken=store.createSession(member.id,member.name);
 const app=await createApp({store,env:{APP_ORIGIN:'http://localhost:3000',ADMIN_GOOGLE_SUBS:'owner'}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 const request=(path,token,options={})=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Origin:base,...(token?{Cookie:`jeju_session=${token}`} : {}),...options.headers}});
 try{
  assert.equal((await request('/api/admin/dashboard',null)).status,403);assert.equal((await request('/api/admin/dashboard',memberToken)).status,403);
  const result=await request('/api/admin/dashboard',ownerToken);assert.equal(result.status,200);assert.equal((await result.json()).users.length,2);
  const denied=await request('/api/admin/providers/tago',ownerToken,{method:'PUT',headers:{Origin:'https://evil.example'},body:JSON.stringify({enabled:false,dailyLimit:1})});assert.equal(denied.status,403);
  assert.equal((await request('/api/admin/users/'+encodeURIComponent(member.id),memberToken,{method:'POST',body:JSON.stringify({action:'promote'})})).status,403);
 }finally{await new Promise(resolve=>app.server.close(resolve));store.close();}
});
