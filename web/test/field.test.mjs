import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createFieldReports,maskText} from '../lib/field-reports.mjs';
import {createRouteAdmin} from '../lib/route-admin.mjs';
import {createLiveRoute} from '../lib/live-route.mjs';

const config={adminSubs:['a'],adminGoogleSubs:['a']};
const admin={id:'google:a',sub:'a',role:'admin'},member={id:'google:b',sub:'b'};
const body={type:'notcame',routeNo:'201',stopId:'S1',stopName:'정류장',requestId:'req-00000001'};
const setup=(at=1e12)=>{const clock={at},store=createStore(':memory:',{seed:false});return {clock,store,reports:createFieldReports(config,store,{now:()=>clock.at})};};

test('제보는 위치·차량 정보를 저장하지 않고 같은 요청을 한 번만 받는다',async()=>{
 const {store,reports}=setup();
 await reports.submit({...body,gps:'33,126',vehicle:'12가3456'});assert.equal((await reports.submit(body)).duplicate,true);
 const [saved]=await store.recordList('field_reports');assert.ok(!('gps'in saved)&&!('vehicle'in saved));assert.equal((await store.recordList('field_reports')).length,1);assert.equal(saved.status,'auto');
});
test('잘못된 제보를 막는다',async()=>{
 const {reports}=setup();
 for(const bad of [{...body,type:'driver'},{...body,routeNo:'<x>'},{...body,stopId:'../a'},{...body,requestId:'a'}])await assert.rejects(reports.submit(bad),{key:'invalidRequest'});
});
test('데이터 제보 글에서 전화번호와 차량번호를 가린다',async()=>{
 assert.equal(maskText('010-1234-5678 기사 12가3456'),'[전화번호] 기사 [차량번호]');
 const {store,reports}=setup();await reports.submit({...body,type:'timetable',text:'문의 01012345678'});assert.ok((await store.recordList('field_reports'))[0].text.includes('[전화번호]'));
});
test('현장 제보는 2건부터, 60분 안에서만, 공개 집계로 보인다',async()=>{
 const {clock,reports}=setup();
 await reports.submit(body);assert.equal((await reports.summary('S1')).reports.length,0);
 await reports.submit({...body,requestId:'req-00000002'});assert.deepEqual((await reports.summary('S1')).reports,[{no:'201',type:'notcame',count:2}]);
 clock.at+=61*60000;assert.equal((await reports.summary('S1')).reports.length,0);
});
test('제보함과 수리 소식은 관리자만 쓴다. 처리한 묶음은 사라진다',async()=>{
 const {reports}=setup();
 await reports.submit({...body,type:'timetable'});await reports.submit({...body,type:'timetable',requestId:'req-00000002'});
 await assert.rejects(reports.adminList(member),{key:'forbidden'});await assert.rejects(reports.saveChange(member,{title:'a',body:'b'}),{key:'forbidden'});
 const {groups}=await reports.adminList(admin);assert.equal(groups[0].ids.length,2);
 await reports.closeGroup(admin,groups[0].ids,'fixed');assert.equal((await reports.adminList(admin)).groups.length,0);
 await reports.saveChange(admin,{title:'201 시간표 수정',body:'공식 표와 대조했어요',routeNo:'201',reportCount:2});
 const {changes}=await reports.changelog();assert.equal(changes[0].reportCount,2);
});
test('오늘 화면은 공개 기간 안의 공지만 번호와 함께 준다',async()=>{
 const store=createStore(':memory:',{seed:false}),now=Date.parse('2026-11-07T12:00:00+09:00'),ra=createRouteAdmin(config,store,{now:()=>now});
 await store.recordPut('notices','n1',{id:'n1',context:'route:v1',routeName:'201',title:'우회',body:'본문',status:'published',startsOn:'2026-11-07',endsOn:'2026-11-08',sourceUrl:'https://x',created:1});
 await store.recordPut('notices','n2',{id:'n2',context:'route:v1',routeName:'201',title:'지남',body:'본문',status:'published',endsOn:'2026-11-01',created:2});
 await store.recordPut('notices','n3',{id:'n3',context:'route:v1',routeName:'201',title:'숨김',body:'본문',status:'hidden',created:3});
 const {notices}=await ra.today(async id=>id==='v1'?'201':null);assert.deepEqual(notices.map(n=>n.id),['n1']);assert.deepEqual(notices[0].numbers,['201']);
 const map=await ra.noticesByNumber(['201','202'],'S',async()=>'201');assert.equal(map.get('201')[0].title,'우회');assert.equal(map.has('202'),false);
});
test('실시간은 방향의 전 변형을 합치고, 다음에는 차량 있던 변형만 묻는다',async()=>{
 const clock={at:1e12},asked=[];
 const data={a:[{id:'x'}],b:[],c:[{id:'y'},{id:'x'}]};
 const live=createLiveRoute({now:()=>clock.at,groupOf:async()=>({key:'k',variantIds:['a','b','c']}),positions:async id=>{asked.push(id);return {vehicles:data[id],receivedAt:'t'};}});
 const first=await live.route('a');assert.deepEqual(first.vehicles.map(v=>v.id).sort(),['x','y']);assert.equal(first.coverage.total,3);assert.equal(asked.length,3);
 asked.length=0;clock.at+=30000;await live.route('b');assert.deepEqual(asked,['a','c']);
 asked.length=0;clock.at+=300000;await live.route('a');assert.equal(asked.length,3);
});
test('일부 변형이 실패해도 나머지를 보여 주고 표시한다. 전부 실패하면 오류다',async()=>{
 const ok=createLiveRoute({groupOf:async()=>({key:'k',variantIds:['a','b']}),positions:async id=>{if(id==='b')throw Object.assign(Error('x'),{key:'providerUnavailable'});return {vehicles:[{id:'x'}],receivedAt:'t'};}});
 const r=await ok.route('a');assert.equal(r.vehicles.length,1);assert.equal(r.coverage.partial,true);
 const bad=createLiveRoute({groupOf:async()=>null,positions:async()=>{throw Object.assign(Error('x'),{key:'quotaReached'});}});
 await assert.rejects(bad.route('a'),{key:'quotaReached'});
});
