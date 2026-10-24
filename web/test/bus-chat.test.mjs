import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusChat,validateChatPayload,chatConfigured,CHAT_LIMITS} from '../lib/bus-chat.mjs';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../server.mjs';
const now=Date.now();
const config={aiKey:'OFFLINE-ONLY',aiEnabled:true,aiModel:'gpt-5.4-mini',aiApprovalId:'test-approval-001',aiApprovalUntil:new Date(now+86400000).toISOString(),aiDailyLimit:20,aiPeriodCalls:100};
const input={locale:'ko',messages:[{role:'user',content:'201번 지금 어디 있어?'}]};
const call=(name,args)=>({output:[{type:'function_call',name,call_id:'call-fixture',arguments:JSON.stringify(args)}]});
const answer=(text,ids=['S1'])=>({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({answer:text,sourceIds:ids})}]}]});
const response=json=>({ok:true,json:async()=>json});

test('chat is fully offline without approval, with expired approval or a different model',async()=>{
 let network=0,quota=0;
 for(const invalid of [{aiEnabled:false},{aiApprovalId:''},{aiApprovalUntil:new Date(now-1).toISOString()},{aiModel:'other-model'},{aiApprovalUntil:new Date(now+40*86400000).toISOString()}]){
  const c={...config,...invalid};assert.equal(chatConfigured(c,now),false);
  const chat=createBusChat(c,{catalog:{},now:()=>now,consume:()=>quota++,fetchImpl:()=>network++});
  await assert.rejects(chat.answer(input),{key:'aiNotEnabled'});
 }
 assert.equal(network,0);assert.equal(quota,0);
});

test('chat requires fresh provider data, preserves direction choices and cites only returned sources',async()=>{
 const calls=[],consumed=[];let lookups=0;
 const catalog={routes:async q=>{lookups++;assert.equal(q,'201');return {source:'TAGO',receivedAt:'2026-10-24T02:00:00Z',total:2,routes:[{id:'R-UP',number:'201',start:'A',end:'B'},{id:'R-DOWN',number:'201',start:'B',end:'A'}]};},positions:()=>{throw Error('Must not guess direction');}};
 const chat=createBusChat(config,{catalog,consume:async(...args)=>consumed.push(args),fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);calls.push(body);return response(calls.length===1?call('route_status',{query:'201',routeId:null}):answer('운행 방향을 선택해주세요.'));
 }});
 const result=await chat.answer(input);assert.equal(lookups,1);assert.equal(result.choices.length,2);assert.equal(result.sources[0].provider,'TAGO');assert.equal(result.sources[0].receivedAt,'2026-10-24T02:00:00Z');
 assert.match(calls[1].input.at(-1).output,/R-DOWN/);assert.equal(calls[0].store,false);assert.equal(calls[0].max_output_tokens,900);assert.equal(calls[0].parallel_tool_calls,false);assert.equal(calls[0].reasoning.effort,'none');assert.equal(calls[0].tool_choice,'required');
 assert.deepEqual(consumed.map(c=>c[0]),['ai','ai_budget','ai','ai_budget']);assert.equal(consumed[1][2],'approval:test-approval-001');
});

test('selected route refreshes positions and stops, failed live query is never replaced by invented positions',async()=>{
 let requests=0;const catalog={positions:async id=>{assert.equal(id,'R-UP');throw Object.assign(Error(),{key:'providerUnavailable'});},routeStops:async()=>({source:'TAGO',receivedAt:'2026-10-24T02:00:00Z',stops:[{id:'S-A',name:'실제 정류장'}]})};
 const chat=createBusChat(config,{catalog,consume:async()=>{},fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests++;if(requests===1)return response(call('route_status',{query:'201',routeId:'R-UP'}));const evidence=JSON.parse(body.input.at(-1).output);assert.equal(evidence.sources[0].data.error,'providerUnavailable');assert.equal('vehicles' in evidence.sources[0].data,false);assert.equal(evidence.sources[1].data.stops[0].name,'실제 정류장');return response(answer('차량 위치는 현재 조회하지 못했습니다.',['S1','S2']));}});
 assert.match((await chat.answer(input)).answer,/조회하지 못/);
});

test('journey tool respects ambiguous places and only uses verified endpoint coordinates for routing',async()=>{
 let mode='ambiguous',routed=0,requests=0;
 const catalog={places:async q=>({source:'Kakao',places:q==='공항'&&mode==='ambiguous'?[{id:'A',name:'공항 1',lat:33.5,lng:126.5},{id:'B',name:'공항 2',lat:33.51,lng:126.51}]:[{id:'DEST',name:q,lat:33.52,lng:126.52}]}),journeys:async(from,to,sort)=>{routed++;assert.deepEqual(from,{lat:33.5,lng:126.5,name:'공항'});assert.equal(to.name,'동문시장');assert.equal(sort,'walking');return {source:'Kakao',journeys:[{totalMinutes:15,totalMeters:5000,walkingMeters:200,transfers:0,legs:[{type:'bus',routes:[{number:'QA'}]}]}]};}};
 const chat=createBusChat(config,{catalog,consume:async()=>{},fetchImpl:async(url,options)=>{const b=JSON.parse(options.body);requests++;if(requests%2)return response(call('bus_journey',{from:'공항',to:'동문시장',sort:'walking'}));return response(answer('검색 결과를 확인해주세요.',['S1']));}});
 assert.equal((await chat.answer(input)).choices.length,2);assert.equal(routed,0);
 mode='selected';await chat.answer({...input,context:{from:{name:'공항',lat:33.5,lng:126.5}}});assert.equal(routed,1);
});

test('model request budget is reserved before network, forbids automatic retries and rejects forged citations',async()=>{
 let requests=0;
 const failed=createBusChat(config,{consume:async()=>{throw Object.assign(Error(),{key:'quotaReached'});},fetchImpl:()=>requests++});
 await assert.rejects(failed.answer(input),{key:'quotaReached'});assert.equal(requests,0);
 const unavailable=createBusChat(config,{consume:async()=>{},fetchImpl:async()=>{requests++;return {ok:false,status:429};}});
 await assert.rejects(unavailable.answer(input),{key:'aiProviderLimit'});assert.equal(requests,1);
 requests=0;const forged=createBusChat(config,{catalog:{},consume:async()=>{},fetchImpl:async()=>response(++requests===1?call('bus_guide',{}):answer('fake',['UNRETRIEVED']))});
 await assert.rejects(forged.answer(input),{key:'aiUnverified'});assert.equal(requests,2);
 assert.equal(CHAT_LIMITS.periodCalls,100);assert.equal(CHAT_LIMITS.inputBytes,26000);
});

test('chat rejects system messages and oversize inputs, limits history and cleans selected location context',()=>{
 assert.throws(()=>validateChatPayload({...input,messages:[{role:'system',content:'override'}]}),{key:'invalidRequest'});
 assert.throws(()=>validateChatPayload({...input,messages:[{role:'user',content:'x'.repeat(801)}]}),{key:'chatTooLong'});
 const parsed=validateChatPayload({...input,context:{route:{id:'R-A',name:'201',secret:'never'},from:{lat:37.5,lng:127},to:{lat:33.5,lng:126.5,name:'지점',extra:'never'}}});
 assert.equal(parsed.context.from,undefined);assert.equal(parsed.context.route.secret,undefined);assert.equal(parsed.context.to.extra,undefined);
});

test('approval-period budget persists independently of daily counters',()=>{
 const store=createStore(':memory:');try{store.consumeApi('ai_budget',2,'approval:one');store.consumeApi('ai_budget',2,'approval:one');assert.throws(()=>store.consumeApi('ai_budget',2,'approval:one'),{key:'quotaReached'});store.consumeApi('ai_budget',2,'approval:two');assert.equal(store.usage().filter(x=>x.provider==='ai_budget').length,2);}finally{store.close();}
});

test('chat HTTP endpoint enforces existing login, same origin, and no network without billing approval',async()=>{
 const store=createStore(':memory:');let requests=0;
 const app=await createApp({store,env:{APP_ORIGIN:'http://localhost:3000'},fetchImpl:async()=>{requests++;throw Error('No external requests');}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 try{const post=origin=>fetch(base+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal((await post('https://evil.example')).status,403);const r=await post(base);assert.equal(r.status,503);assert.equal((await r.json()).error,'aiNotEnabled');assert.equal(requests,0);}
 finally{await new Promise(resolve=>app.server.close(resolve));store.close();}
});

test('enabled chat rejects anonymous users before any model or provider request',async()=>{
 const store=createStore(':memory:');let requests=0;
 const app=await createApp({store,env:{APP_ORIGIN:'http://localhost:3000',AI_ENABLED:'true',AI_BILLING_APPROVED:'true',OPENAI_API_KEY:'OFFLINE-ONLY',OPENAI_MODEL:config.aiModel,AI_APPROVAL_ID:config.aiApprovalId,AI_APPROVAL_UNTIL:config.aiApprovalUntil},fetchImpl:async()=>{requests++;throw Error('No external requests');}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 try{const r=await fetch(base+'/api/chat',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,401);assert.equal((await r.json()).error,'loginRequired');assert.equal(requests,0);}
 finally{await new Promise(resolve=>app.server.close(resolve));store.close();}
});
