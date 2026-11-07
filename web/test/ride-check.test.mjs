import test from 'node:test';
import assert from 'node:assert/strict';
import {addSample,classify,looksOff,ridePoints} from '../public/ride-check.js';

const t0=1e12,step=0.0009; // 약 100m
// 달리기 3구간과 정류장 정차를 만든다
function route(stopEvery,atStop=true){const list=[],stops=[];let t=t0,lat=33.5,n=0;for(let leg=0;leg<4;leg++){for(let i=0;i<12;i++){lat+=step;t+=10000;list.push({t,lat,lng:126.5});n++;}if(stopEvery){const p={lat:lat+(atStop?0.0001:0.002),lng:126.5};stops.push(p);for(let i=0;i<3;i++){t+=10000;list.push({t,lat,lng:126.5});}}}return {list,stops};}
test('낮은 정확도와 너무 잦은 값은 버린다',()=>{let l=addSample([],{t:1,lat:1,lng:1,accuracy:100});assert.equal(l.length,0);l=addSample(l,{t:1000,lat:1,lng:1,accuracy:5});l=addSample(l,{t:2000,lat:1,lng:1,accuracy:5});assert.equal(l.length,1);});
test('정류장마다 서면 버스다',()=>{const {list,stops}=route(true);const r=classify(list,stops);assert.equal(r.kind,'bus');assert.ok(r.stopHits>=2);assert.ok(r.km>3);});
test('차 속도인데 정류장에 서지 않으면 확인 대상이다',()=>{const {list,stops}=route(true,false);assert.equal(classify(list,stops).kind,'vehicle');assert.equal(classify(route(false).list,[]).kind,'vehicle');});
test('걷기와 기록 없음은 구분한다',()=>{const walk=Array.from({length:30},(_,i)=>({t:t0+i*10000,lat:33.5+i*0.00012,lng:126.5}));assert.equal(classify(walk,[]).kind,'walk');assert.equal(classify([],[]).kind,'none');});
test('포인트는 거리와 시간 기준이고 확인분은 절반, 상한이 있다',()=>{const c={kind:'bus',km:10,minutes:30};assert.equal(ridePoints(c,false),80);assert.equal(ridePoints({...c,kind:'vehicle'},true),40);assert.equal(ridePoints({...c,kind:'vehicle'},false),0);assert.equal(ridePoints({...c,kind:'none'},true),0);assert.equal(ridePoints({kind:'bus',km:100,minutes:200}),200);assert.equal(ridePoints(c,false,590),10);});
test('걷는 속도가 이어지고 노선에서 벗어나면 내린 것으로 본다',()=>{const {list}=route(false),base=list.at(-1),walk=Array.from({length:20},(_,i)=>({t:base.t+(i+1)*10000,lat:base.lat,lng:126.5+(i+1)*0.0001}));const all=[...list,...walk];assert.equal(looksOff(all,[]),true);assert.equal(looksOff(list,[]),false);assert.equal(looksOff(all,[{lat:all.at(-1).lat,lng:all.at(-1).lng}]),false);});
