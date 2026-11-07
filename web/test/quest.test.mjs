import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookMarkup,PLACES} from '../public/notebook.js';
import {CARDS,applyRide,blankQuest,cardsFor,evaluate,levelOf,rollTicket,todayMissions,weekOf} from '../public/quest.js';
import {createTeams} from '../lib/live-room.mjs';
import {existsSync} from 'node:fs';

const t0=Date.parse('2026-11-10T01:00:00Z'),leg=(x={})=>({id:'1',no:'201',stopName:'시청',at:t0,offAt:t0+600000,...x});
test('오늘의 미션은 날짜마다 같고 세 개다',()=>{assert.deepEqual(todayMissions('2026-11-10').map(m=>m[0]),todayMissions('2026-11-10').map(m=>m[0]));assert.equal(todayMissions('2026-11-10').length,3);assert.equal(new Set(todayMissions('2026-11-10').map(m=>m[0])).size,3);});
test('미션 보상은 한 번만 준다',()=>{const a=evaluate(blankQuest(),[leg()],t0+700000);assert.ok(a.fresh.some(m=>m.id==='ride'));assert.ok(a.quest.coins>=10);const b=evaluate(a.quest,[leg()],t0+800000);assert.equal(b.fresh.length,0);assert.equal(b.quest.coins,a.quest.coins);});
test('정류장을 칠하고 카드와 뽑기권을 준다. 뽑기권은 곧 오던 버스에만',()=>{
 const path=[{id:'a',name:'함덕환승정류장',lat:33.5,lng:126.7},{id:'b',name:'성판악',lat:33.38,lng:126.6}];
 const r=applyRide(blankQuest(),leg({verified:true}),path,t0+600000);assert.equal(r.added,2);assert.ok(r.cards.includes('seongpanak'));assert.equal(r.ticket,true);
 assert.equal(applyRide(r.quest,leg({verified:true}),path,t0+600000).added,0);assert.equal(applyRide(blankQuest(),leg({verified:false}),path,t0+600000).ticket,false);assert.equal(applyRide(blankQuest(),leg({verified:true}),path,t0+30000).ticket,false);
 let q=blankQuest();for(let i=0;i<4;i++)q=applyRide(q,leg({verified:true}),[],t0+600000).quest;assert.equal(q.tickets,3);
});
test('뽑기 확률 구간과 레벨',()=>{assert.equal(rollTicket(()=>.01).rarity,'legend');assert.equal(rollTicket(()=>.2).rarity,'rare');assert.equal(rollTicket(()=>.9).rarity,'common');assert.equal(levelOf(0).level,1);assert.equal(levelOf(160).level,3);assert.equal(levelOf(99999).to,null);});
test('탐험 수첩 세 탭이 그려지고 부르는 그림 파일이 모두 있다',()=>{
 const base={quest:{...blankQuest(),tickets:1,cards:['airport'],stops:{s1:'east'}},legs:[leg()],board:{teams:{}},totals:{east:1,west:1,south:1,north:1},now:t0,rides:[{no:'201',stopId:'s',region:'east',at:t0}],game:true};
 const pages={today:['nbTrips','nbRoute','data-q-spin','data-q-team'],map:['nbMapCap','data-q-place="airport"','explore-east'],book:['nbStamps','nbLog','game-share']};
 for(const [tab,keys] of Object.entries(pages)){const html=notebookMarkup({...base,tab,cert:true},String,k=>k);for(const k of keys)assert.ok(html.includes(k),tab+':'+k);for(const [,src] of html.matchAll(/src="([^"]+)"/g))assert.ok(existsSync(new URL('../public'+src,import.meta.url)),src);}
 for(const c of CARDS){assert.ok(PLACES[c.id],c.id);assert.ok(existsSync(new URL('../public/art/quest/place-'+c.id+'.webp',import.meta.url)),c.id);}
 assert.deepEqual(cardsFor(['제주국제공항3']),['airport']);assert.equal(weekOf(Date.parse('2026-11-08T03:00:00Z')),'2026-11-02');
});
test('팀 점수는 기기당 하루 100점까지',async()=>{
 const m=new Map(),store={recordGet:async(k,id)=>m.get(`${k}/${id}`)??null,recordPut:async(k,id,d)=>m.set(`${k}/${id}`,d)},teams=createTeams(store,{now:()=>t0}),sid='11111111-1111-1111-1111-111111111111';
 await teams.add({sid,team:'sea',points:80});assert.equal((await teams.add({sid,team:'sea',points:80})).teams.sea,100);await assert.rejects(teams.add({sid,team:'x',points:1}),{key:'invalidRequest'});
});
test('행운 번호는 오늘 날짜 끝자리가 번호 어디에 있어도 된다',async()=>{
 const {POOL}=await import('../public/quest.js'),lucky=POOL.find(m=>m[0]==='lucky')[2];
 assert.ok(lucky([{no:'291'}],{},'2026-11-29'));assert.ok(lucky([{no:'960-1'}],{},'2026-11-09'));assert.ok(!lucky([{no:'201'}],{},'2026-11-29'));
});
