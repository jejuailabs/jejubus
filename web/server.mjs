import http from 'node:http';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,extname} from 'node:path';
import {createFirestoreClient,createFirestoreStore} from './lib/firestore.mjs';
import {createGoogleAuth} from './lib/auth.mjs';
import {createCatalog,ServiceError,coordinate} from './lib/catalog.mjs';
import {configuration,createSettings} from './lib/settings.mjs';
import {createAdminService,adminOf,ownerOf} from './lib/admin.mjs';
import {createFeedback} from './lib/feedback.mjs';
import {createBusChat} from './lib/bus-chat.mjs';
import {createNavigation} from './lib/navigation.mjs';
import {createMemberService} from './lib/member.mjs';
import {createSocialAuth} from './lib/social-auth.mjs';
import {createKakaoAlert} from './lib/kakao-alert.mjs';
import {createBlog} from './lib/blog.mjs';
import {createToss} from './lib/toss.mjs';
import {createRouteAdmin} from './lib/route-admin.mjs';
import {fileNetwork} from './lib/network.mjs';
import {createBoard} from './lib/board.mjs';
import {fileTimetable} from './lib/timetable.mjs';
import {createNoticeFeed} from './lib/notice-feed.mjs';
import {bisFetch} from './lib/bis-fetch.mjs';
import {createKudos,createLiveRoom,createTeams} from './lib/live-room.mjs';
import {scheduleUrl} from './lib/network.mjs';
import {createFieldReports} from './lib/field-reports.mjs';
import {createLiveRoute} from './lib/live-route.mjs';
import {matchVariants,placeVehicles} from './lib/table-live.mjs';
import {createNoticeWatch} from './lib/notice-watch.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),v.slice(i+1).trim()];}));
const categories=['question','update','concern','tip','suggest'];
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
async function jsonBody(req,limit=16000){
  if(!req.headers['content-type']?.startsWith('application/json'))fail('invalidRequest',415);
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>limit)fail('invalidRequest',413);}
  try{return JSON.parse(body);}catch{fail('invalidRequest');}
}
// 관광지 사진: 비짓제주 OPEN API로 미리 받아 둔 주소(scripts/build-tour-photos.mjs). 실행 중에는 API를 부르지 않는다.
let tourPhotos=null;
function withPhotos(list){
 tourPhotos??=(()=>{try{return JSON.parse(readFileSync(join(root,'public/data/tour-photos.json'),'utf8')).photos||{};}catch{return {};}})();
 return list.map(s=>{const p=tourPhotos[s.id];return p?{...s,photo:{thumb:p.thumb,link:p.link}}:s;});
}
export async function createApp({env=process.env,store,fetchImpl=fetch,settingsFile=env===process.env?join(root,'.env.local'):null}={}){
  const config=configuration(env);
  config.setupAllowed=config.setupAllowed&&!!settingsFile;
  if(!/^https?:\/\//.test(config.origin)||new URL(config.origin).origin!==config.origin)throw Error('APP_ORIGIN must be an origin without trailing slash');
  if(!store){
    if(env.DATABASE_PROVIDER==='firestore')store=createFirestoreStore(await createFirestoreClient(env,{fetchImpl}));
    else throw Error('Provide a local store or configure DATABASE_PROVIDER=firestore');
  }
  const authOptions={fetchImpl,stateStore:store.putOAuth?store:null};
  let auth=createGoogleAuth(config,authOptions);
  const kakaoAlert=createKakaoAlert(config,store,{fetchImpl});
  const administration=createAdminService(config,store,{notify:message=>kakaoAlert.send(message)});
  const social=createSocialAuth(config,authOptions);
  const toss=createToss(config,{fetchImpl});
  const routeAdmin=createRouteAdmin(config,store);
  const feedback=createFeedback(config,store);
  const members=createMemberService(config,store,{notify:message=>kakaoAlert.send(message),toss});
  const blog=createBlog(config,{fetchImpl,consume:administration.consume});
  const navigation=createNavigation(config,{fetchImpl,consume:administration.consume,observe:store.recordMetric});
  let catalog=createCatalog(config,{fetchImpl,consume:administration.consume,observe:store.recordMetric});
  const network=fileNetwork(join(root,'public/data/network.json'));
  const liveRoute=createLiveRoute({positions:id=>catalog.positions(id),groupOf:network.groupOf});
  const fieldReports=createFieldReports(config,store);
  let todayCache={until:0,value:null};
  const noticeWatch=createNoticeWatch(config,store,{fetchImpl:fetchImpl===fetch?bisFetch:fetchImpl,knownNumber:no=>network.hasNumber(no)});
  const timetable=fileTimetable(join(root,'public/data/timetable.json'));
  const board=createBoard({catalog:{arrivals:id=>catalog.arrivals(id)},network,timetable,noticesFor:(numbers,stopId)=>routeAdmin.noticesByNumber(numbers,stopId,network.numberOf)});
  const bisRequest=fetchImpl===fetch?bisFetch:fetchImpl,noticeFeed=createNoticeFeed({fetchImpl:bisRequest,knownNumber:no=>network.hasNumber(no)}),chatData={timetable,network,board,noticeFeed,fieldReports};
  let busChat=createBusChat(config,{catalog,consume:administration.consume,observe:store.recordMetric,fetchImpl,data:chatData});
  const settings=createSettings(settingsFile,env,{onChange:async next=>{
    const changed=next.googleClientId!==config.googleClientId||next.googleClientSecret!==config.googleClientSecret;
    Object.assign(config,{...next,origin:config.origin});if(config.showSamples)await store.seedSamples();if(changed)auth=createGoogleAuth(config,authOptions);catalog=createCatalog(config,{fetchImpl,consume:administration.consume,observe:store.recordMetric});busChat=createBusChat(config,{catalog,consume:administration.consume,observe:store.recordMetric,fetchImpl,data:chatData});
  }});
  // 챗봇 질문 결과만 센다(내용은 저장하지 않음). answered=AI 답변, failed=AI 실패, fallback=고정 문구 응답.
  const chatMetric=(channel,outcome,started)=>Promise.resolve(store.recordMetric({provider:'chat',period:`${channel}:${outcome}`,operation:channel,ok:outcome==='answered',durationMs:Date.now()-started})).catch(()=>console.warn('{"kind":"usageRecordingFailed","provider":"chat"}'));
  async function askChat(channel,payload){const started=Date.now();try{const result=await busChat.answer(payload);await chatMetric(channel,'answered',started);return result;}catch(error){if(error.key!=='invalidRequest')await chatMetric(channel,'failed',started);throw error;}}
  const liveRoom=createLiveRoom(store,{consume:administration.consume,ask:async(text,locale)=>{const started=Date.now();if(!busChat.enabled()){await chatMetric('room','fallback',started);return null;}try{const result=await busChat.answer({locale,messages:[{role:'user',content:text}]});await chatMetric('room','answered',started);return result.answer;}catch(error){await chatMetric('room','fallback',started);throw error;}}}),kudos=createKudos(store,{consume:administration.consume}),teams=createTeams(store,{consume:administration.consume});
  const limits=new Map(),contexts=new Map([['general',{id:'general',name:'Jeju',type:'general'}]]);
  async function remember(items,type){const values=(items||[]).filter(item=>item.id).map(item=>({id:`${type}:${item.id}`,name:(type==='route'?item.number:item.name)||item.id,type}));if(store.rememberContexts)await store.rememberContexts(values);else for(const c of values)await store.rememberContext(c);}
  function throttle(key,max){const now=Date.now();for(const [k,l]of limits)if(l.until<now)limits.delete(k);const l=limits.get(key)||{count:0,until:now+60000};l.count++;limits.set(key,l);if(l.count>max)fail('rateLimited',429);}
  const cookie=(name,value,age)=>`${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${config.origin.startsWith('https:')?'; Secure':''}`;
  const admin=user=>adminOf(config,user);
  const owner=user=>ownerOf(config,user);
  async function validatePost(p){
    if(!p||typeof p.title!=='string'||typeof p?.body!=='string'||p.title.trim().length<2||p.title.trim().length>100||p.body.trim().length<5||p.body.trim().length>2000||!categories.includes(p.category)||typeof p.route!=='string'||p.route.length>120)fail('titleValidation');
    if(!contexts.has(p.route)&&!await store.context(p.route)&&!(config.showSamples&&['r01','r02','r03'].includes(p.route)))fail('selectContext');
    if(p.requestId!==undefined&&(typeof p.requestId!=='string'||!/^[\w-]{8,80}$/.test(p.requestId)))fail('invalidRequest');
    return {...p,title:p.title.trim(),body:p.body.trim()};
  }
  const handler=async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
    // 토스 결제창은 마이페이지에서만 열린다. 다른 화면의 정책은 넓히지 않는다.
    const payPage=(req.url||'').split('?')[0]==='/my';
    // 지도 실험 화면만 지도 타일 fetch를 허용한다.
    const labPage=(req.url||'').split('?')[0]==='/map-lab';
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'${payPage?' https://js.tosspayments.com':''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://api.cdn.visitjeju.net${payPage?' https://*.tosspayments.com':''}${labPage?' blob:':''}; connect-src 'self'${payPage?' https://*.tosspayments.com':''}${labPage?' https://tile.openstreetmap.org':''};${payPage?' frame-src https://*.tosspayments.com;':''} object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const shared=(data,seconds)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':`public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=10`});res.end(JSON.stringify(data));};
    const redirect=url=>{res.writeHead(302,{Location:url,'Cache-Control':'no-store'});res.end();};
    try{
      if(req.headers.host!==new URL(config.origin).host)return send(403,{error:'invalidHost'});
      const url=new URL(req.url,config.origin),path=url.pathname,method=req.method;
      if(['/api/status','/api/setup','/api/chat','/auth/google'].includes(path))await settings.reload();
      const token=cookies(req).jeju_session,user=path.startsWith('/api/')||path.startsWith('/auth/')?await store.user(token):null;
      if(['POST','PUT','PATCH','DELETE'].includes(method)&&req.headers.origin!==config.origin)fail('invalidOrigin',403);
      if(path.startsWith('/api/')||path.startsWith('/auth/'))throttle(`ip:${req.socket.remoteAddress}`,120);
      if(path==='/api/status'&&method==='GET'){const capabilities={...catalog.capabilities(),ai:busChat.enabled(),navigation:navigation.enabled(),blog:blog.enabled()};return send(200,{googleConfigured:auth.enabled,login:{google:auth.enabled,kakao:social.enabled('kakao'),naver:social.enabled('naver')},channelId:config.kakaoChannelId||null,transitConfigured:capabilities.transit,mapMode:'openstreetmap',journeyMode:capabilities.routing?'provider':'unavailable',capabilities,setupAvailable:config.setupAllowed,showSamples:config.showSamples,user:user?{name:user.name,admin:admin(user),visits:(await store.accountOf(user.id))?.visits||0}:null});}
      if(path==='/api/navigation/route'&&method==='POST'){throttle(`drive:${req.socket.remoteAddress}`,10);return send(200,{route:await navigation.route(await jsonBody(req))});}
      if(path==='/api/navigation/recommend'&&method==='POST'){throttle(`spots:${req.socket.remoteAddress}`,2);return send(200,await navigation.recommend(await jsonBody(req)));}
      if(path.startsWith('/api/setup')){
        if(!config.setupAllowed||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail('notFound',404);
        if(path==='/api/setup'&&method==='GET')return send(200,{token:settings.token,...settings.status(),usage:await store.usage(),callback:`${config.origin}/auth/google/callback`});
        if(method==='POST'&&req.headers['x-setup-token']!==settings.token)fail('forbidden',403);
        if(path==='/api/setup'&&method==='POST')return send(200,await settings.save(await jsonBody(req)));
        if(path==='/api/setup/admin'&&method==='POST'){if(!user)fail('loginRequired',401);return send(200,await settings.save({ADMIN_GOOGLE_SUBS:[...new Set([...config.adminSubjects,user.id.replace(/^google:/,'')])].join(',')}));}
        fail('notFound',404);
      }
      if(path==='/auth/google'&&method==='GET'){
        if(!auth.enabled)return redirect('/?auth=not-configured');throttle(`login:${req.socket.remoteAddress}`,15);
        const result=await auth.start();res.setHeader('Set-Cookie',cookie('jeju_oauth',result.binding,600));return redirect(result.url);
      }
      if(path==='/auth/google/callback'&&method==='GET'){
        try{const identity=await auth.finish({state:url.searchParams.get('state'),code:url.searchParams.get('code'),binding:cookies(req).jeju_oauth});if(token)await store.destroySession(token);const session=await store.createSession(identity.id,identity.name,{email:identity.email});res.setHeader('Set-Cookie',[cookie('jeju_session',session,7*86400),cookie('jeju_oauth','',0)]);return redirect('/?auth=ok');}
        catch(error){res.setHeader('Set-Cookie',cookie('jeju_oauth','',0));return redirect(`/?auth=${error.key==='accountSuspended'?'suspended':'failed'}`);}
      }
      const socialRoute=path.match(/^\/auth\/(kakao|naver)(\/alert|\/callback)?$/);
      if(socialRoute&&method==='GET'){
        const [,name,step]=socialRoute;
        if(step==='/callback'){
          try{
            const identity=await social.finish(name,{state:url.searchParams.get('state'),code:url.searchParams.get('code'),binding:cookies(req).jeju_oauth});
            if(identity.alert){if(!owner(user)||!identity.refreshToken)throw Error('Not allowed');await kakaoAlert.save(identity.refreshToken);await kakaoAlert.send('✅ 제주버스 관리자 알림이 연결됐어요');res.setHeader('Set-Cookie',cookie('jeju_oauth','',0));return redirect('/admin?alert=connected');}
            if(token)await store.destroySession(token);const session=await store.createSession(identity.id,identity.name);res.setHeader('Set-Cookie',[cookie('jeju_session',session,7*86400),cookie('jeju_oauth','',0)]);return redirect('/?auth=ok');
          }catch(error){res.setHeader('Set-Cookie',cookie('jeju_oauth','',0));return redirect(`/?auth=${error.key==='accountSuspended'?'suspended':'failed'}`);}
        }
        if(step==='/alert'&&(name!=='kakao'||!owner(user)||!kakaoAlert.ready()))fail('forbidden',403);
        if(!social.enabled(name))return redirect('/?auth=not-configured');
        throttle(`login:${req.socket.remoteAddress}`,15);
        const result=await social.start(name,{alert:step==='/alert'});res.setHeader('Set-Cookie',cookie('jeju_oauth',result.binding,600));return redirect(result.url);
      }
      if(path==='/api/cron/notices'&&method==='GET'){if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)fail('forbidden',403);return send(200,await noticeWatch.check());}
      if(path==='/api/field-reports'&&method==='POST'){throttle(`field:${req.socket.remoteAddress}`,6);return send(200,await fieldReports.submit(await jsonBody(req),user));}
      if(path==='/api/room/ping'&&method==='POST'){throttle(`room-ping:${req.socket.remoteAddress}`,6);return send(200,await liveRoom.ping(await jsonBody(req)));}
      if(path==='/api/room/say'&&method==='POST'){throttle(`room-say:${req.socket.remoteAddress}`,8);const b=await jsonBody(req);if(b?.bot)throttle(`room-bot:${req.socket.remoteAddress}`,2);return send(200,await liveRoom.say(b,{locale:typeof b?.locale==='string'&&['ko','en','zh','ja'].includes(b.locale)?b.locale:'ko'}));}
      if(path==='/api/room/report'&&method==='POST'){throttle(`room-report:${req.socket.remoteAddress}`,5);return send(200,await liveRoom.report(await jsonBody(req)));}
      if(path==='/api/quest/points'&&method==='POST'){throttle(`quest:${req.socket.remoteAddress}`,10);return send(200,await teams.add(await jsonBody(req)));}
      if(path==='/api/kudos'&&method==='POST'){throttle(`kudos:${req.socket.remoteAddress}`,20);return send(200,await kudos.add(await jsonBody(req)));}
      if(path==='/api/logout'&&method==='POST'){await store.destroySession(token);res.setHeader('Set-Cookie',cookie('jeju_session','',0));return send(200,{ok:true});}
      const query=()=>{const q=url.searchParams.get('q')?.trim();if(!q||q.length>100)fail('queryRequired');return q;};
      const page=()=>{const p=Number(url.searchParams.get('page')||1);if(!Number.isInteger(p)||p<1||p>45)fail('invalidRequest');return p;};
      const itemId=()=>{const id=url.searchParams.get('id');if(!id||!/^[\w:.-]{1,100}$/.test(id))fail('invalidRequest');return id;};
      if(method==='GET'){
        if(path==='/api/cities')return send(200,await catalog.cities());
        if(path==='/api/routes'){const result=await catalog.routes(query(),page());await remember(result.routes,'route');return send(200,result);}
        if(path==='/api/stops'){const result=await catalog.stops(query(),page());await remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/nearby'){const result=await catalog.nearby(url.searchParams.get('lat'),url.searchParams.get('lng'));await remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/places')return send(200,await catalog.places(query(),page()));
        if(path==='/api/route-stops'){const result=await catalog.routeStops(itemId());await remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/positions')return send(200,await catalog.positions(itemId()));
        if(path==='/api/arrivals')return send(200,await catalog.arrivals(itemId()));
        if(path==='/api/live/route')return shared(await liveRoute.route(itemId()),25);
        if(path==='/api/field-reports/summary')return send(200,await fieldReports.summary(url.searchParams.get('stop')));
        if(path==='/api/today'){if(todayCache.until<Date.now()){const [notices,log]=await Promise.all([routeAdmin.today(network.numberOf),fieldReports.changelog()]);todayCache={until:Date.now()+60000,value:{...notices,changes:log.changes}};}return shared(todayCache.value,60);}
        if(path==='/api/board/stop'){const result=await board.stop(itemId());await remember(result.arrivals.map(a=>({id:a.routeId,number:a.number})),'route');return shared(result,25);}
        if(path==='/api/board/side'){const q=query(),[place]=await network.searchStops(q),result=place&&await network.sideCheck(itemId(),place.name);if(!result)fail('notFound',404);return shared(result,3600);}
        if(path==='/api/board/find'){const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')),point=Number.isFinite(lat)&&Number.isFinite(lng)&&url.searchParams.has('lat')?{lat,lng}:null,stop=await network.stopByName(query(),point);if(!stop)fail('notFound',404);return send(200,stop);}
        if(path==='/api/board/home'){const result=await board.homeLine(itemId(),query());if(!result)fail('notFound',404);return shared(result,300);}
        if(path==='/api/timetable'){const no=url.searchParams.get('no')||'',stop=url.searchParams.get('stop')||null,towards=url.searchParams.get('towards')||null,toName=url.searchParams.get('to')||null;if(!/^[\w-]{1,12}$/.test(no)||(stop&&stop.length>100)||(towards&&towards.length>100)||(toName&&toName.length>100))fail('invalidRequest');return shared(await timetable.view(no,{stopName:stop,towards,toName})||{no,groups:[],sourceUrl:scheduleUrl(no)},60);}
        // 정류장 노트의 실시간 위치. 방향이 같은 변형의 차량만 표 구간에 얹는다.
        if(path==='/api/timetable/live'){const no=url.searchParams.get('no')||'',group=Number(url.searchParams.get('group'));if(!/^[\w-]{1,12}$/.test(no)||!Number.isInteger(group)||group<0)fail('invalidRequest');const table=(await timetable.view(no))?.groups?.[group];if(!table)fail('notFound',404);const names=table.stops.map(s=>s.name),variants=matchVariants(names,await network.variantStops(no));if(!variants.length)return shared({matched:false,vehicles:[]},300);const seen=new Set(),picks=[];for(const v of variants){const key=(await network.groupOf(v.id))?.key||v.id;if(!seen.has(key)&&picks.length<3){seen.add(key);picks.push(v.id);}}const results=await Promise.allSettled(picks.map(id=>liveRoute.route(id))),ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!ok.length)throw results[0].reason;const vehicles=[...new Map(ok.flatMap(r=>r.vehicles).map(v=>[v.id,v])).values()];return shared({matched:true,vehicles:placeVehicles(vehicles,variants),receivedAt:ok[0].receivedAt},25);}
        if(path==='/api/board/map'){const [south,west,north,east]=(url.searchParams.get('b')||'').split(',').map(Number),zoom=Number(url.searchParams.get('z'));if(![south,west,north,east].every(Number.isFinite)||!Number.isInteger(zoom)||zoom<7||zoom>19||north<=south||east<=west)fail('invalidRequest');return shared(await network.stopsIn({south,west,north,east},zoom),3600);}
        if(path==='/api/board/nearby'){const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng'));if(!coordinate(lat,lng))fail('outsideJeju');const stops=await network.nearest({lat,lng});await remember(stops,'stop');return send(200,{stops});}
        if(path==='/api/notice-board')return shared(await noticeFeed.list(),300);
        if(path.startsWith('/api/notice-board/'))return shared(await noticeFeed.detail(path.slice(18)),3600);
        if(path==='/api/room/top')return shared(await liveRoom.top(),15);
        if(path==='/api/room'){const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')),radius=Number(url.searchParams.get('r'));return shared(await liveRoom.view({lat,lng,radius}),4);}
        if(path==='/api/quest')return shared({...await teams.board(),totals:await network.regionTotals()},60);
        if(path==='/api/kudos')return shared(await kudos.get(url.searchParams.get('no')),60);
        if(path==='/api/board/next'){const no=url.searchParams.get('no')||'';if(!/^[\w-]{1,12}$/.test(no))fail('invalidRequest');return shared({stops:await network.stopsAfter(itemId(),no)},3600);}
        if(path==='/api/spots')return shared({spots:withPhotos(await network.spots())},3600);
        if(path==='/api/live/to'){const q=query(),lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')),has=url.searchParams.has('lat');if(has&&!coordinate(lat,lng))fail('outsideJeju');const result=await network.toward(q,has?{lat:Math.round(lat*1000)/1000,lng:Math.round(lng*1000)/1000}:null);if(!result)fail('notFound',404);return shared(result,has?300:3600);}
        if(path==='/api/tour'){const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')),has=url.searchParams.has('lat');if(has&&!coordinate(lat,lng))fail('outsideJeju');return shared({spots:withPhotos(await network.tour(has?{lat:Math.round(lat*1000)/1000,lng:Math.round(lng*1000)/1000}:null))},has?300:3600);}
        if(path==='/api/board/numbers')return shared({numbers:await network.numbers()},3600);
        if(path==='/api/board/trip'){const by=url.searchParams.get('by');if(by&&!/^\d{2}:\d{2}$/.test(by))fail('invalidRequest');const result=await board.trip(itemId(),query(),by||null);if(!result)fail('notFound',404);return send(200,result);}
        if(path==='/api/contexts'){const q=query(),[routes,stops]=await Promise.all([network.findRoutes(q,6),/^\d+$/.test(q)?[]:network.namedStops(q,8)]);const named=stops.map(s=>({...s,label:s.next?`${s.name} · 다음 ${s.next}`:s.name}));await remember(routes,'route');await remember(named.map(s=>({id:s.id,name:s.label})),'stop');return send(200,{routes,stops:named.map(({lat,lng,...s})=>s)});}
        if(path==='/api/board/named')return shared({stops:await network.namedStops(query())},3600);
        if(path==='/api/board/places')return shared({stops:await network.searchStops(query())},3600);
        if(path==='/api/route-groups'){const result=await network.groups(query());if(!result)fail('notFound',404);return shared(result,3600);}
        if(path==='/api/geometry')return send(200,await catalog.geometry(url.searchParams.get('mapObject')));
      }
      if(path==='/api/journeys'&&method==='POST'){const p=await jsonBody(req);if(!['fastest','distance','walking','transfers'].includes(p?.sort))fail('invalidRequest');return send(200,await catalog.journeys(p.from,p.to,p.sort));}
      if(path==='/api/intent'&&method==='POST'){const p=await jsonBody(req);if(typeof p?.input!=='string'||!p.input.trim()||p.input.length>500)fail('queryRequired');return send(200,await catalog.intent(p.input));}
      if(path==='/api/chat'&&method==='POST'){if(!await administration.allowed('ai'))fail('servicePaused',503);if(!busChat.enabled())fail('aiNotEnabled',503);if(!user)fail('loginRequired',401);throttle(`chat:${user.id}`,8);return send(200,await askChat('assistant',await jsonBody(req)));}
      if(path==='/api/posts'&&method==='GET')return send(200,{posts:await Promise.all((await store.listPosts(user?.id,{includeSamples:config.showSamples})).map(async p=>({...p,routeNo:String(p.route).startsWith('route:')?await network.numberOf(p.route.slice(6)).catch(()=>null):null,contextName:(await store.context(p.route))?.name||null})))});
      if(path==='/api/posts'&&method==='POST'){if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,10);const p=await validatePost(await jsonBody(req));return send(201,{id:await store.createPost(user.id,p)});}
      const post=path.match(/^\/api\/posts\/([\w-]+)(?:\/(replies|like|report|block))?$/);
      if(post){
        const [,id,action]=post;if(!await store.postExists(id))fail('notFound',404);
        if(action==='replies'&&method==='GET')return send(200,{replies:await store.listReplies(id,user?.id)});
        if(['POST','PATCH','DELETE'].includes(method)){
          if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,20);
          if(!action&&method==='DELETE'){if(!await store.deletePost(user.id,id))fail('forbidden',403);return send(200,{ok:true});}
          if(!action&&method==='PATCH'){const p=await jsonBody(req);const previous=(await store.listPosts(user.id)).find(p=>p.id===id);if(!previous?.owned)fail('forbidden',403);contexts.set(previous.route,{id:previous.route});if(!await store.editPost(user.id,id,await validatePost(p)))fail('forbidden',403);return send(200,{ok:true});}
          if(method==='POST'){
            if(action==='like'){await store.toggleLike(user.id,id);return send(200,{ok:true});}
            if(action==='block'){await store.blockPostAuthor(user.id,id);return send(200,{ok:true});}
            const p=await jsonBody(req);
            if(action==='report'){if(typeof p?.reason!=='string'||p.reason.trim().length<2||p.reason.length>500)fail('invalidRequest');return send(201,{id:await store.report(user.id,id,p.reason.trim())});}
            if(action==='replies'){if(typeof p?.body!=='string'||p.body.trim().length<2||p.body.trim().length>1000)fail('commentValidation');await store.reply(user.id,id,p.body.trim());return send(201,{ok:true});}
          }
        }
      }
      if(path==='/api/blog'&&method==='GET'){throttle(`blog:${req.socket.remoteAddress}`,20);return send(200,await blog.search(query()));}
      if(path==='/api/reviews'&&method==='GET'){const c=url.searchParams.get('context'),variants=typeof c==='string'&&c.startsWith('route:')?await network.variantsOf(c.slice(6)).catch(()=>[]):[];return send(200,await members.reviews(c,user?.id,variants.map(id=>`route:${id}`)));}
      if(path==='/api/reviews'&&method==='POST'){if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,10);return send(201,await members.saveReview(user,await jsonBody(req)));}
      const reviewItem=path.match(/^\/api\/reviews\/([a-f0-9]{32})$/);
      if(reviewItem&&['PATCH','DELETE'].includes(method)){if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,20);return send(200,method==='DELETE'?await members.deleteReview(user,reviewItem[1]):await members.updateReview(user,reviewItem[1],await jsonBody(req)));}
      if(path==='/api/inquiries'&&method==='POST'){if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,5);return send(201,await members.createInquiry(user,await jsonBody(req)));}
      if(path==='/api/me'||path.startsWith('/api/me/')){
        if(!user)fail('loginRequired',401);
        if(path==='/api/me'&&method==='GET')return send(200,await members.me(user));
        if(path==='/api/me/progress'&&method==='GET')return send(200,{data:(await store.recordGet('progress',user.id))?.data||{}});
        if(path==='/api/me/progress'&&method==='POST'){throttle(`progress:${user.id}`,30);const data=(await jsonBody(req,450000))?.data;if(!data||typeof data!=='object'||Array.isArray(data)||Buffer.byteLength(JSON.stringify(data))>400000)fail('invalidRequest');const keys=['quest','trips','rides','myStops','homeStop','ttRecent','places','favGone','recent'],clean=Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));await store.recordPut('progress',user.id,{id:user.id,user_id:user.id,data:clean,updated:Date.now()});return send(200,{ok:true});}
        if(path==='/api/me/saved'&&method==='GET')return send(200,await members.saved(user));
        if(path==='/api/me/saved'&&method==='POST'){throttle(`write:${user.id}`,30);return send(200,await members.toggleSaved(user,await jsonBody(req)));}
        if(path==='/api/me/withdraw'&&method==='POST'){await members.withdraw(user,await jsonBody(req));await store.recordDelete('progress',user.id);res.setHeader('Set-Cookie',cookie('jeju_session','',0));return send(200,{ok:true});}
      }
      if(path==='/api/me/payments/confirm'&&method==='POST'){if(!user)fail('loginRequired',401);throttle(`pay:${user.id}`,10);return send(200,await members.confirmCard(user,await jsonBody(req)));}
      if(path==='/api/notices'&&method==='GET')return send(200,await routeAdmin.notices(url.searchParams.get('context')));
      if(path==='/api/admin/notice-drafts'&&method==='GET')return send(200,await noticeWatch.drafts(user));
      if(path==='/api/admin/notice-check'&&method==='POST'){if(!admin(user))fail('forbidden',403);return send(200,await noticeWatch.check());}
      if(path==='/api/admin/notice-drafts'&&method==='POST'){const b=await jsonBody(req);const result=b?.dismiss?await noticeWatch.dismiss(user,b.id):await noticeWatch.publish(user,b);todayCache.until=0;return send(200,result);}
      if(path==='/api/admin/field-reports'&&method==='GET')return send(200,await fieldReports.adminList(user));
      if(path==='/api/admin/field-reports'&&method==='POST'){const b=await jsonBody(req);return send(200,await fieldReports.closeGroup(user,b?.ids,b?.action));}
      if(path==='/api/admin/changelog'&&method==='POST'){const change=await fieldReports.saveChange(user,await jsonBody(req));todayCache.until=0;return send(200,change);}
      if(path==='/api/admin/overview'&&method==='GET')return send(200,{...await routeAdmin.overview(user),network:await network.stats().catch(()=>null)});
      if(path==='/api/admin/notices'&&method==='POST')return send(200,await routeAdmin.saveNotice(user,await jsonBody(req)));
      const adminNotice=path.match(/^\/api\/admin\/notices\/([a-f0-9]{32})$/);
      if(adminNotice&&method==='POST')return send(200,await routeAdmin.setNotice(user,adminNotice[1],(await jsonBody(req))?.action));
      if(path==='/api/admin/room'&&method==='GET'){if(!admin(user))fail('forbidden',403);return send(200,await liveRoom.adminList());}
      if(path==='/api/admin/room'&&method==='POST'){if(!admin(user))fail('forbidden',403);const b=await jsonBody(req);return send(200,await liveRoom.adminHide(b?.id,b?.hide));}
      if(path==='/api/admin/reviews'&&method==='GET')return send(200,await members.adminReviews(user));
      const adminReview=path.match(/^\/api\/admin\/reviews\/([a-f0-9]{32})$/);
      if(adminReview&&method==='POST')return send(200,await members.setReviewHidden(user,adminReview[1],(await jsonBody(req))?.hide));
      if(path==='/api/admin/inquiries'&&method==='GET')return send(200,{...await members.adminInquiries(user),alert:{ready:kakaoAlert.ready(),connected:await kakaoAlert.connected(),owner:owner(user)}});
      const adminPayment=path.match(/^\/api\/admin\/inquiries\/(\w{1,20})\/payment$/);
      if(adminPayment&&method==='POST')return send(200,await members.setPayment(user,adminPayment[1],await jsonBody(req)));
      const adminInquiry=path.match(/^\/api\/admin\/inquiries\/(\w{1,20})$/);
      if(adminInquiry&&method==='POST')return send(200,await members.answerInquiry(user,adminInquiry[1],await jsonBody(req)));
      const reply=path.match(/^\/api\/replies\/([\w-]+)$/);
      if(reply&&method==='DELETE'){if(!user)fail('loginRequired',401);if(!await store.deleteReply(user.id,reply[1]))fail('forbidden',403);return send(200,{ok:true});}
      if(path==='/api/admin/suggestions'&&method==='GET')return send(200,await feedback.adminList(user));
      const suggestion=path.match(/^\/api\/admin\/suggestions\/([\w:-]{1,80})$/);
      if(suggestion&&method==='POST')return send(200,await feedback.setStatus(user,suggestion[1],await jsonBody(req)));
      if(path==='/api/admin/dashboard'&&method==='GET')return send(200,await administration.dashboard(user));
      const member=path.match(/^\/api\/admin\/users\/(.+)$/);
      if(member&&method==='POST')return send(200,await administration.updateUser(user,decodeURIComponent(member[1]),await jsonBody(req)));
      const provider=path.match(/^\/api\/admin\/providers\/([\w-]+)$/);
      if(provider&&method==='PUT')return send(200,await administration.updateProvider(user,provider[1],await jsonBody(req)));
      if(path==='/api/admin/reports'&&method==='GET'){if(!admin(user))fail('forbidden',403);return send(200,{reports:await store.listReports()});}
      const report=path.match(/^\/api\/admin\/reports\/([\w-]+)$/);
      if(report&&method==='POST'){if(!admin(user))fail('forbidden',403);const p=await jsonBody(req);if(typeof p?.hide!=='boolean')fail('invalidRequest');if(!await store.moderate(report[1],p.hide))fail('notFound',404);return send(200,{ok:true});}
      if(path.startsWith('/api/'))fail('notFound',404);
      if(!['GET','HEAD'].includes(method))fail('methodNotAllowed',405);
      const pathname=path==='/'?'/index.html':path==='/navigation'?'/navigation.html':path==='/admin'?'/admin.html':path==='/my'?'/my.html':path==='/privacy'?'/privacy.html':path==='/map-lab'?'/map-lab.html':path==='/setup'&&config.setupAllowed?'/setup.html':decodeURIComponent(path);
      const file=resolve(root,'public',`.${pathname}`);if(!file.startsWith(join(root,'public')+'/')&&!file.startsWith(join(root,'public')+'\\'))fail('forbidden',403);
      const labData=path==='/data/network.json'||path==='/data/map-lab-shapes.json',type=labData?'application/json; charset=utf-8':mime[extname(file)];if(!type)fail('notFound',404);
      const data=await readFile(file);res.writeHead(200,{'Content-Type':type,'Cache-Control':path.startsWith('/art/')?'public, max-age=604800, s-maxage=31536000':'no-cache'});res.end(method==='HEAD'?undefined:data);
    }catch(error){if((error.status||500)>=500&&error.code!=='ENOENT')console.warn(JSON.stringify({kind:'serviceFailure',key:error.key||'serverError',providerCode:error.providerCode||null}));send(error.status||(error.code==='ENOENT'?404:500),{error:error.key||(error.code==='ENOENT'?'notFound':'serverError')});}
  };
  const server=http.createServer(handler);
  return {server,handler,store,config};
}
