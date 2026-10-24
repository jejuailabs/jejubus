import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaceLookup} from '../public/place-autocomplete.js';

test('place suggestions skip short input and share cached/inflight results between endpoints',async()=>{
  let calls=0,complete;
  const places=[{id:'market',name:'동문시장',address:'제주시',lat:33.51,lng:126.52}];
  const lookup=createPlaceLookup(()=>{calls++;return new Promise(resolve=>{complete=resolve;});});
  assert.deepEqual(await lookup('동'),[]);assert.equal(calls,0);
  const a=lookup(' 동문 '),b=lookup('동문');await Promise.resolve();assert.equal(calls,1);
  complete(places);assert.deepEqual(await a,places);assert.deepEqual(await b,places);
  assert.deepEqual(await lookup('동문'),places);assert.equal(calls,1);
});

test('expired suggestions refresh and failed requests do not poison the cache',async()=>{
  let now=0,calls=0;
  const lookup=createPlaceLookup(async()=>{if(++calls===1)throw Object.assign(Error('limit'),{key:'quotaReached'});return [{name:`Result ${calls}`}];},{now:()=>now,ttl:100});
  await assert.rejects(lookup('airport'),e=>e.key==='quotaReached');
  assert.equal((await lookup('airport'))[0].name,'Result 2');
  assert.equal((await lookup('AIRPORT'))[0].name,'Result 2');
  now=101;assert.equal((await lookup('airport'))[0].name,'Result 3');
});
