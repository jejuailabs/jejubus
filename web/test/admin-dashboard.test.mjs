import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../server.mjs';
import {ownerOf,adminOf} from '../lib/admin.mjs';
import {memberTrend,chatStats,quotaBoard,weekOf} from '../lib/insights.mjs';
import {createFeedback} from '../lib/feedback.mjs';
import {adminText} from '../public/admin-copy.js';
import {boardStrings} from '../public/board-strings.js';
import {ctabsMarkup,suggestIntro} from '../public/community.js';

const DAY=86400000,NOW=Date.parse('2026-11-08T12:00:00+09:00');
const ADMIN_MAIL='boss@example.com',config={adminSubjects:[],adminEmails:[ADMIN_MAIL]};
const boss={id:'google:boss',name:'Boss',email:ADMIN_MAIL},rider={id:'google:rider',name:'Rider',email:'rider@example.com'};

test('email admin is accepted only for a Google account, never for other providers or a client flag',()=>{
 assert.equal(ownerOf(config,boss),true);
 assert.equal(ownerOf(config,{...boss,email:'BOSS@example.com'}),true);
 assert.equal(ownerOf(config,{id:'kakao:1',name:'x',email:ADMIN_MAIL}),false);
 assert.equal(ownerOf(config,{id:'naver:1',name:'x',email:ADMIN_MAIL}),false);
 assert.equal(adminOf(config,{...rider,admin:true}),false);
 assert.equal(adminOf(config,null),false);
});

test('member trend counts joins and withdrawals per Korean day and week, without samples',()=>{
 const users=[
  {id:'google:a',status:'active',created:NOW-1000,lastLogin:NOW-1000},
  {id:'google:b',status:'active',created:NOW-DAY,lastLogin:NOW-3*DAY},
  {id:'kakao:c',status:'withdrawn',created:NOW-10*DAY,withdrawn:NOW-2000},
  {id:'google:d',status:'withdrawn',created:NOW-40*DAY},
  {id:'google:e',status:'suspended',created:NOW-20*DAY},
  {id:'sample:f',status:'active',created:NOW}
 ];
 const m=memberTrend(users,{now:NOW});
 assert.equal(m.today,'2026-11-08');
 assert.equal(m.total,3);assert.equal(m.active,2);assert.equal(m.suspended,1);assert.equal(m.withdrawn,2);
 assert.equal(m.joinedToday,1);assert.equal(m.leftToday,1);assert.equal(m.joined7,2);assert.equal(m.left7,1);assert.equal(m.joined30,4);
 assert.equal(m.visited7,2);assert.equal(m.unknownLeft,1);assert.deepEqual(m.providers,{google:3});
 assert.equal(m.daily.length,14);assert.deepEqual(m.daily.at(-1),{day:'2026-11-08',joined:1,left:1});assert.equal(m.daily.at(-2).joined,1);
 assert.equal(weekOf('2026-11-08'),'2026-11-02');assert.equal(weekOf('2026-11-02'),'2026-11-02');
 assert.equal(m.weekly.at(-1).week,'2026-11-02');assert.equal(m.weekly.at(-1).joined,2);
});

test('chat stats join question outcomes with AI calls, tokens and cost',()=>{
 const metrics=[
  {provider:'chat',day:'2026-11-08',period:'assistant:answered',requests:3,durationMs:9000},
  {provider:'chat',day:'2026-11-08',period:'assistant:failed',requests:1,durationMs:1000},
  {provider:'chat',day:'2026-11-08',period:'room:fallback',requests:1,durationMs:0},
  {provider:'chat',day:'2026-11-01',period:'room:answered',requests:2,durationMs:4000},
  {provider:'ai',day:'2026-11-08',period:'p1',requests:7,failures:1,inputTokens:1000,outputTokens:200,estimatedMicroUsd:3000,durationMs:7000},
  {provider:'tago',day:'2026-11-08',period:'',requests:50}
 ];
 const c=chatStats(metrics,{today:'2026-11-08'});
 assert.equal(c.today.questions,5);assert.equal(c.today.answered,3);assert.equal(c.today.failed,1);assert.equal(c.today.fallback,1);
 assert.equal(c.today.assistant,4);assert.equal(c.today.room,1);assert.equal(c.today.aiCalls,7);assert.equal(c.today.aiFailures,1);
 assert.equal(c.today.fallbackRate,.2);assert.equal(c.today.costPerQuestionMicroUsd,1000);assert.equal(c.today.avgAnswerMs,2000);
 assert.equal(c.week.questions,5);assert.equal(c.month.questions,7);assert.equal(c.series.at(-1).questions,5);assert.equal(c.series.at(-1).aiCalls,7);
});

test('quota board marks paid services and leaves uncountable services as check-needed',()=>{
 const providers=[{id:'tago',name:'TAGO',configured:true,available:true,enabled:true,count:250,limit:1000,remaining:750},{id:'ai',name:'OpenAI',configured:true,available:true,enabled:true,count:9,limit:10,remaining:1}];
 const usage=[{provider:'tago',day:'2026-11-08',count:250},{provider:'tago',day:'2026-11-03',count:100},{provider:'tago',day:'2026-10-20',count:999},{provider:'ai_budget',day:'approval:x',count:5}];
 const rows=quotaBoard(providers,{config:{firestore:true},usage,today:'2026-11-08'});
 const tago=rows.find(r=>r.id==='tago'),ai=rows.find(r=>r.id==='ai'),fs=rows.find(r=>r.id==='firestore');
 assert.equal(tago.tier,'free');assert.equal(tago.week,350);assert.equal(tago.ratio,.25);
 assert.equal(ai.tier,'paid');assert.equal(ai.ratio,.9);
 assert.equal(fs.counted,false);assert.equal(fs.count,null);assert.equal(fs.tier,'freeThenPaid');
 assert.equal(quotaBoard(providers,{config:{},usage,today:'2026-11-08'}).some(r=>r.id==='firestore'),false);
 for(const r of rows.filter(r=>!r.counted))assert.notEqual(adminText('ko',r.note),r.note);
});

test('suggestion statuses are admin-only, validated and counted',async()=>{
 const store=createStore(':memory:');try{
  store.createSession(rider.id,rider.name);store.rememberContext({id:'general',name:'Jeju',type:'general'});
  const id=store.createPost(rider.id,{category:'suggest',route:'general',title:'지도 글씨가 작아요',body:'글씨를 키워 주세요'});
  store.createPost(rider.id,{category:'question',route:'general',title:'질문이에요',body:'201번 언제 와요'});
  let at=NOW;const feedback=createFeedback(config,store,{now:()=>at});
  await assert.rejects(feedback.adminList(rider),{key:'forbidden'});await assert.rejects(feedback.setStatus(rider,id,{status:'done'}),{key:'forbidden'});
  let list=await feedback.adminList(boss);
  assert.equal(list.total,1);assert.equal(list.suggestions[0].status,'new');assert.equal(list.suggestions[0].title,'지도 글씨가 작아요');assert.equal(list.counts.new,1);
  await assert.rejects(feedback.setStatus(boss,id,{status:'shipped'}),{key:'invalidRequest'});
  await assert.rejects(feedback.setStatus(boss,id,{status:'done',note:'x'.repeat(301)}),{key:'invalidRequest'});
  await assert.rejects(feedback.setStatus(boss,'missing-post',{status:'done'}),{key:'notFound'});
  await feedback.setStatus(boss,id,{status:'review',note:' 다음 배포 '});
  list=await feedback.adminList(boss);
  assert.equal(list.suggestions[0].status,'review');assert.equal(list.suggestions[0].note,'다음 배포');assert.equal(list.suggestions[0].updated,NOW);assert.deepEqual(list.counts,{new:0,review:1,done:0,hold:0});
 }finally{store.close();}
});

test('withdrawal time is recorded so the trend can chart it',()=>{
 const store=createStore(':memory:');try{
  store.createSession(rider.id,rider.name,{email:rider.email});const before=Date.now();store.withdraw(rider.id,'탈퇴 회원');
  const u=store.adminUsers().find(x=>x.id===rider.id);assert.equal(u.status,'withdrawn');assert.ok(u.withdrawn>=before);assert.equal(u.email,null);
 }finally{store.close();}
});

test('admin HTTP API: env email admin sees dashboard and suggestions, others are blocked, email never leaks publicly',async()=>{
 const store=createStore(':memory:',{seed:false});
 const bossToken=store.createSession(boss.id,boss.name,{email:ADMIN_MAIL}),riderToken=store.createSession(rider.id,rider.name,{email:rider.email});
 const kakaoToken=store.createSession('kakao:77','K');
 const app=await createApp({store,env:{APP_ORIGIN:'http://localhost:3000',ADMIN_GOOGLE_EMAILS:ADMIN_MAIL}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 const call=(path,token,options={})=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Origin:base,...(token?{Cookie:`jeju_session=${token}`}:{}),...options.headers}});
 try{
  for(const token of [null,riderToken,kakaoToken]){assert.equal((await call('/api/admin/dashboard',token)).status,403);assert.equal((await call('/api/admin/suggestions',token)).status,403);}
  const dash=await call('/api/admin/dashboard',bossToken);assert.equal(dash.status,200);const body=await dash.json();
  assert.equal(body.members.total,3);assert.ok(Array.isArray(body.quotas)&&body.quotas.length>4);assert.ok(body.chat.today);assert.equal(body.actor.owner,true);
  const status=await (await call('/api/status',riderToken)).text();assert.equal(status.includes(ADMIN_MAIL),false);
  const anon=await (await call('/api/status',null)).text();assert.equal(anon.includes(ADMIN_MAIL),false);assert.equal(/adminEmails|ADMIN_GOOGLE/.test(anon),false);
  const sg=await call('/api/admin/suggestions',bossToken);assert.equal(sg.status,200);assert.equal((await sg.json()).total,0);
  assert.equal((await call('/api/admin/suggestions/abc',riderToken,{method:'POST',body:JSON.stringify({status:'done'})})).status,403);
  // 채팅 버스봇: AI가 꺼져 있으면 고정 문구로 답하고 fallback으로 센다.
  const say=await call('/api/room/say',null,{method:'POST',body:JSON.stringify({sid:'aaaaaaaa-1111-1111-1111-111111111111',text:'201번 언제 와요',bot:true,locale:'ko'})});assert.equal(say.status,200);
  const after=await (await call('/api/admin/dashboard',bossToken)).json();assert.equal(after.chat.today.fallback,1);assert.equal(after.chat.today.room,1);
 }finally{await new Promise(r=>app.server.close(r));store.close();}
});

test('community shows the developer board outside the menu with four-language copy',()=>{
 const t=k=>boardStrings[k]?.[0]||k;
 const html=ctabsMarkup('live',t);assert.match(html,/class="ctab-suggest" data-ctab="suggest"/);assert.match(html,/개발자에게 바란다/);
 assert.doesNotMatch(ctabsMarkup('suggest',t),/ctab-suggest/);
 assert.match(suggestIntro(t),/data-suggest-write="pain"/);assert.match(suggestIntro(t),/data-suggest-write="idea"/);
 for(const k of ['ctab_suggest','suggest','suggestPill','suggestIntroTitle','suggestIntroBody','suggestWritePain','suggestWriteIdea','suggestTitlePain','suggestTitleIdea'])assert.equal(boardStrings[k]?.length,4,k);
 for(const k of ['dashboard','suggestions','sg_new','sg_review','sg_done','sg_hold','trendTitle','quotaTitle','chatTitle','needCheck','chatFallback'])for(const l of ['ko','en','zh','ja'])assert.notEqual(adminText(l,k),k,`${k}/${l}`);
});
