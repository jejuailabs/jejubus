import test from 'node:test';
import assert from 'node:assert/strict';
import {baseName,createNetwork,scheduleUrl} from '../lib/network.mjs';
import {createBoard,todayState} from '../lib/board.mjs';
import {gradeOf,sideResultMarkup,boardMarkup} from '../public/board.js';

// 도로 하나: 북쪽 줄 A→B→C, 남쪽 줄 C'→B'→A'. 순환 노선 9는 B를 두 번 지난다.
const data={builtAt:'2026-11-07T00:00:00Z',stops:[
 ['a','가시장(북)','',33.5,126.5],['b','나초교(동쪽방면)','',33.5,126.51],['c','다항구[동]','',33.5,126.52],
 ['c2','다항구[서]','',33.5001,126.52],['b2','나초교(서쪽방면)','',33.5001,126.51],['a2','가시장(남)','',33.5001,126.5],
 ['l1','라마을','',33.51,126.5],['far','나초교(먼곳)','',33.4,126.3]
],variants:[
 {id:'v1',no:'201',stops:[0,1,2]},{id:'v2',no:'201',stops:[0,1,2]},{id:'v3',no:'201',stops:[3,4,5]},
 {id:'v4',no:'310',stops:[3,4,5]},
 {id:'v9',no:'9',stops:[6,1,2,1,6]},{id:'empty',no:'0',stops:[]}
]};
const network=()=>createNetwork(()=>data);

test('표기 차이는 같은 장소로 묶고 BIS 시간표 주소는 기본 번호를 쓴다',()=>{
 assert.equal(baseName('성산일출봉입구[서]'),'성산일출봉입구');assert.equal(baseName('제주시청(아라방면)'),'제주시청');assert.equal(baseName('제주국제공항3'),'제주국제공항');
 assert.equal(baseName('아라2'),'아라2');assert.ok(scheduleUrl('202-1').endsWith('/202'));
});
test('번호는 방향별 변형 묶음으로 합쳐진다',async()=>{
 const g=await network().groups('201');assert.equal(g.variantCount,3);assert.equal(g.groups.length,2);assert.deepEqual(g.groups[0].variantIds,['v1','v2']);
 assert.equal(await network().groups('없는번호'),null);
});
test('이쪽 판정: 맞는 쪽, 건너편, 순환은 단정 안 함, 없음',async()=>{
 const n=network();
 assert.deepEqual((await n.sideCheck('a','다항구')).here,['201']);
 assert.equal((await n.sideCheck('b','다항구')).verdict,'here');
 const across=await n.sideCheck('b2','다항구');assert.equal(across.verdict,'across');assert.deepEqual(across.across,['201']);assert.equal(across.acrossStop.id,'b');
 const away=await n.sideCheck('b','가시장');assert.equal(away.verdict,'across');assert.deepEqual(away.across,['201','310']);
 assert.equal((await n.sideCheck('l1','다항구')).verdict,'unsure');
 assert.equal((await n.sideCheck('a','라마을')).verdict,'none');
 assert.equal((await n.sideCheck('c','다항구')).verdict,'same');
 assert.equal(await n.sideCheck('a','없는정류장'),null);
});
test('양쪽에서 다 닿는 번호는 어느 쪽이라고 말하지 않는다',async()=>{
 const n=createNetwork(()=>({...data,variants:[{id:'x',no:'5',stops:[0,1,2]},{id:'y',no:'5',stops:[4,2]}]}));
 const r=await n.sideCheck('b','다항구');assert.equal(r.verdict,'unsure');assert.deepEqual(r.unsure,['5']);
});
test('멀리 있는 같은 이름은 건너편으로 치지 않는다',async()=>{
 const {partners}=await network().stopDirections('b');assert.deepEqual(partners.map(p=>p.id),['b2']);
});
test('다음 정류장과 종점: 종점과 두 번 지나는 곳을 표시한다',async()=>{
 const n=network(),{directions}=await n.stopDirections('c');assert.ok(directions.find(d=>d.no==='201').terminus);
 const at=(await n.stopDirections('b')).directions.find(d=>d.no==='9');assert.equal(at.loop,true);
 assert.equal((await n.directionFor('b','v1')).next,'다항구[동]');
});

const sat=Date.parse('2026-11-07T10:00:00+09:00'),tue=Date.parse('2026-11-10T10:00:00+09:00');
const table={reviewed:true,sourceUrl:'https://bus.jeju.go.kr/x',effectiveDate:'2026-01-01',days:{weekday:['06:00','09:00','12:00','21:00'],saturday:[],sunday:[]}};
test('상태값 7종: 공지가 먼저, 근거가 없으면 단정하지 않는다',()=>{
 assert.equal(todayState({notice:{title:'우회'},arrival:{seconds:60},timetable:table,now:tue}).state,'changed');
 const coming=todayState({arrival:{seconds:61,remainingStops:2},now:tue});assert.deepEqual([coming.state,coming.minutes],['coming',2]);
 assert.equal(todayState({vehicleSeen:true,now:sat}).state,'running');
 assert.equal(todayState({now:tue}).state,'unknown');
 assert.equal(todayState({timetable:{...table,reviewed:false},now:tue}).state,'unknown');
 assert.equal(todayState({timetable:table,now:sat}).state,'notToday');
 const s=todayState({timetable:table,now:tue});assert.deepEqual([s.state,s.time],['scheduled','12:00']);
 assert.equal(todayState({timetable:table,now:Date.parse('2026-11-10T05:00:00+09:00')}).state,'beforeFirst');
 assert.equal(todayState({timetable:table,now:Date.parse('2026-11-10T22:00:00+09:00')}).state,'ended');
 assert.equal(todayState({timetable:{...table,holidays:['2026-11-10']},now:tue}).state,'unknown');
 assert.equal(todayState({timetable:{...table,effectiveTo:'2026-11-01'},now:tue}).state,'unknown');
 assert.equal(todayState({timetable:{...table,days:{weekday:table.days.weekday}},now:sat}).state,'unknown');
});
test('정류장 보드는 도착을 번호로 묶고 공지를 번호 전체에 붙인다',async()=>{
 const catalog={arrivals:async()=>({receivedAt:'t',arrivals:[{routeId:'v2',number:'201',seconds:300,remainingStops:3},{routeId:'v1',number:'201',seconds:90,remainingStops:1}]})};
 const board=createBoard({catalog,network:network(),now:()=>tue,noticesFor:async numbers=>{assert.ok(numbers.includes('201'));return new Map([['9',[{title:'우회 안내'}]]]);}});
 const r=await board.stop('b');assert.equal(r.rows[0].no,'201');assert.deepEqual(r.rows[0].arrivals.map(a=>a.minutes),[2,5]);assert.equal(r.rows[0].direction.next,'다항구[동]');assert.equal(r.rows[0].today.state,'coming');
 const nine=r.rows.find(x=>x.no==='9');assert.equal(nine.today.state,'changed');assert.equal(nine.routeId,'v9');
 await assert.rejects(board.stop('../x'),{key:'invalidRequest'});
});
test('번호표에 없는 정류장도 도착은 보여 준다',async()=>{
 const catalog={arrivals:async()=>({receivedAt:'t',arrivals:[{routeId:'q',number:'777',stop:'어딘가',seconds:60,remainingStops:null}]})};
 const r=await createBoard({catalog,network:network(),now:()=>tue}).stop('zz');assert.equal(r.inNetwork,false);assert.equal(r.rows[0].no,'777');assert.equal(r.rows[0].direction,null);
});
test('등급은 BIS 앞자리 분류를 따른다',()=>{
 assert.deepEqual(['101','201','325','510','415','625','711','810','820-1','800','600','M'].map(gradeOf),['express','trunk','trunk','trunk','branch','branch','branch','tour','tour','other','branch','other']);
});
test('화면은 값을 이스케이프하고 없는 값을 지어내지 않는다',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=x=>String(x).replace(/</g,'&lt;');
 const html=boardMarkup({inNetwork:true,rows:[{no:'201',routeId:'v',arrivals:[],directions:[{next:'<b>',end:'끝',terminus:false,loop:false}],direction:null,notice:null,scheduleUrl:'https://x',today:{state:'unknown'}}]},e,t);
 assert.ok(!html.includes('<b>"'));assert.ok(html.includes('boardUnknown'));assert.ok(!html.includes('tado-min'));
 assert.ok(sideResultMarkup({verdict:'across',to:'x',here:[],across:['201'],unsure:[],acrossStop:{id:'b',name:'나'}},e,t).includes('side-across'));
 assert.ok(sideResultMarkup({error:true},e,t).includes('sideNoPlace'));
});
