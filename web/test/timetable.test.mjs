import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimetable,currentTabs,headline,parseTime,tripFlags,tripsOf} from '../lib/timetable.mjs';
import {createNetwork} from '../lib/network.mjs';
import {createBoard} from '../lib/board.mjs';
import {planTrip,timetableMarkup} from '../public/timetable-view.js';
import {filterNumbers,timetableBoardMarkup,upcomingMarkup} from '../public/timetable-board.js';

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
test('평일·휴일 표가 나뉜 번호는 오늘 요일 표만 쓴다',async()=>{
 const tab=(day,first,extra={})=>({no:'365',path:`(${day})한라대-공항-제주대`,effective:'',run:`첫차 ${first}, 막차 21:00, 배차간격 10~20분`,columns:['','공항','제주대'],rows:[['',first,'08:00']],...extra});
 const d={routes:{365:{tabs:[tab('평일','06:00'),tab('휴일','07:00')]},510:{tabs:[tab('평일','06:00',{no:'510'})]}}},make=time=>createTimetable(()=>d,{now:()=>at(time)});
 assert.equal((await make('10T05:00:00').plan('365')).first,'06:00');assert.equal((await make('08T05:00:00').plan('365')).first,'07:00');assert.equal((await make('07T05:00:00').plan('365')).first,'07:00');
 assert.equal((await make('08T10:00:00').plan('510')).today,'off');
 const v=await make('10T05:00:00').view('365',{stopName:'공항'});assert.equal(v.day,'weekday');assert.deepEqual(v.groups.map(g=>g.day),['weekday','holiday']);assert.equal(v.groups[v.group].day,'weekday');
});
test('시간표 화면은 요일과 방향을 나눠 보여 주고 회차가 적은 정류장을 알려 준다',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=String,g=(day,end)=>({path:`(${day})x-${end}`,end,day,first:null,last:null,interval:null,effective:'',stop:1,stops:[{name:'많음',times:Array.from({length:9},(_,i)=>({time:`0${i}:00`,minutes:360+i,off:false,maybe:false,note:null}))},{name:'적음',times:[{time:'16:42',minutes:1000,off:false,maybe:false,note:null}]}]});
 const html=timetableMarkup({no:'365',kind:'saturday',day:'holiday',current:600,sourceUrl:'https://x',group:2,groups:[g('weekday','제주대'),g('weekday','한라대'),g('holiday','제주대'),g('holiday','한라대')]},e,t);
 assert.equal((html.match(/data-tt-day=/g)||[]).length,2);assert.equal((html.match(/data-tt-group=/g)||[]).length,2);assert.ok(html.includes('ttSaturdayGuess'));assert.ok(html.includes('ttFewTrips'));assert.ok(html.includes('ttTrips'));
});
test('여정 승차권은 원하는 시각까지 닿는 가장 늦은 회차를 표에서 찾는다',()=>{
 const item=(trip,minutes,off=false)=>({trip,minutes,time:`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`,off,maybe:false,note:null});
 const g={stops:[{name:'가',times:[item(0,480),item(1,540),item(2,600,true)]},{name:'나',times:[item(0,510),item(1,570),item(2,630,true)]}]};
 const r=planTrip(g,0,1,'09:40');assert.deepEqual([r.board,r.off,r.ride,r.early],['09:00','09:30',30,10]);
 assert.equal(planTrip(g,0,1,'11:00').board,'09:00');assert.equal(planTrip(g,0,1,'08:00'),null);assert.equal(planTrip(g,1,0,'11:00'),null);assert.equal(planTrip(g,0,1,'09:40',550),null);assert.equal(planTrip(g,0,0,'09:40'),null);
});
test('정류장 노트는 표에 있는 정류장만 잇고 승차권은 시간표 기준임을 밝힌다',()=>{
 const t=(k,o={})=>k+JSON.stringify(o),e=String,item=(trip,time,minutes)=>({trip,time,minutes,off:false,maybe:false,note:null});
 const g={path:'a',end:'다',day:null,first:null,last:null,interval:null,effective:'',stop:0,stops:[{name:'가',times:[item(0,'08:00',480),item(1,'09:00',540)]},{name:'나',times:[item(1,'09:20',560)]},{name:'다',times:[item(0,'08:40',520),item(1,'09:40',580)]}]},view=extra=>({no:'1',kind:'weekday',day:null,current:500,sourceUrl:'https://x',group:0,groups:[g],...extra});
 const note=timetableMarkup(view({mode:'note'}),e,t);assert.ok(note.includes('09:20'));assert.ok(note.includes('ttNoteHelp'));assert.ok(!note.includes('08:40')||note.includes('09:40'));
 const pass=timetableMarkup(view({mode:'trip',trip:{to:2,target:'10:00'}}),e,t);assert.ok(pass.includes('ttTicketBasis'));assert.ok(pass.includes('09:40'));
 assert.ok(timetableMarkup(view({mode:'trip',trip:{to:2,target:'08:30'}}),e,t).includes('ttNoTrip'));
});
test('시간표 메뉴: 번호 찾기와 세 기준 화면',()=>{
 assert.deepEqual(filterNumbers(['101','201','1201','202'],'20'),['201','202','1201']);assert.deepEqual(filterNumbers(['101'],''),[]);
 const t=(k,o={})=>k+JSON.stringify(o),e=x=>String(x).replace(/</g,'&lt;'),base={query:'',numbers:['201'],recent:['201'],favorites:[],stop:null,board:null,mine:[],nearby:[],picking:false,stopQuery:'',to:'',by:'',trip:null,inline:null,live:''};
 assert.ok(timetableBoardMarkup({...base,mode:'route'},e,t).includes('data-tt-no="201"'));
 assert.ok(timetableBoardMarkup({...base,mode:'stop'},e,t).includes('ttStopHelp'));
 const place=timetableBoardMarkup({...base,mode:'place',stop:{id:'a',name:'가'},to:'함덕',trip:{verdict:'here',to:'함덕',options:[{no:'201',sure:true,today:'running',last:'21:00',ticket:{board:'09:00',off:'09:40'}}],across:[],acrossStop:null},by:'10:00'},e,t);
 for(const x of ['ttDirect','ttTicketLine','data-tt-plan="201"','ttJourney'])assert.ok(place.includes(x),x);
 assert.ok(timetableBoardMarkup({...base,mode:'place',stop:{id:'a',name:'가'},trip:{verdict:'none',to:'x',options:[],across:[],acrossStop:null}},e,t).includes('ttNoDirect'));
 const board={rows:[{no:'201',arrivals:[{minutes:4},{minutes:20}]},{no:'310',arrivals:[{minutes:9}]}]},flap=upcomingMarkup(board,e,t);assert.ok(flap.indexOf('201')<flap.indexOf('310'));assert.equal(upcomingMarkup({rows:[]},e,t),'');
});
test('시간표 메뉴 목적지 기준은 시간표에 두 정류장이 다 있을 때만 회차를 말한다',async()=>{
 const net=createNetwork(()=>({builtAt:'x',stops:[['a','시청','',33.5,126.5],['b','함덕','',33.5,126.7],['c','김녕','',33.5,126.75]],variants:[{id:'v',no:'312',stops:[0,1,2]}]}));
 const b=createBoard({catalog:{arrivals:async()=>({receivedAt:'t',arrivals:[]})},network:net,timetable:table('10T05:00:00')});
 const r=await b.trip('a','함덕','22:30');assert.equal(r.options[0].ticket.board,'21:20');assert.equal(r.options[0].ticket.off,'22:00');
 const none=await b.trip('a','김녕','22:30');assert.equal(none.options[0].ticket,null);assert.equal(none.options[0].ticketReason,'ttNoTicket');
 assert.equal(await b.trip('a','없는곳'),null);
});
test('목적지 칩의 이름은 실제 정류장으로 이어진다',async()=>{
 const net=createNetwork(()=>({builtAt:'x',stops:[['a','시청','',33.5,126.5],['b','제주국제공항3','',33.5,126.49]],variants:[{id:'v',no:'312',stops:[0,1]}]}));
 const b=createBoard({catalog:{arrivals:async()=>({receivedAt:'t',arrivals:[]})},network:net,timetable:table('10T05:00:00')});
 assert.equal((await b.trip('a','제주공항')).to,'제주국제공항');
});
test('순환 노선은 타는 정류장 뒤에 나오는 같은 이름을 내릴 곳으로 본다',async()=>{
 const d={routes:{181:{tabs:[{no:'181',path:'공항-시청-서귀포-공항',effective:'',run:'',columns:['','공항','시청','서귀포','공항'],rows:[['','06:00','06:20','07:00','08:00']]}]}}};
 const v=await createTimetable(()=>d,{now:()=>at('10T05:00:00')}).view('181',{stopName:'제주시청',toName:'제주국제공항'}),g=v.groups[v.group];assert.equal(g.stop,1);assert.equal(g.to,3);
});
test('돌아가는 회차는 권하지 않고 막차는 표 값으로 채운다',async()=>{
 const d={routes:{181:{tabs:[{no:'181',path:'시청-서귀포-공항',effective:'',run:'첫차 6:00, 막차 21:00',columns:['','시청','서귀포','공항'],rows:[['','10:00','11:00','12:30']]}]}}};
 const net=createNetwork(()=>({builtAt:'x',stops:[['a','시청','',33.5,126.5],['b','제주국제공항3','',33.5,126.49]],variants:[{id:'v',no:'181',stops:[0,1]},{id:'w',no:'181',stops:[1,0]}]}));
 const b=createBoard({catalog:{arrivals:async()=>({receivedAt:'t',arrivals:[]})},network:net,timetable:createTimetable(()=>d,{now:()=>at('10T05:00:00')})}),r=await b.trip('a','제주공항','13:00');
 assert.equal(r.options[0].ticket,null);assert.equal(r.options[0].ticketReason,'ttDetour');assert.ok(r.options[0].last);
});
