import test from 'node:test';
import assert from 'node:assert/strict';
import {aliasOf,bandOf,coarse,createKudos,createLiveRoom} from '../lib/live-room.mjs';
import {kudosMarkup,nextFor,roomMarkup,soonest,topQuestion,waitPill} from '../public/community.js';

const memory=()=>{const m=new Map();return {recordGet:async(k,id)=>structuredClone(m.get(`${k}/${id}`))??null,recordPut:async(k,id,d)=>{m.set(`${k}/${id}`,structuredClone(d));},dump:()=>m};};
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',here={lat:33.5,lng:126.5},near={lat:33.51,lng:126.5},far={lat:33.25,lng:126.5};
test('가명은 하루 단위로 바뀌고 위치는 뭉갠다',()=>{
 const day=Date.parse('2026-11-07T03:00:00Z');assert.equal(aliasOf(a,day),aliasOf(a,day+3600000));assert.notEqual(aliasOf(a,day),aliasOf(a,day+86400000*2));
 assert.deepEqual(coarse({lat:33.51234,lng:126.52777}),{lat:33.512,lng:126.528});assert.equal(bandOf(here,near),3);assert.equal(bandOf(here,far),null);
});
test('반경 안 사람과 대화만 보이고 좌표는 내보내지 않는다',async()=>{
 const store=memory();let now=1e12;const room=createLiveRoom(store,{now:()=>now});
 await room.ping({sid:a,...here});await room.ping({sid:b,...far});await room.say({sid:a,text:'201번 왔나요',...here});await room.say({sid:b,text:'서귀포예요',...far});
 const v=await room.view({...near,radius:3});assert.equal(v.total,1);assert.deepEqual(v.messages.map(m=>m.text),['201번 왔나요']);assert.ok(!JSON.stringify(v).includes('33.5,'));assert.equal('lat' in v.messages[0],false);assert.equal('lat' in v.people[0],false);
 assert.equal((await room.view({radius:0})).total,2);
 now+=200000;assert.equal((await room.view({radius:0})).total,0);
});
test('전화번호와 링크, 빈 글은 막고 세 번 신고되면 숨긴다',async()=>{
 const room=createLiveRoom(memory(),{now:()=>1e12});
 await assert.rejects(room.say({sid:a,text:'010-1234-5678'}),{key:'roomBlocked'});await assert.rejects(room.say({sid:a,text:'https://x.com'}),{key:'roomBlocked'});await assert.rejects(room.say({sid:a,text:' '}),{key:'roomTextLength'});await assert.rejects(room.say({sid:'x',text:'안녕'}),{key:'invalidRequest'});
 const {message}=await room.say({sid:a,text:'안녕'});for(const c of ['a','b','c'])await room.report({sid:`${c.repeat(8)}-1111-1111-1111-111111111111`,id:message.id});assert.equal((await room.view({radius:0})).messages.length,0);
});
test('버스봇은 물어봤을 때만 답하고 실패해도 대화가 끊기지 않는다',async()=>{
 let asked=0;const ok=createLiveRoom(memory(),{now:()=>1e12,ask:async()=>{asked++;return '201번은 시청에 섭니다';}});await ok.say({sid:a,text:'그냥 말'});assert.equal(asked,0);
 const r=await ok.say({sid:a,text:'201번 어디 서요',bot:true});assert.equal(r.bot.text,'201번은 시청에 섭니다');assert.equal((await ok.view({radius:0})).messages.at(-1).bot,true);
 const down=createLiveRoom(memory(),{now:()=>1e12,ask:async()=>{throw Error('x');}});assert.match((await down.say({sid:a,text:'질문',bot:true})).bot.text,/답하지 못해요/);
});
test('원탭 평가는 개수만 남긴다',async()=>{
 const k=createKudos(memory());assert.equal((await k.add({routeNo:'201-1',type:'kind'})).counts.kind,1);assert.equal((await k.add({routeNo:'201',type:'kind'})).counts.kind,2);assert.equal((await k.get('201')).counts.kind,2);await assert.rejects(k.add({routeNo:'201',type:'name'}),{key:'invalidRequest'});
});
test('기다리는 버스와 커뮤니티 조각',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=String;
 const pill=waitPill({no:'302',stopName:'시청',minutes:4,remainingStops:2},e,t);for(const x of ['302','arrive{"n":4}','boardStopsAway{"n":2}','시청','data-wait-clear'])assert.ok(pill.includes(x),x);
 assert.ok(waitPill(null,e,t).includes('waitPick'));assert.ok(!waitPill({no:'1',minutes:1,auto:true},e,t).includes('data-wait-clear'));
 const board={rows:[{no:'9',arrivals:[{minutes:9}]},{no:'1',arrivals:[{minutes:2}]}]};assert.equal(soonest(board).no,'1');assert.equal(nextFor(board,'9').minutes,9);assert.equal(nextFor(board,'0'),null);
 assert.ok(roomMarkup({room:{total:1,people:[],messages:[{id:'1',alias:'<b>',text:'hi',at:1e12,bot:false}]},me:'x',radius:3,located:false},x=>String(x).replace(/</g,'&lt;'),t,'ko').includes('roomNeedLocation'));
 assert.ok(kudosMarkup('201',{kind:3},['kind'],e,t).includes('disabled'));
});
test('질문 한 줄은 10분 안의 가장 새로운 질문을 모두에게 보여 준다',async()=>{
 let now=1e12;const room=createLiveRoom(memory(),{now:()=>now});
 assert.equal((await room.top()).question,null);await room.say({sid:a,text:'안녕하세요'});assert.equal((await room.top()).question,null);
 await room.say({sid:a,text:'365 언제 와요?',...far});await room.say({sid:b,text:'저도 기다려요'});assert.equal((await room.top()).question.text,'365 언제 와요?');assert.equal('lat' in (await room.top()).question,false);
 now+=601000;assert.equal((await room.top()).question,null);
 const e=String,t=k=>k,q={id:'1',alias:'나',text:'어디?'};assert.ok(topQuestion(q,'너',null,e,t).includes('어디?'));assert.equal(topQuestion(q,'나',null,e,t),'');assert.equal(topQuestion(q,'너','1',e,t),'');
});
