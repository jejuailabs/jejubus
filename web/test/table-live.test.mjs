import test from 'node:test';
import assert from 'node:assert/strict';
import {alignStops,matchVariants,placeVehicles} from '../lib/table-live.mjs';
import {mergeProgress} from '../public/sync.js';
import {timetableMarkup} from '../public/timetable-view.js';

const names=['서귀포버스터미널','남원','표선','성산','제주버스터미널'];
const stops=['서귀포버스터미널','서귀포여고','남원읍사무소','신흥교차로','표선리사무소','신천리','성산포항입구','세화리','제주버스터미널(종점)'].map((name,i)=>({name,lat:33.3+i/100,lng:126.5+i/100}));
const forward={id:'F',stops},back={id:'B',stops:[...stops].reverse()};

test('시간표 짧은 이름을 노선 정류장에 순서대로 맞춘다',()=>{
 assert.deepEqual(alignStops(names,stops.map(s=>s.name)),[0,2,4,6,8]);
 assert.deepEqual(alignStops(['없는곳','남원'],stops.map(s=>s.name)),[null,2]);
});
test('반대 방향 변형은 고르지 않는다',()=>{
 assert.deepEqual(matchVariants(names,[forward,back]).map(v=>v.id),['F']);
 assert.deepEqual(matchVariants(['없는곳','모르는곳'],[forward]),[]);
});
test('차량을 표 칸 사이에 놓고 이을 수 없으면 지어내지 않는다',()=>{
 const [route]=matchVariants(names,[forward]);
 const [a,b,c,d]=placeVehicles([{id:'1',routeId:'F',stop:'신흥교차로',order:4},{id:'2',routeId:'F',stop:'서귀포버스터미널',order:1},{id:'3',routeId:'F',stop:'다른곳',lat:37,lng:127},{id:'4',routeId:'F',stop:'다른곳',lat:33.3,lng:126.5}],[route]);
 assert.equal(a.after,1);assert.equal(b.after,0);assert.equal(c.after,null);assert.equal(d.after,0);
 assert.deepEqual(placeVehicles([{id:'9',routeId:'B',stop:'남원읍사무소'}],[route]),[]);
});
test('지운 즐겨찾기는 다른 기기 기록으로 되살아나지 않고, 다시 저장하면 남는다',()=>{
 const gone={'stop:s':100,'place:p':100};
 const m=mergeProgress({favGone:gone,myStops:[],places:[]},{myStops:[{id:'s'}],places:[{id:'p',at:50}]});
 assert.deepEqual(m.myStops,[]);assert.deepEqual(m.places,[]);
 assert.equal(mergeProgress({favGone:gone,places:[{id:'p',at:200}]},{}).places.length,1);
});
test('정류장 노트는 오늘 표에만 실시간 버스를 끼워 넣는다',()=>{
 const t=(k,v)=>v?`${k}:${JSON.stringify(v)}`:k,e=String,row=(name,time,trip=0)=>({name,times:[{trip,time,minutes:600,off:false}]});
 const group={end:'끝',path:'가-끝',stop:0,stops:[row('가','10:00'),row('나','10:10'),row('다','10:20')],day:null};
 const view={no:'201',group:0,groups:[group],mode:'note',current:500,kind:'weekday',sourceUrl:'x',live:{key:'201|0',matched:true,at:'12:00',vehicles:[{id:'v',stop:'중간',after:1}]}};
 const html=timetableMarkup(view,e,t);
 assert.ok(html.indexOf('중간')>html.indexOf('10:10')&&html.indexOf('중간')<html.indexOf('10:20'));
 assert.ok(!timetableMarkup({...view,live:{key:'201|1',matched:true,at:'',vehicles:[{id:'v',stop:'중간',after:1}]}},e,t).includes('tt-live-bus'));
 const other={...view,day:'weekday',groups:[{...group,day:'holiday'}]};
 assert.ok(!timetableMarkup(other,e,t).includes('tt-live-head'));
});
