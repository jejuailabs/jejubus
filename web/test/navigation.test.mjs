import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRoute,pointAt,project,createTracker} from '../public/navigation-core.js';
import {createNavigation,normalizeDriving} from '../lib/navigation.mjs';
import {configuration} from '../lib/settings.mjs';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../server.mjs';
const a={lat:33.5,lng:126.5},b={lat:33.5,lng:126.51},c={lat:33.51,lng:126.51};
const fixture={routes:[{result_code:0,summary:{distance:2000,duration:300},sections:[{distance:2000,duration:300,roads:[{vertexes:[a.lng,a.lat,b.lng,b.lat]},{vertexes:[b.lng,b.lat,c.lng,c.lat]}],guides:[{x:b.lng,y:b.lat,road_index:1,guidance:'좌회전',type:1}]}]}]};
function route(){const r=prepareRoute({points:[a,b,c],duration:300,guides:[]});r.guides=[{along:r.cumulative[1],text:'Turn left'},{along:r.length,text:'Arrive',type:101}];return r;}
test('route normalization preserves provider road shape, maneuvers and units',()=>{
 const r=normalizeDriving(fixture);assert.equal(r.duration,300);assert.equal(r.meters,2000);assert.deepEqual(r.points,[a,b,c]);assert.ok(Math.abs(r.guides[0].along-r.cumulative[1])<1);assert.equal(r.guides.at(-1).along,r.length);
 assert.throws(()=>normalizeDriving({routes:[{result_code:104}]}),{key:'navigationNoRoute'});assert.throws(()=>normalizeDriving({routes:[{result_code:0,summary:{duration:1,distance:1},sections:[]}]}),{key:'providerUnavailable'});
});
test('projection and point interpolation track progress through a right-angle bend',()=>{const r=route(),point=pointAt(r,1200),snap=project(point,r);assert.ok(Math.abs(snap.along-1200)<1);assert.ok(snap.error<1);assert.deepEqual(pointAt(r,r.length+1),c);});
test('weak/stale GPS and implausible jumps cannot advance navigation or trigger arrival',()=>{
 const r=route(),tracker=createTracker(r),now=Date.now(),fix={...a,accuracy:8,timestamp:now,speed:8};
 assert.equal(tracker.update({...fix,accuracy:100},now).quality,'weak');assert.equal(tracker.update({...fix,timestamp:now-16000},now).quality,'weak');
 assert.equal(tracker.update(fix,now).quality,'good');assert.equal(tracker.update(fix,now).quality,'stale');assert.equal(tracker.update({...fix,...c,timestamp:now+1000},now+1000).quality,'jump');
});
test('three accurate offroute fixes are required; one bad fix cannot trigger rerouting',()=>{
 const tracker=createTracker(route()),now=Date.now(),fix={lat:33.499,lng:126.501,accuracy:6,speed:8};
 assert.equal(tracker.update({...fix,timestamp:now},now).reroute,false);assert.equal(tracker.update({...fix,timestamp:now+1000},now+1000).reroute,false);assert.equal(tracker.update({...fix,timestamp:now+2000},now+2000).reroute,true);
});
test('arrival requires near-end progress, physical proximity, two fixes and low speed',()=>{
 const r=route(),tracker=createTracker(r),now=Date.now();let result;
 for(let d=0,i=0;d<r.length;d+=50,i++)result=tracker.update({...pointAt(r,d),accuracy:5,speed:8,timestamp:now+i*5000},now+i*5000);
 const at=now+300000;assert.equal(tracker.update({...c,accuracy:5,speed:8,timestamp:at},at).arrived,false);assert.equal(tracker.update({...c,accuracy:5,speed:0,timestamp:at+1000},at+1000).arrived,false);assert.equal(tracker.update({...c,accuracy:5,speed:0,timestamp:at+2000},at+2000).arrived,true);
});
test('route snapping does not jump ahead at a loop crossing',()=>{
 const r=prepareRoute({points:[a,b,c,{lat:33.51,lng:126.5},a,b],duration:400,guides:[]}),tracker=createTracker(r),now=Date.now();tracker.update({...a,accuracy:5,timestamp:now},now);const result=tracker.update({...pointAt(r,40),accuracy:5,timestamp:now+1000},now+1000);assert.ok(result.progress<50);
});
test('driving stays closed by default and quota reservation precedes any provider call',async()=>{
 let called=0;const config={kakaoKey:'TEST',kakaoEnabled:true,navigationEnabled:false,navigationDailyLimit:50},fetchImpl=async()=>{called++;return {ok:true,json:async()=>fixture};};
 const nav=createNavigation(config,{fetchImpl,consume:async()=>{throw Object.assign(Error(),{key:'quotaReached'});}});
 await assert.rejects(nav.route({from:a,to:c}),{key:'navigationNotEnabled'});assert.equal(called,0);config.navigationEnabled=true;await assert.rejects(nav.route({from:a,to:c}),{key:'quotaReached'});assert.equal(called,0);
 const parsed=configuration({NAVIGATION_ENABLED:'true'});assert.equal(parsed.navigationEnabled,false);assert.equal(configuration({NAVIGATION_ENABLED:'true',NAVIGATION_FREE_QUOTA_VERIFIED:'true',NAVIGATION_DAILY_LIMIT:'100000'}).navigationDailyLimit,50);
});
test('request validates Jeju coordinates, rejects extra waypoints and never exposes a key',async()=>{
 const urls=[],nav=createNavigation({kakaoKey:'private-test-key',kakaoEnabled:true,navigationEnabled:true,navigationDailyLimit:50},{fetchImpl:async url=>{urls.push(String(url));return {ok:true,json:async()=>fixture};}});
 await assert.rejects(nav.route({from:{lat:37,lng:127},to:c}),{key:'outsideJeju'});await assert.rejects(nav.route({from:a,to:c,waypoints:[b,b]}),{key:'invalidRequest'});
 const r=await nav.route({from:a,to:c,waypoints:[b],priority:'TIME'});assert.equal(urls.length,1);assert.match(urls[0],/waypoints=/);assert.ok(!JSON.stringify(r).includes('private-test-key'));assert.ok(!urls[0].includes('private-test-key'));
});
test('recommendations cap candidates and distinguish travel time from destination detour',async()=>{
 let calls=0;const nav=createNavigation({kakaoKey:'TEST',kakaoEnabled:true,navigationEnabled:true,navigationDailyLimit:50},{fetchImpl:async url=>{
  if(url.hostname==='dapi.kakao.com')return {ok:true,json:async()=>({documents:Array.from({length:8},(_,i)=>({id:String(i),place_name:'Candidate',x:126.505,y:33.505}))})};
  calls++;const r=structuredClone(fixture);if(url.searchParams.has('waypoints')){r.routes[0].summary.duration=420;r.routes[0].sections[0].duration=180;}return {ok:true,json:async()=>r};
 }});const result=await nav.recommend({from:a,to:c,center:b,minutes:5,category:'CE7'});assert.equal(calls,4);assert.equal(result.places.length,3);assert.equal(result.places[0].seconds,180);assert.equal(result.places[0].extraSeconds,120);
});
test('HTTP endpoints enforce same-origin, free-quota gate and expose navigation UI',async()=>{
 const store=createStore(':memory:',{seed:false}),app=await createApp({store,env:{APP_ORIGIN:'http://127.0.0.1:3000'},fetchImpl:()=>{throw Error('Network forbidden');}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 try{assert.equal((await fetch(base+'/navigation')).status,200);assert.equal((await (await fetch(base+'/api/status')).json()).capabilities.navigation,false);
  const opts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:a,to:c})};assert.equal((await fetch(base+'/api/navigation/route',opts)).status,403);
  const response=await fetch(base+'/api/navigation/route',{...opts,headers:{...opts.headers,Origin:base}});assert.equal(response.status,503);assert.equal((await response.json()).error,'navigationNotEnabled');
 }finally{await new Promise(r=>app.server.close(r));store.close();}
});
test('paid trial reserves the whole-period quota across service instances before network and expires',async()=>{
 const store=createStore(':memory:',{seed:false});let calls=0;
 const config={kakaoKey:'TEST',kakaoEnabled:true,navigationEnabled:true,navigationFreeVerified:false,navigationApprovalId:'test-trial-123',navigationApprovalUntil:new Date(Date.now()+60000).toISOString(),navigationPeriodLimit:2,navigationDailyLimit:50};
 const options={consume:store.consumeApi,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>fixture};}};
 const first=createNavigation(config,options),second=createNavigation(config,options);
 try{await first.route({from:a,to:c});await second.route({from:a,to:c});await assert.rejects(first.route({from:a,to:c}),{key:'quotaReached'});assert.equal(calls,2);config.navigationApprovalUntil=new Date(Date.now()-1).toISOString();await assert.rejects(second.route({from:a,to:c}),{key:'navigationNotEnabled'});assert.equal(calls,2);}finally{store.close();}
});
test('sustained opposite heading on the same road requests a new route',()=>{const r=route(),tracker=createTracker(r),now=Date.now();let result;for(let i=0;i<3;i++)result=tracker.update({...pointAt(r,100-i*10),accuracy:5,speed:8,heading:270,timestamp:now+i*2000},now+i*2000);assert.equal(result.reroute,true);});
