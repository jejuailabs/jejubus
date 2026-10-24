// Offline UI verification only. Never load .env or connect to a live provider.
import {createApp} from '../server.mjs';
import {createStore} from '../lib/store.mjs';
import {kakaoFixture} from './fixtures.mjs';
const store=createStore(':memory:',{seed:false});
const token=store.createSession('google:qa-owner','QA Rider');
const post=store.createPost('google:qa-owner',{title:'QA · 정류장 질문',body:'이 글은 오프라인 브라우저 검증용입니다.',category:'question',route:'general'});
store.createSession('google:qa-other','QA Other');store.reply('google:qa-other',post,'QA · 다른 사용자의 답변입니다.');
const stops=[{nodeid:'QA-STOP-A',nodenm:'QA 출발 정류장',nodeno:'111',nodeord:1,gpslati:33.5,gpslong:126.52},{nodeid:'QA-STOP-B',nodenm:'QA 도착 정류장',nodeno:'112',nodeord:2,gpslati:33.51,gpslong:126.54}];
const tago=items=>({response:{header:{resultCode:'00'},body:{items:{item:items},totalCount:items.length}}});
const app=await createApp({store,env:{APP_ORIGIN:'http://localhost:3001',NODE_ENV:'production',TAGO_SERVICE_KEY:'OFFLINE-FIXTURE',TAGO_CITY_CODE:'QA',KAKAO_REST_KEY:'OFFLINE-FIXTURE',KAKAO_ENABLED:'true',ADMIN_GOOGLE_SUBS:'qa-owner',OPENAI_API_KEY:'OFFLINE-FIXTURE',OPENAI_MODEL:'gpt-5.4-mini',AI_ENABLED:'true',AI_BILLING_APPROVED:'true',AI_APPROVAL_ID:'offline-qa-fixture',AI_APPROVAL_UNTIL:new Date(Date.now()+86400000).toISOString()},fetchImpl:async(input,options={})=>{
 const u=new URL(input);let data;
 if(u.host==='api.openai.com'){
  const body=JSON.parse(options.body);
  if(body.tools&&body.tool_choice==='required')data={output:[{type:'function_call',name:'route_status',call_id:'QA-CALL',arguments:JSON.stringify({query:'QA-101',routeId:null})}]};
  else {const evidence=JSON.parse(body.input.at(-1).output);data={output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({answer:'오프라인 검증용 모의 응답입니다. QA-101 노선의 모의 차량 1대를 확인했습니다. 실제 운행 정보가 아닙니다. <img src=x onerror=alert(1)>',sourceIds:evidence.sources.map(x=>x.id)})}]}]};}
 }else if(u.host==='apis.data.go.kr'){
  if(u.pathname.endsWith('getRouteNoList'))data=tago([{routeid:'QA-ROUTE',routeno:'QA-101',startnodenm:'QA 출발',endnodenm:'QA 도착'}]);
  else if(u.pathname.endsWith('getSttnAcctoArvlPrearngeInfoList'))data=tago([{routeid:'QA-ROUTE',routeno:'QA-101',arrtime:120,arrprevstationcnt:2,nodeid:'QA-STOP-A'}]);
  else if(u.pathname.endsWith('getRouteAcctoBusLcList'))data=tago([{vehicleno:'QA-BUS',routeno:'QA-101',nodenm:'QA 출발 정류장',gpslati:33.505,gpslong:126.53}]);
  else data=tago(stops);
 }else if(u.host==='dapi.kakao.com')data=u.pathname.includes('/routing/')?kakaoFixture:{documents:[{id:'QA-PLACE',place_name:u.searchParams.get('query'),address_name:'QA · offline fixture',y:u.searchParams.get('query').includes('출발')?'33.5':'33.51',x:u.searchParams.get('query').includes('출발')?'126.52':'126.54'}]};
 else throw Error('External network forbidden in QA');
 return {ok:true,json:async()=>data};
}});
app.server.prependListener('request',(req,res)=>{if(req.url==='/?qa=1')res.setHeader('Set-Cookie',`jeju_session=${token}; Path=/; HttpOnly; SameSite=Lax`);});
app.server.listen(0,'127.0.0.1',()=>{app.config.origin=`http://localhost:${app.server.address().port}`;console.log(`Offline QA server: ${app.config.origin}/?qa=1 (test data only)`);});
const stop=()=>app.server.close(()=>{store.close();process.exit(0);});setTimeout(stop,15*60*1000).unref();process.on('SIGINT',stop);
