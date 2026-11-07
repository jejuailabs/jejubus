import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNetwork} from '../lib/network.mjs';
import {catchable,createTripTools,heading,rankByBoarding} from '../lib/chat-trip.mjs';
import {createBusChat,validateChatPayload} from '../lib/bus-chat.mjs';
import {tripCard} from '../public/bus-chat.js';

const network=createNetwork(async()=>JSON.parse(await readFile(new URL('../public/data/network.json',import.meta.url))));
const city={lat:33.49956,lng:126.529771},airport={lat:33.5067,lng:126.4932};
const tools=(arrivals={})=>createTripTools({network,catalog:{journeys:async()=>{throw new Error('off');}},board:{stop:async id=>({rows:(arrivals[id]||[])})}});

test('직행은 다음 정류장이 목적지 쪽인 승차 정류장만 고른다',async()=>{
 const list=await network.directTrips(city,airport);assert.ok(list.length);
 for(const o of list){assert.ok(o.stops>0);const after=await network.stopsAfter(o.board.id,o.no);assert.ok(after.some(s=>s.id===o.off.id),`${o.no}`);}
});
test('승차 안내는 표지판 대조값과 건너편 여부를 낸다',async()=>{
 const plan=await tools().plan(city,airport,{me:city}),first=plan.options[0];
 assert.ok(first.board.next);assert.ok(first.board.walkMeters<=800);assert.ok(['n','ne','e','se','s','sw','w','nw'].includes(first.board.heading));assert.equal(first.arrival.live,true);
 const stops=(await network.namedStops('제주시청',8)).filter(s=>s.next);assert.ok(stops.length>=2);
 assert.equal(heading({lat:33,lng:126},{lat:34,lng:126}),'n');
});
test('내릴 곳은 지금 위치 뒤쪽 정류장에서 고른다',async()=>{
 const [o]=await network.directTrips(city,airport),hit=await network.alightOn(o.no,airport,city);
 assert.ok(hit.stopsLeft>0);assert.ok(hit.before);assert.ok(hit.walk<=800);
});
test('위치가 없으면 지어내지 않고 위치를 요청하며 좌표는 모델로 보내지 않는다',async()=>{
 const bodies=[],reply=o=>({ok:true,json:async()=>o}),config={aiKey:'k',aiEnabled:true,aiModel:'gpt-5.4-mini'};
 const chat=createBusChat(config,{catalog:{},consume:async()=>{},data:{network,board:{stop:async()=>({rows:[]})}},fetchImpl:async(u,o)=>{const b=JSON.parse(o.body);bodies.push(b);return reply(b.tools&&b.tool_choice==='required'?{output:[{type:'function_call',name:'nearby_stops',call_id:'c',arguments:'{"number":null}'}]}:{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'위치를 보내 주세요',sourceIds:['S1']})}]}]});}});
 const asked=await chat.answer({locale:'ko',messages:[{role:'user',content:'여기 뭐 와?'}]});assert.equal(asked.needsLocation,true);
 const shared=await chat.answer({locale:'ko',messages:[{role:'user',content:'여기 뭐 와?'}],context:{me:city}});assert.equal(shared.needsLocation,false);assert.ok(shared.actions.some(a=>a.kind==='stop'));
 assert.ok(!JSON.stringify(bodies[2].input[1]).includes('126.529'));
 assert.equal(validateChatPayload({locale:'ko',messages:[{role:'user',content:'a'}],context:{me:{lat:37,lng:127}}}).context.me,undefined);
});
test('걸어가는 동안 지나갈 버스는 빼고 빨리 탈 수 있는 순서로 고른다',()=>{
 assert.deepEqual(catchable({minutes:[1,14],remainingStops:1},252).minutes,[14]);assert.equal(catchable({minutes:[1,14],remainingStops:1},252).remainingStops,null);
 assert.deepEqual(catchable({minutes:[1],remainingStops:1},700).minutes,[1]);
 assert.deepEqual(rankByBoarding([{no:'a',arrival:{minutes:[]},stops:2},{no:'b',arrival:{minutes:[63]},stops:2},{no:'c',arrival:{minutes:[9]},stops:7}]).map(o=>o.no),['c','b','a']);
});
test('승차 카드는 서버 값으로 그린다',()=>{
 const t=(k,v)=>v?`${k}:${JSON.stringify(v)}`:k,html=tripCard({options:[{no:'201',arrival:{live:true,minutes:[4],remainingStops:2},board:{name:'가',walkMeters:90,heading:'n',next:'나',towards:'끝',opposite:{name:'가',next:'다',nearer:true}},off:{name:'라',walkToDestination:30},stops:5,then:[]}]},t);
 for(const word of ['chatSign','chatCross','chatStops','가','라'])assert.ok(html.includes(word),word);
 assert.equal(tripCard({options:[]},t),'');
});
