import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProgress} from '../public/sync.js';
test('기기 기록과 계정 기록을 합치고 아무것도 버리지 않는다',()=>{
 const local={quest:{coins:5,xp:50,tickets:1,done:{a:true},stops:{s1:'east'},cards:['airport'],owned:[],ticketDay:{d:1},actions:{}},trips:[{id:'1',no:'201',at:1,offAt:null},{id:'3',no:'9',at:3,offAt:4}],myStops:[{id:'x'}],ttRecent:['201']};
 const remote={quest:{coins:9,xp:20,tickets:0,done:{b:true},stops:{s2:'west'},cards:['terminal'],owned:['sea'],team:'sea',ticketDay:{d:2},actions:{}},trips:[{id:'1',no:'201',at:1,offAt:2,offName:'끝'},{id:'2',no:'3',at:2,offAt:3}],myStops:[{id:'y'}],ttRecent:['365']};
 const m=mergeProgress(local,remote);
 assert.deepEqual(m.trips.map(l=>l.id),['1','2','3']);assert.equal(m.trips[0].offAt,2);assert.equal(m.quest.coins,9);assert.equal(m.quest.xp,50);assert.deepEqual(Object.keys(m.quest.stops).sort(),['s1','s2']);assert.deepEqual(m.quest.cards.sort(),['airport','terminal']);assert.equal(m.quest.team,'sea');assert.equal(m.quest.ticketDay.d,2);assert.equal(m.myStops.length,2);assert.deepEqual(m.ttRecent,['201','365']);
 assert.deepEqual(mergeProgress({},{}).trips,[]);assert.equal(mergeProgress({quest:{coins:1}},{}).quest.coins,1);
});
