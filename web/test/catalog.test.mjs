import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog,normalizeKakao,normalizePaths,sortPaths,parseIntent,coordinate,distanceMeters} from '../lib/catalog.mjs';
import {configuration,createSettings} from '../lib/settings.mjs';
import {createStore} from '../lib/store.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const response=data=>({ok:true,json:async()=>data});
const tago=items=>response({response:{header:{resultCode:'00'},body:{items:{item:items},totalCount:Array.isArray(items)?items.length:1}}});
import {kakaoFixture} from './fixtures.mjs';
test('provider units, bus-only paths, geometry and ranking are normalized correctly',()=>{
 const paths=normalizeKakao(kakaoFixture);assert.equal(paths[0].totalMinutes,20);assert.equal(paths[0].walkingMeters,100);assert.equal(paths[0].legs[0].minutes,2);assert.equal(paths[0].legs[1].points[0].lat,33.501);assert.equal(sortPaths(paths,'walking')[0].id,'journey-1');assert.equal(sortPaths(paths,'fastest')[0].id,'journey-0');assert.equal(sortPaths(paths,'transfers')[0].id,'journey-0');
 assert.equal(normalizeKakao({routes:[{properties:{type:'SUBWAY',totalTime:10}}]}).length,0);
 const omittedWalk=normalizeKakao({routes:[{properties:{type:'BUS',totalTime:1360,totalDistance:5456,transfers:0},steps:[{properties:{type:'BUS',distance:5063,time:915}}]}]})[0];assert.equal(omittedWalk.walkingMeters,393);assert.equal(omittedWalk.walkingMinutes,null);
 const ods=normalizePaths({result:{path:[{pathType:2,info:{totalTime:30,totalWalk:240},subPath:[{trafficType:3,sectionTime:4,distance:240},{trafficType:2,sectionTime:26,lane:[{busNo:'TEST'}]}]}]}});assert.equal(ods[0].walkingMeters,240);assert.equal(ods[0].walkingMinutes,4);assert.equal(ods[0].transfers,0);
 assert.equal(coordinate('',''),null);assert.equal(coordinate(37.5,127),null);
 assert.equal(distanceMeters({lat:33.5,lng:126.5},{lat:33.5,lng:126.5}),0);
 assert.ok(distanceMeters({lat:33.5,lng:126.5},{lat:33.501,lng:126.5})>=110);
 assert.equal(sortPaths([{id:'long',totalMinutes:10,totalMeters:2000},{id:'short',totalMinutes:20,totalMeters:1000}],'distance')[0].id,'short');
});
test('TAGO caches and deduplicates calls, resolves city, rejects unsupported Jeju and bad keys',async()=>{
 let calls=0;const usage=[];const service=createCatalog({tagoKey:'not-real',tagoDailyLimit:10},{consume:p=>usage.push(p),fetchImpl:async url=>{calls++;const u=new URL(url);assert.equal(u.searchParams.get('serviceKey'),'not-real');if(u.pathname.endsWith('getCtyCodeList'))return tago({cityname:'제주',citycode:'TEST'});return tago([{routeid:'TEST-ROUTE',routeno:'TEST',startnodenm:'A',endnodenm:'B'}]);}});
 const [a,b]=await Promise.all([service.routes('TEST'),service.routes('TEST')]);assert.deepEqual(a,b);assert.equal(calls,2);assert.equal(usage.length,2);await service.routes('TEST');assert.equal(calls,2);
 const unsupported=createCatalog({tagoKey:'not-real'},{fetchImpl:async()=>tago([{cityname:'다른 지역',citycode:1}])});await assert.rejects(unsupported.routes('1'),e=>e.key==='jejuUnsupported');
 const bad=createCatalog({tagoKey:'not-real',cityCode:'TEST'},{fetchImpl:async()=>response({response:{header:{resultCode:'30'}}})});await assert.rejects(bad.routes('1'),e=>e.key==='providerPermission');
});
test('unconfigured and unapproved providers make zero network calls, errors never leak keys',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('SECRET URL');};const offline=createCatalog({tagoKey:'',kakaoKey:'secret',kakaoEnabled:false,odsayKey:'secret',odsayEnabled:false,aiKey:'secret',aiEnabled:false},{fetchImpl});
 for(const action of [()=>offline.routes('1'),()=>offline.stops('city'),()=>offline.places('airport'),()=>offline.journeys({lat:33.5,lng:126.5},{lat:33.51,lng:126.52},'fastest')])await assert.rejects(action());
 const intent=await offline.intent('제주공항까지 적게 걷고 싶어');assert.equal(intent.source,'rules');assert.equal(intent.destination,'제주공항');assert.equal(intent.sort,'walking');assert.equal(calls,0);
 const failed=createCatalog({tagoKey:'secret',cityCode:'TEST'},{fetchImpl});await assert.rejects(failed.routes('1'),e=>e.message==='providerUnavailable'&&!e.message.includes('secret'));
 assert.equal(configuration({AI_ENABLED:'true',OPENAI_API_KEY:'secret',OPENAI_MODEL:'model'}).aiEnabled,false);
});
test('Kakao uses correct route request and free plan gate, caches per endpoints and reranks locally',async()=>{
 let calls=0;const usage=[];const service=createCatalog({kakaoKey:'not-real',kakaoEnabled:true},{consume:p=>usage.push(p),fetchImpl:async(url,options)=>{calls++;assert.equal(new URL(url).pathname,'/v2/routing/publictraffic');assert.equal(new URL(url).searchParams.get('start_x'),'126.5');assert.equal(options.headers.Authorization,'KakaoAK not-real');return response(kakaoFixture);}});
 const from={lat:33.5,lng:126.5},to={lat:33.51,lng:126.54};assert.equal((await service.journeys(from,to,'fastest')).journeys[0].totalMinutes,20);assert.equal((await service.journeys(from,to,'walking')).journeys[0].walkingMeters,50);assert.equal(calls,1);assert.deepEqual(usage,['kakao-routing']);
 await assert.rejects(service.journeys(from,from,'fastest'),e=>e.key==='samePlaces');
});
test('ODsay geometry adds the required coordinate base and shares its daily budget with search',async()=>{
 const calls=[],usage=[];
 const service=createCatalog({odsayKey:'fixture-only',odsayEnabled:true,origin:'http://localhost:3000',odsayDailyLimit:25},{consume:(provider,limit)=>usage.push({provider,limit}),fetchImpl:async(url,options)=>{
  const u=new URL(url);calls.push(u.pathname);assert.equal(options.headers.Referer,'http://localhost:3000');
  if(u.pathname.endsWith('searchPubTransPathT'))return response({result:{path:[{pathType:2,info:{totalTime:20,totalWalk:200,mapObj:'12345:1:0:8'},subPath:[]}]}});
  assert.equal(u.searchParams.get('mapObject'),'0:0@12345:1:0:8');
  return response({result:{lane:[{section:[{graphPos:[{x:126.5,y:33.5},{x:126.51,y:33.51},{x:127,y:37}]}]}]}});
 }});
 const paths=await service.journeys({lat:33.5,lng:126.5},{lat:33.51,lng:126.54},'fastest');
 const geometry=await service.geometry(paths.journeys[0].mapObject);assert.equal(geometry.lines[0].length,2);
 await service.geometry(paths.journeys[0].mapObject);assert.equal(calls.length,2);
 await service.geometry('0:0@12345:1:0:8');assert.equal(calls.length,2);
 assert.deepEqual(usage,[{provider:'odsay',limit:25},{provider:'odsay',limit:25}]);
 await assert.rejects(service.geometry('invalid?key=secret'),e=>e.key==='invalidRequest');
 assert.equal(configuration({ODSAY_DAILY_LIMIT:'999'}).odsayDailyLimit,25);
});
test('settings persist secrets only locally, redact responses and reject env injection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jejubus-settings-'));try{const file=join(dir,'.env');let changed;const s=createSettings(file,{}, {onChange:v=>{changed=v;}});assert.equal(s.status().google,false);await s.save({GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-secret',KAKAO_ENABLED:'false'});assert.equal(changed.googleClientSecret,'fixture-secret');assert.equal(JSON.stringify(s.status()).includes('fixture-secret'),false);assert.match(await readFile(file,'utf8'),/GOOGLE_CLIENT_SECRET=fixture-secret/);await s.save({GOOGLE_CLIENT_SECRET:''});assert.equal(changed.googleClientSecret,'fixture-secret');await assert.rejects(s.save({TAGO_SERVICE_KEY:'x\nEVIL=true'}));await assert.rejects(s.save({AI_ENABLED:'true'}));await assert.rejects(s.save({KAKAO_ENABLED:'yes'}));}finally{await rm(dir,{recursive:true,force:true});}
});
test('manual .env.local edits reload without restart and setup preserves unrelated secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jejubus-local-env-'));
 try{
  const file=join(dir,'.env.local');let changed,updates=0;
  const settings=createSettings(file,{}, {onChange:next=>{changed=next;updates++;}});
  await writeFile(file,'GOOGLE_CLIENT_ID=fixture.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=fixture-secret\nKAKAO_ENABLED=false\n');
  await settings.reload();assert.equal(settings.status().google,true);assert.equal(changed.googleClientSecret,'fixture-secret');await settings.reload();assert.equal(updates,1);
  await writeFile(file,'GOOGLE_CLIENT_ID=fixture.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=changed-secret\nKAKAO_ENABLED=false\n');
  await settings.save({TAGO_SERVICE_KEY:'fixture-tago'});assert.equal(changed.googleClientSecret,'changed-secret');assert.equal(changed.tagoKey,'fixture-tago');
  await writeFile(file,'GOOGLE_CLIENT_ID=fixture.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=\n');await settings.reload();assert.equal(settings.status().google,false);
  assert.equal(JSON.stringify(settings.status()).includes('secret'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ownership, moderation, sample isolation, quota and idempotent posting survive store operations',()=>{
 const s=createStore(':memory:',{seed:false});try{s.createSession('a','A');s.createSession('b','B');const p={title:'Test title',body:'Test content',category:'tip',route:'general',requestId:'same-request'};const id=s.createPost('a',p);assert.equal(s.createPost('a',p),id);assert.equal(s.listPosts('a').length,1);assert.equal(s.editPost('b',id,{...p,title:'Attacker'}),false);assert.equal(s.deletePost('b',id),false);s.reply('a',id,'Reply');const reply=s.listReplies(id,'a')[0];assert.equal(reply.owned,true);assert.equal(s.deleteReply('b',reply.id),false);assert.equal(s.deleteReply('a',reply.id),true);assert.equal(s.listReplies(id).length,0);const report=s.report('b',id,'Reason');assert.equal(s.report('b',id,'Duplicate'),report);s.blockPostAuthor('b',id);assert.equal(s.listPosts('b').length,0);assert.equal(s.listPosts('a').length,1);s.moderate(report,true);assert.equal(s.postExists(id),false);assert.equal(s.listReports()[0].status,'resolved');s.consumeApi('test',2);s.consumeApi('test',2);assert.throws(()=>s.consumeApi('test',2),e=>e.status===429);assert.equal(s.usage()[0].count,2);s.rememberContext({id:'route:test',name:'101',type:'route'});assert.equal(s.context('route:test').name,'101');}finally{s.close();}
});
test('intent parsing handles four supported languages without route or time fabrication',()=>{
 for(const input of ['제주공항까지 환승 없이','to Jeju Airport with no transfers','ここから済州空港へ乗換なし','去济州机场，不换乘']){const p=parseIntent(input);assert.ok(p.destination);assert.equal(p.noTransfers,true);assert.equal(p.source,'rules');assert.equal('minutes' in p,false);}
 assert.equal(parseIntent('제주공항까지 최단거리로').sort,'distance');
});
