import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimetable,currentTabs,headline,parseTime,tripFlags,tripsOf} from '../lib/timetable.mjs';
import {createNetwork} from '../lib/network.mjs';
import {createBoard} from '../lib/board.mjs';
import {timetableMarkup} from '../public/timetable-view.js';

const at=text=>Date.parse(`2026-11-${text}+09:00`);
const tab=(extra={})=>({id:'1',no:'312',path:'터미널-시청-함덕',effective:'(시행일 : 2024.8.1.)',run:'첫차(터미널 출발) 6:00, 막차 21:00, 배차간격 15~22분, 회사',columns:['터미널','시청','함덕','비 고'],rows:[['06:00','06:20','07:00',''],['X','12:00','12:40','토.공휴일 방학기간 운행 안함'],['21:00<br>(막차)','21:20','22:00','막차 3회 승객없으면 함덕 5구까지 운행']],...extra});
const data={routes:{312:{tabs:[tab()]},350:{tabs:[tab({no:'350',rows:[['08:00','08:20','09:00','토,공휴일 운행안함']]})]},360:{tabs:[tab({no:'360',rows:[['08:00','08:20','09:00','방학기간 운행 안함']]})]}}};
const table=time=>createTimetable(()=>data,{now:()=>at(time)});

test('시각 칸을 읽고 새벽 시각은 다음 날로 본다',()=>{
 assert.equal(parseTime('05:43(성산일출봉 출발)'),343);assert.equal(parseTime('6:32(종료)'),392);assert.equal(parseTime('○'),null);assert.equal(parseTime('00:10'),1450);
});
test('비고에서 요일 조건만 뽑고 장소 이름이나 부분 미운행은 무시한다',()=>{
 assert.equal(tripFlags('토,공휴일 운행안함').saturday,true);assert.equal(tripFlags('토.휴일.방학기간 운행 안함').vacation,true);
 for(const note of ['제주대 이후 승객없을 시 첨단-국제대 미운행','토평공단연장운행','토평마을회관 종료','남주고 경유(평일)']){const f=tripFlags(note);assert.deepEqual([f.saturday,f.sunday,f.holiday,f.vacation],[false,false,false,false],note);}
});
test('회차 행을 읽고 노선번호 칸이 있으면 그 번호를 쓴다',()=>{
 const trips=tripsOf({no:'43',columns:['노선번호','공항','비고'],rows:[['43-1번','05:50',''],['43-2번','06:10','']]});assert.deepEqual(trips.map(t=>t.no),['43-1','43-2']);
});
test('공식 문구에 막차가 없으면 표의 마지막 출발을 쓰고, 번호 칸의 꼬리표를 정리한다',async()=>{
 const d={routes:{810:{tabs:[{no:'810-1',path:'(방향)',effective:'',run:'회사(064)',columns:['','공항','터미널'],rows:[['','08:20','08:30'],['','17:00','17:30']]}]},792:{tabs:[{no:'792',path:'a',effective:'',run:'',columns:['노선번호','하귀'],rows:[['792-1(평일)하귀-수산','08:00']]}]}}};
 const t=createTimetable(()=>d,{now:()=>at('07T10:00:00')});assert.equal((await t.plan('810-1')).last,'17:00');assert.equal((await t.plan('792-1')).today,'off');
});
test('양방향 막차가 다르면 방향을 알 때만 말한다',async()=>{
 const mk=(path,run)=>({no:'111',path,effective:'',run,columns:['가','나'],rows:[['06:00','07:00'],['20:00','21:00']]});
 const d={routes:{111:{tabs:[mk('공항-성산','첫차 6:00, 막차 20:00'),mk('성산-공항','첫차 6:30, 막차 21:30')]}}},t=createTimetable(()=>d,{now:()=>at('10T10:00:00')});
 assert.equal((await t.plan('111')).last,null);assert.equal((await t.plan('111',{towards:'성산항(종점)'})).last,'20:00');assert.equal((await t.plan('111',{towards:'제주국제공항'})).last,'21:30');
});
test('시행일이 미래인 탭은 쓰지 않고 같은 방향은 최신 탭만 쓴다',()=>{
 const old={no:'1',path:'a',effective:'(시행일 : 2024.1.1)'},fresh={...old,effective:'(시행일 : 2026.4.30)'},future={...old,effective:'(시행일 : 2027.1.1)'};
 assert.deepEqual(currentTabs([old,fresh,future],'2026-11-07'),[fresh]);
});
test('공식 문구에서 번호별 첫차·막차·배차를 뽑는다',()=>{
 const h=headline('[43-1번] 첫차(터미널 출발) 5:50, 막차 20:10, 배차간격 60~110분 [43-2번] 첫차(공항 출발) 5:57, 막차 20:50, 배차간격 60~100분','43-2');
 assert.deepEqual(h,{first:'5:57',firstBase:'공항 출발',last:'20:50',lastBase:null,interval:'60~100분'});
 assert.deepEqual(headline('[43-1번] 첫차(터미널 출발) 5:50, 막차 20:10','43-3'),{first:null,firstBase:null,last:null,lastBase:null,interval:null},'다른 번호의 문구를 빌려 쓰지 않는다');
});
test('오늘 계획: 첫차 전, 운행, 끝, 주말 미운행을 표에서 정한다',async()=>{
 assert.equal((await table('10T04:30:00').plan('312')).today,'before');
 const running=await table('10T10:00:00').plan('312',{stopName:'시청'});assert.equal(running.today,'running');assert.equal(running.next,'12:00');assert.equal(running.lastHere,'21:20');assert.equal(running.interval,'15~22분');
 assert.equal((await table('10T23:00:00').plan('312')).today,'ended');
 assert.equal((await table('07T10:00:00').plan('350')).today,'off');assert.equal((await table('08T10:00:00').plan('350')).today,'off');
 assert.ok((await table('10T23:00:00').plan('312')).notes[0].includes('승객없으면'));
});
test('고정 공휴일은 일요일로 본다',async()=>{
 const t=createTimetable(()=>data,{now:()=>Date.parse('2026-12-25T10:00:00+09:00')});assert.equal((await t.plan('350')).today,'off');
});
test('방학 제외 회차만 남으면 단정하지 않는다. 표가 없으면 null이다',async()=>{
 assert.equal((await table('10T08:30:00').plan('350')).today,'running');
 assert.equal((await table('10T10:00:00').plan('360')).today,'unsure');assert.equal((await table('07T10:00:00').plan('360')).today,'unsure');
 assert.equal(await table('10T10:00:00').plan('999'),null);
});
test('시간표가 카드와 귀가선으로 이어진다',async()=>{
 const network=createNetwork(()=>({builtAt:'x',stops:[['a','시청','',33.5,126.5],['b','함덕','',33.5,126.7]],variants:[{id:'v',no:'312',stops:[0,1]}]}));
 const board=createBoard({catalog:{arrivals:async()=>({receivedAt:'t',arrivals:[]})},network,timetable:table('10T23:00:00')});
 const {rows}=await board.stop('a');assert.equal(rows[0].today.state,'ended');assert.equal(rows[0].plan.last,'21:00');
 const line=await board.homeLine('a','함덕');assert.equal(line.options[0].no,'312');assert.equal(line.options[0].last,'21:20');assert.equal(line.options[0].lastHere,true);assert.equal(line.options[0].today,'ended');
 assert.equal((await board.homeLine('a','시청')).verdict,'same');assert.equal(await board.homeLine('a','없는곳'),null);
});
test('앱 안 시간표: 방향별 정류장 시각과 오늘 미운행을 표에서 그대로 낸다',async()=>{
 const d={routes:{111:{tabs:[{no:'111',path:'공항-성산',effective:'',run:'첫차 6:00, 막차 20:00',columns:['','공항','시청','비고'],rows:[['','06:00','06:20',''],['','X','12:00','토요일 운행 안함']]},{no:'111',path:'성산-공항',effective:'',run:'',columns:['','시청','공항'],rows:[['','07:00','07:30']]}]}}};
 const v=await createTimetable(()=>d,{now:()=>at('07T10:00:00')}).view('111',{stopName:'제주시청',towards:'제주국제공항'});
 assert.equal(v.group,1);assert.equal(v.groups[1].stops[v.groups[1].stop].name,'시청');
 const a=await createTimetable(()=>d,{now:()=>at('07T10:00:00')}).view('111',{stopName:'제주시청',towards:'성산항'}),times=a.groups[a.group].stops[a.groups[a.group].stop].times;
 assert.equal(a.group,0);assert.deepEqual(times.map(x=>[x.time,x.off]),[['06:20',false],['12:00',true]]);assert.equal(await createTimetable(()=>d).view('999'),null);
});
test('시간표 화면은 다음 차를 표시하고 값을 이스케이프한다',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=x=>String(x).replace(/</g,'&lt;');
 const html=timetableMarkup({no:'312',kind:'weekday',current:600,sourceUrl:'https://x',group:0,groups:[{path:'a',end:'함덕',first:'6:00',last:null,interval:null,effective:'',stop:0,stops:[{name:'<b>',times:[{time:'06:00',minutes:360,off:false,maybe:false,note:null},{time:'12:00',minutes:720,off:false,maybe:false,note:'<i>막차'},{time:'13:00',minutes:780,off:true,maybe:false,note:null}]}]}]},e,t);
 assert.ok(html.includes('tt-time past'));assert.ok(html.includes('tt-time next'));assert.ok(html.includes('<s>13:00</s>'));assert.ok(html.includes('&lt;b>'));assert.ok(html.includes('&lt;i>막차'));
 assert.ok(timetableMarkup({no:'999',groups:[],sourceUrl:'https://x'},e,t).includes('ttNone'));
});
