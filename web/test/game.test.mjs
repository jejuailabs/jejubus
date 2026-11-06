import test from 'node:test';
import assert from 'node:assert/strict';
import {addRide,gameMarkup,newStamps,regionOf,stampsOf,titleOf} from '../public/game.js';
import {boardMarkup,routeBoardMarkup,sideBest} from '../public/board.js';
import {homeMarkup} from '../public/home.js';
import {createAdminService} from '../lib/admin.mjs';

const at=(d,h)=>Date.parse(`2026-11-${d}T${String(h).padStart(2,'0')}:30:00+09:00`);
const ride=(no,stopId,lat,lng,time)=>({no,stopId,lat,lng,at:time});
const earned=rides=>stampsOf(rides).filter(s=>s.earned).map(s=>s.id);

test('권역은 정류장 좌표로 나누고 좌표가 없으면 비운다',()=>{
 assert.equal(regionOf(33.46,126.93),'east');assert.equal(regionOf(33.25,126.25),'west');assert.equal(regionOf(33.5,126.53),'north');assert.equal(regionOf(33.25,126.56),'south');assert.equal(regionOf(null,undefined),null);
});
test('같은 날 같은 정류장의 같은 번호는 한 번만 기록한다',()=>{
 const first=addRide([],ride('201','s',33.5,126.5,at('07',10)));assert.equal(first.added,true);
 assert.equal(addRide(first.rides,ride('201','s',33.5,126.5,at('07',18))).added,false);
 assert.equal(addRide(first.rides,ride('201','s',33.5,126.5,at('08',10))).added,true);
 assert.ok(!('lat'in first.rides[0]));
});
test('도장은 기록에서만 계산한다',()=>{
 assert.deepEqual(earned([]),[]);
 let rides=[];const add=r=>{rides=addRide(rides,r).rides;};
 add(ride('201','a',33.5,126.53,at('07',6)));assert.deepEqual(earned(rides),['first-ride','first-bus','north']);
 const before=rides;add(ride('111','b',33.46,126.93,at('07',17)));assert.deepEqual(newStamps(before,rides),['sunset','east']);
 add(ride('202','c',33.25,126.25,at('07',22)));add(ride('300','d',33.25,126.56,at('07',12)));add(ride('301','e',33.5,126.53,at('07',13)));
 assert.deepEqual(earned(rides),['first-ride','new-route','new-stop','first-bus','sunset','last-bus','east','west','south','north','four-way']);
});
test('성격 칭호는 5번 타기 전에는 없다',()=>{
 const rides=['a','b','c','d'].map(s=>({no:'1',stopId:s,region:'east',at:at('07',10)}));assert.equal(titleOf(rides),null);
 assert.equal(titleOf([...rides,{no:'1',stopId:'e',region:'east',at:at('07',10)}]),'typeEast');
});
test('공지가 있는 줄에는 게임 버튼을 넣지 않는다',()=>{
 const t=k=>k,e=String,row=notice=>({no:'201',routeId:'v',arrivals:[{minutes:3,remainingStops:1}],directions:[],direction:null,notice,scheduleUrl:'https://x',today:{state:'coming'}});
 assert.ok(boardMarkup({inNetwork:true,rows:[row(null)]},e,t,{game:true}).includes('data-rode'));
 assert.ok(!boardMarkup({inNetwork:true,rows:[row({title:'우회'})]},e,t,{game:true}).includes('data-rode'));
 assert.ok(!boardMarkup({inNetwork:true,rows:[row(null)]},e,t,{game:false}).includes('data-rode'));
});
test('내 제주 화면은 기록이 없어도 그려지고 삭제 버튼은 기록이 있을 때만 있다',()=>{
 const t=k=>k,e=String;assert.ok(!gameMarkup([],e,t).includes('game-clear'));assert.ok(gameMarkup([{no:'1',stopId:'a',region:'east',at:at('07',10)}],e,t).includes('game-clear'));
});
test('노선 보드는 차량을 정류장 칸에 놓고, 오래되면 표정을 바꾸고, 목록 밖 차량은 숫자로 알린다',()=>{
 const t=(k,o)=>o?`${k}:${o.n}`:k,e=String,stops=[{id:'a',name:'가'},{id:'b',name:'나'}],bus=[{stop:'나'},{stop:'다른곳'}];
 const html=routeBoardMarkup(stops,bus,'201',10,'a',e,t);assert.equal((html.match(/bus-token /g)||[]).length,1);assert.ok(html.includes('state-ok'));assert.ok(html.includes('rb-stop mine'));assert.ok(html.includes('rbOther:1'));
 assert.ok(routeBoardMarkup(stops,bus,'201',120,null,e,t).includes('state-stale'));assert.ok(routeBoardMarkup(stops,bus,'201',400,null,e,t).includes('state-lost'));
});
test('플랜 B는 목적지로 가는 번호 중 먼저 오는 순서로 고른다',()=>{
 const board={rows:[{no:'111',arrivals:[{minutes:9},{minutes:30}]},{no:'212',arrivals:[{minutes:4}]},{no:'999',arrivals:[{minutes:1}]}]};
 assert.deepEqual(sideBest({here:['111','212']},board),[{no:'212',minutes:4},{no:'111',minutes:9}]);assert.deepEqual(sideBest({here:[]},board),[]);assert.deepEqual(sideBest({here:['111']},null),[]);
});
test('내 보드는 빈 상태와 첫 안내를 그리고 도착 없는 정류장을 지어내지 않는다',()=>{
 const t=k=>k,e=String,base={stops:[],boards:{},favorites:[],alerts:0,guide:true};
 assert.ok(homeMarkup(base,e,t).includes('homeEmpty'));assert.ok(homeMarkup(base,e,t).includes('guide-done'));assert.ok(!homeMarkup({...base,guide:false},e,t).includes('guide-done'));
 const html=homeMarkup({...base,stops:[{id:'s',name:'정류장'}],boards:{s:{rows:[{no:'1',arrivals:[]}]}}},e,t);assert.ok(html.includes('boardNoArrivals'));assert.ok(!html.includes('homeEmpty'));
});
test('Firestore 사용량은 묶어서 쓰고 상한 근처에서는 한 건씩 쓴다',async()=>{
 const calls=[];let count=0;const limit=12,store={leasedQuota:true,control:async()=>({}),consumeApi:async(p,l,period,amount=1)=>{if(count+amount>l)throw Object.assign(Error(),{key:'quotaReached'});count+=amount;calls.push(amount);}};
 const admin=createAdminService({},store);for(let i=0;i<12;i++)await admin.consume('tago',limit);
 assert.deepEqual(calls,[10,1,1]);await assert.rejects(admin.consume('tago',limit),{key:'quotaReached'});
});
