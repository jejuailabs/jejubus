import test from 'node:test';
import assert from 'node:assert/strict';
import {addRecent,dropRecent,frequentRoutes,frequentBuses,pickHero,recentRides,suggestNow,partOf,dayType} from '../public/home-data.js';
import {homeMarkup,homeStopsToLoad} from '../public/home.js';
import {mergeProgress} from '../public/sync.js';

// 2026-11-09(월) 08:00 KST
const MON8=Date.UTC(2026,10,8,23,0);
const H=3600000,D=86400000;
const leg=(at,no,stop,off,extra={})=>({id:`${at}`,no,stopId:stop,stopName:`정류장${stop}`,lat:33.5,lng:126.5,at,offAt:off?at+20*60000:null,offName:off||undefined,...extra});
const t=(k,v)=>v?`${k}${JSON.stringify(v)}`:k,e=String;

test('시간대와 평일·주말을 KST로 나눈다',()=>{
 assert.equal(partOf(MON8),'morning');assert.equal(dayType(MON8),'weekday');
 assert.equal(dayType(MON8-2*D),'weekend');assert.equal(partOf(MON8+11*H),'evening');assert.equal(partOf(MON8+16*H),'night');
});

test('지금 시간대에 2번 이상 탄 버스만 추천하고, 1번이면 추천하지 않는다',()=>{
 const legs=[leg(MON8-7*D+10*60000,'201','a','함덕'),leg(MON8-1*D-20*60000,'201','a','함덕')];
 // 하루 전(일요일)은 주말이라 빠진다 → 평일 한 번뿐
 assert.equal(suggestNow(legs,MON8),null);
 const more=[...legs,leg(MON8-3*D+30*60000,'201','a','함덕')];
 const s=suggestNow(more,MON8);assert.equal(s.no,'201');assert.equal(s.stopId,'a');assert.equal(s.count,2);
 // 4주보다 오래된 기록은 쓰지 않는다
 assert.equal(suggestNow([leg(MON8-35*D,'201','a','x'),leg(MON8-42*D,'201','a','x')],MON8),null);
 // 시간대가 2시간 떨어지면 다른 시간대
 assert.equal(suggestNow([leg(MON8-7*D+2*H,'201','a','x'),leg(MON8-14*D+2*H,'201','a','x')],MON8),null);
});

test('자주 가는 경로는 탄 곳→내린 곳 2번 이상, 자동 마감·같은 곳은 뺀다',()=>{
 const legs=[leg(MON8-7*D,'201','a','함덕'),leg(MON8-6*D,'202','a','함덕'),leg(MON8-5*D,'201','a','함덕'),leg(MON8-4*D,'365','b','시청'),leg(MON8-3*D,'365','b','시청',{auto:true}),leg(MON8-2*D,'1','c','정류장c'),leg(MON8-1*D,'1','c','정류장c')];
 const r=frequentRoutes(legs,MON8);
 assert.equal(r.length,1);assert.equal(r[0].no,'201');assert.equal(r[0].offName,'함덕');assert.equal(r[0].count,3);assert.equal(r[0].day,'weekday');
 assert.deepEqual(frequentBuses(legs,MON8).map(x=>x.no),['201','365','1']);
});

test('최근 탄 버스는 같은 번호·정류장을 한 번만 보여 준다',()=>{
 const legs=[leg(1,'201','a','x'),leg(2,'201','a','y'),leg(3,'365','b','z'),leg(4,'1','c','w')];
 assert.deepEqual(recentRides(legs).map(l=>l.no),['1','365','201']);
});

test('최근 검색은 같은 항목을 맨 앞으로 올리고 20개까지만 둔다',()=>{
 let list=[];for(let i=0;i<25;i++)list=addRecent(list,{kind:'route',id:`r${i}`,name:`${i}`},i);
 assert.equal(list.length,20);assert.equal(list[0].key,'route:r24');
 list=addRecent(list,{kind:'route',id:'r10',name:'10'},99);assert.equal(list[0].key,'route:r10');assert.equal(list.filter(x=>x.key==='route:r10').length,1);
 const p=addRecent([],{kind:'path',from:{name:'시청'},to:{name:'함덕'}});assert.equal(p[0].key,'path:시청>함덕');
 assert.equal(dropRecent(list,'route:r10').some(x=>x.key==='route:r10'),false);
});

test('지금 탈 버스는 기다리는 버스 → 자주 탄 버스 → 집 정류장 순으로 고른다',()=>{
 const legs=[leg(MON8-7*D,'201','a','함덕'),leg(MON8-14*D,'201','a','함덕')];
 assert.equal(pickHero({wait:{no:'9',stopId:'z',stopName:'Z',at:MON8-60000},legs,homeStop:{id:'h',name:'집'},now:MON8}).reason,'wait');
 assert.equal(pickHero({wait:{no:'9',stopId:'z',at:MON8-H},legs,homeStop:{id:'h'},now:MON8}).reason,'usual');
 assert.equal(pickHero({legs:[],homeStop:{id:'h',name:'집'},now:MON8}).reason,'home');
 assert.equal(pickHero({legs:[],now:MON8}),null);
});

test('내 보드 화면: 처음 쓰는 사람은 시작 버튼과 인기 장소, 기록이 있으면 히어로와 경로',()=>{
 const empty=homeMarkup({now:MON8},e,t);
 assert.ok(empty.includes('hb-start'));assert.ok(empty.includes('data-hb-query="airport"'));assert.ok(!empty.includes('hb-hero'));
 assert.ok(homeMarkup({places:[{id:'p',name:'목적지'}],now:MON8},e,t).includes('data-fav-place="p"'));
 assert.ok(homeMarkup({favorites:[{id:'r',number:'201'}],now:MON8},e,t).includes('data-fav-bus="r"'));
 const legs=[leg(MON8-7*D,'201','a','함덕'),leg(MON8-14*D,'201','a','함덕')];
 const html=homeMarkup({legs,boards:{a:{rows:[{no:'201',arrivals:[{minutes:4,remainingStops:2}],direction:{next:'시청'}}]}},recent:addRecent([],{kind:'stop',id:'a',name:'정류장a'}),now:MON8},e,t);
 assert.ok(html.includes('hb-hero'));assert.ok(html.includes('hbWhyUsual'));assert.ok(html.includes('class="hb-min">4'));assert.ok(html.includes('data-hb-rode="201"'));
 assert.ok(html.includes('data-hb-route="0"'));assert.ok(html.includes('data-hb-recent="stop:a"'));assert.ok(html.includes('data-hb-again="0"'));
 // 타는 중이면 탔어요를 숨기고, 도착 정보가 없으면 지어내지 않는다
 assert.ok(!homeMarkup({legs,boards:{a:{rows:[]}},riding:true,now:MON8},e,t).includes('data-hb-rode'));
 assert.ok(homeMarkup({legs,boards:{a:{rows:[]}},now:MON8},e,t).includes('boardNoArrivals'));
 const stop=homeMarkup({stops:[{id:'s',name:'정류장'}],boards:{s:{rows:[{no:'1',arrivals:[]}]}},now:MON8},e,t);assert.ok(stop.includes('boardNoArrivals'));
 assert.deepEqual(homeStopsToLoad({stops:[{id:'s',name:'S'}],legs,now:MON8}).map(s=>s.id),['a','s']);
});

test('최근 검색은 계정과 합치고, 지운 항목은 되살리지 않는다',()=>{
 const a={key:'route:1',kind:'route',id:'1',name:'1',at:10},b={key:'stop:s',kind:'stop',id:'s',name:'S',at:20};
 assert.deepEqual(mergeProgress({recent:[a]},{recent:[b]}).recent.map(r=>r.key),['stop:s','route:1']);
 assert.deepEqual(mergeProgress({recent:[],favGone:{'recent:stop:s':30}},{recent:[a,b]}).recent.map(r=>r.key),['route:1']);
 assert.deepEqual(mergeProgress({favGone:{'recent:*':30}},{recent:[a,b]}).recent,[]);
});
test('실시간 한도를 다 쓴 날은 내 보드 위에 시간표 안내가 한 번 뜬다',()=>{
 assert.ok(homeMarkup({stops:[{id:'a',name:'가'}],boards:{a:{liveOut:'quotaReached',rows:[]}},now:MON8},e,t).includes('board-quota'));
 assert.ok(!homeMarkup({stops:[{id:'a',name:'가'}],boards:{a:{rows:[]}},now:MON8},e,t).includes('board-quota'));
});
