import test from 'node:test';
import assert from 'node:assert/strict';
import {baseName,createNetwork,scheduleUrl} from '../lib/network.mjs';
import {createBoard,todayState} from '../lib/board.mjs';
import {ServiceError} from '../lib/catalog.mjs';
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

const tue=Date.parse('2026-11-10T10:00:00+09:00');
test('상태값 7종: 공지가 먼저, 근거가 없으면 단정하지 않는다',()=>{
 const plan=today=>({reviewed:true,today,kind:'saturday',sourceUrl:'https://x',effective:'(시행일 : 2026.1.1)',firstTime:'05:43',next:'12:00',interval:'15~22분',last:'21:35'});
 assert.equal(todayState({notice:{title:'우회'},arrival:{seconds:60},plan:plan('running')}).state,'changed');
 const coming=todayState({arrival:{seconds:61,remainingStops:2}});assert.deepEqual([coming.state,coming.minutes],['coming',2]);
 assert.equal(todayState({vehicleSeen:true}).state,'running');
 assert.equal(todayState({}).state,'unknown');assert.equal(todayState({plan:plan('unsure')}).state,'unknown');
 assert.equal(todayState({plan:plan('off')}).state,'notToday');
 assert.deepEqual((({state,time})=>[state,time])(todayState({plan:plan('running')})),['scheduled','12:00']);
 assert.equal(todayState({plan:plan('before')}).state,'beforeFirst');assert.equal(todayState({plan:plan('ended')}).state,'ended');
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
test('정류장 노선 목록: 모든 번호를 한 줄씩 보여 주고 누르면 오늘 운행과 시간, 이동 버튼이 나온다',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=x=>String(x),base={routeId:'v',directions:[{next:'나',end:'끝',terminus:false,loop:false}],direction:null,notice:null,scheduleUrl:'https://x'};
 const rows=[{...base,no:'201',arrivals:[{minutes:3,remainingStops:1}],plan:{today:'running',first:'06:00',last:'21:00',lastBase:null,interval:'20분',next:null},today:{state:'coming'}},{...base,no:'310',arrivals:[],plan:{today:'off',first:null,last:null,lastBase:null,interval:null,next:null},today:{state:'notToday'}}];
 const closed=boardMarkup({inNetwork:true,rows},e,t);assert.equal((closed.match(/data-row-toggle/g)||[]).length,2);assert.ok(!closed.includes('row-detail'));assert.ok(closed.includes('rowOff'));
 const open=boardMarkup({inNetwork:true,rows},e,t,{open:'201'});assert.equal((open.match(/row-detail/g)||[]).length,1);for(const x of ['detailRuns','factLast','data-timetable="201"','data-arrival-route','data-report-no'])assert.ok(open.includes(x),x);
 assert.ok(boardMarkup({inNetwork:true,rows},e,t,{open:'310'}).includes('detailOff'));
});
test('실시간 한도를 다 쓰면 보드는 시간표 기준으로 남고 다른 오류는 그대로 올린다',async()=>{
 const out=createBoard({catalog:{arrivals:async()=>{throw new ServiceError('quotaReached',429);}},network:network(),now:()=>tue});
 const t=(k,v)=>v?`${k}${JSON.stringify(v)}`:k,e=String;const r=await out.stop('b');assert.equal(r.liveOut,'quotaReached');assert.equal(r.arrivals.length,0);assert.ok(r.rows.some(x=>x.no==='201'));assert.ok(r.rows.every(x=>!x.arrivals.length));
 assert.ok(boardMarkup(r,e,t).includes('board-quota'));assert.ok(!boardMarkup({rows:[],inNetwork:true},e,t).includes('board-quota'));
 await assert.rejects(createBoard({catalog:{arrivals:async()=>{throw new ServiceError('providerUnavailable');}},network:network(),now:()=>tue}).stop('b'),{key:'providerUnavailable'});
});
