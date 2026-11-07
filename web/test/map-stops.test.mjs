import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork,stopKind} from '../lib/network.mjs';

const stops=[['a','허브','',33.5001,126.5001],['b','옆정류장','',33.5002,126.5002],['c','먼곳','',33.45,126.6],['d','바깥','',33.2,126.2]];
const net=()=>createNetwork(()=>({builtAt:'x',stops,variants:[{id:'1',no:'201',stops:[0,2]},{id:'2',no:'202',stops:[0]},{id:'3',no:'203',stops:[1]}]}));
const box={south:33.4,west:126.4,north:33.6,east:126.7};
test('가까이 보면 화면 안 정류장을 모두 준다',async()=>{
 const r=await net().stopsIn(box,16);assert.deepEqual(r.stops.map(s=>s.id).sort(),['a','b','c']);assert.equal(r.thinned,false);
});
test('멀리 보면 칸마다 노선이 많은 정류장만 남긴다',async()=>{
 const r=await net().stopsIn(box,11);assert.deepEqual(r.stops.map(s=>s.id).sort(),['a','c']);assert.equal(r.thinned,true);assert.equal(r.total,3);
});
test('가까운 정류장은 거리순이다',async()=>{
 const r=await net().nearest({lat:33.4501,lng:126.6001},2);assert.equal(r[0].id,'c');assert.ok(r[0].distanceMeters<50);assert.equal(r.length,2);
});
