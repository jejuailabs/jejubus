import test from 'node:test';
import assert from 'node:assert/strict';
import {fileNetwork,TOUR} from '../lib/network.mjs';
import {boardsToLoad,soonOf,sortSpots,tourMarkup} from '../public/tour.js';
import {boardStrings} from '../public/board-strings.js';

const net=fileNetwork(new URL('../public/data/network.json',import.meta.url));
const CITY={lat:33.4996,lng:126.5312};// 제주시청 부근

test('관광노선: 모든 관광지가 번호표 정류장에 이어지고 4개 언어 이름이 있다',async()=>{
 const all=await net.tour();
 assert.equal(all.length,TOUR.length);
 for(const s of all){assert.ok(['sea','oreum','town'].includes(s.theme));assert.ok(s.stop.id);for(const k of [`hbSpot_${s.id}`,`tourTheme_${s.theme}`])assert.equal(boardStrings[k]?.length,4,k);}
 assert.equal(all.find(s=>s.id==='udo').note,'ferry');
});

test('관광노선: 출발지에서 탈 정류장·번호·내릴 곳을 계산한다',async()=>{
 const spots=await net.tour(CITY),by=Object.fromEntries(spots.map(s=>[s.id,s]));
 const h=by.hamdeok;assert.ok(h.distance>10000);assert.ok(h.trips.length>=1);
 const tr=h.trips[0];assert.ok(tr.board.walk<=800);assert.ok(tr.off.name.length);assert.ok(tr.stops>0);
 // 번호표에서 실제로 그 정류장에 서는지 확인
 const variants=await net.variantStops(tr.no);assert.ok(variants.some(v=>v.stops.some(s=>s.id===tr.board.id)&&v.stops.some(s=>s.id===tr.off.id)));
});

test('관광노선: 금방 타는 순·가까운 순·주제별 정렬과 도착 호출 제한',()=>{
 const trip=(no,id,walk)=>({no,stops:5,board:{id,name:id,walk},off:{id:'o',name:'o',walk:0}});
 const spots=[{id:'a',theme:'town',distance:3000,trips:[trip('1','s1',100)]},{id:'b',theme:'sea',distance:1000,trips:[trip('2','s2',200)]},{id:'c',theme:'oreum',distance:500,trips:[]}];
 const boards={s1:{rows:[{no:'1',arrivals:[{minutes:2}]}]},s2:{rows:[{no:'2',arrivals:[{minutes:9}]}]}};
 assert.deepEqual(sortSpots(spots,{sort:'soon',boards}).map(s=>s.id),['a','b','c']);
 assert.deepEqual(sortSpots(spots,{sort:'near'}).map(s=>s.id),['c','b','a']);
 assert.deepEqual(sortSpots(spots,{sort:'theme'}).map(s=>s.id),['b','c','a']);
 assert.deepEqual(sortSpots(spots,{theme:'sea'}).map(s=>s.id),['b']);
 assert.equal(soonOf(spots[0],boards).minutes,2);assert.equal(soonOf(spots[0],{}),undefined);assert.equal(soonOf(spots[0],{s1:{rows:[]}}),null);
 const many=Array.from({length:10},(_,i)=>({trips:[trip('1',`s${i}`,i*10)]}));assert.equal(boardsToLoad(many).length,6);
 const html=tourMarkup({tour:{spots,boards,sort:'soon',theme:'all',from:{kind:'me'}}},String,k=>k);
 assert.ok(html.includes('data-tour-map="a"'));assert.ok(html.includes('tourNone'));assert.ok(html.includes('<b>2</b>'));
});

test('실시간 목적지 검색: 이름으로 목적지를 찾고 내 주변 직행 번호와 방향 변형을 준다',async()=>{
 const r=await net.toward('함덕',CITY);
 assert.ok(r.to.name.startsWith('함덕환승정류장'));assert.ok(r.trips.length>=1);
 const x=r.trips[0];assert.ok(x.variantId);assert.ok(x.board.walk<=800);
 const v=(await net.variantStops(x.no)).find(v=>v.id===x.variantId);const at=v.stops.findIndex(s=>s.id===x.board.id),off=v.stops.findIndex((s,i)=>i>at&&s.id===x.off.id);assert.ok(at>=0&&off>at,'탈 곳 다음에 내릴 곳');
 assert.ok((await net.toward('공항',CITY)).to.name.startsWith('제주국제공항'));
 const far=await net.toward('협재',CITY);assert.equal(far.trips.length,0);assert.ok(far.routes.length>=1);
 assert.ok((await net.toward('함덕')).routes.includes('101'));
 assert.equal(await net.toward('없는곳ㅋ',CITY),null);assert.equal(await net.toward('함',CITY),null);
});
