import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,extname} from 'node:path';
import {createStore} from './lib/store.mjs';
import {createGoogleAuth} from './lib/auth.mjs';
import {createCatalog,ServiceError,coordinate} from './lib/catalog.mjs';
import {configuration,createSettings} from './lib/settings.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),v.slice(i+1).trim()];}));
const categories=['question','update','concern','tip'];
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
async function jsonBody(req){
  if(!req.headers['content-type']?.startsWith('application/json'))fail('invalidRequest',415);
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16000)fail('invalidRequest',413);}
  try{return JSON.parse(body);}catch{fail('invalidRequest');}
}
export async function createApp({env=process.env,store,fetchImpl=fetch,settingsFile=env===process.env?join(root,'.env.local'):null}={}){
  const config=configuration(env);
  config.setupAllowed=config.setupAllowed&&!!settingsFile;
  if(!/^https?:\/\//.test(config.origin)||new URL(config.origin).origin!==config.origin)throw Error('APP_ORIGIN must be an origin without trailing slash');
  if(!store){await mkdir(join(root,'data'),{recursive:true});store=createStore(join(root,'data','jejubus.sqlite'),{seed:config.showSamples});}
  let auth=createGoogleAuth(config,{fetchImpl});
  let catalog=createCatalog(config,{fetchImpl,consume:store.consumeApi});
  const settings=createSettings(settingsFile,env,{onChange:next=>{
    const changed=next.googleClientId!==config.googleClientId||next.googleClientSecret!==config.googleClientSecret;
    Object.assign(config,{...next,origin:config.origin});if(config.showSamples)store.seedSamples();if(changed)auth=createGoogleAuth(config,{fetchImpl});catalog=createCatalog(config,{fetchImpl,consume:store.consumeApi});
  }});
  const limits=new Map(),contexts=new Map([['general',{id:'general',name:'Jeju',type:'general'}]]);
  function remember(items,type){for(const item of items||[]){if(!item.id)continue;const c={id:`${type}:${item.id}`,name:(type==='route'?item.number:item.name)||item.id,type};store.rememberContext(c);}}
  function throttle(key,max){const now=Date.now();for(const [k,l]of limits)if(l.until<now)limits.delete(k);const l=limits.get(key)||{count:0,until:now+60000};l.count++;limits.set(key,l);if(l.count>max)fail('rateLimited',429);}
  const cookie=(name,value,age)=>`${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${config.origin.startsWith('https:')?'; Secure':''}`;
  const admin=user=>!!user&&config.adminSubjects.includes(user.id.replace(/^google:/,''));
  function validatePost(p){
    if(!p||typeof p.title!=='string'||typeof p?.body!=='string'||p.title.trim().length<2||p.title.trim().length>100||p.body.trim().length<5||p.body.trim().length>2000||!categories.includes(p.category)||typeof p.route!=='string'||p.route.length>120)fail('titleValidation');
    if(!contexts.has(p.route)&&!store.context(p.route)&&!(config.showSamples&&['r01','r02','r03'].includes(p.route)))fail('selectContext');
    if(p.requestId!==undefined&&(typeof p.requestId!=='string'||!/^[\w-]{8,80}$/.test(p.requestId)))fail('invalidRequest');
    return {...p,title:p.title.trim(),body:p.body.trim()};
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const redirect=url=>{res.writeHead(302,{Location:url,'Cache-Control':'no-store'});res.end();};
    try{
      if(req.headers.host!==new URL(config.origin).host)return send(403,{error:'invalidHost'});
      const url=new URL(req.url,config.origin),path=url.pathname,method=req.method;
      if(['/api/status','/api/setup','/auth/google'].includes(path))await settings.reload();
      const token=cookies(req).jeju_session,user=store.user(token);
      if(['POST','PUT','PATCH','DELETE'].includes(method)&&req.headers.origin!==config.origin)fail('invalidOrigin',403);
      if(path.startsWith('/api/')||path.startsWith('/auth/'))throttle(`ip:${req.socket.remoteAddress}`,120);
      if(path==='/api/status'&&method==='GET'){const capabilities=catalog.capabilities();return send(200,{googleConfigured:auth.enabled,transitConfigured:capabilities.transit,mapMode:'openstreetmap',journeyMode:capabilities.routing?'provider':'unavailable',capabilities,setupAvailable:config.setupAllowed,showSamples:config.showSamples,user:user?{name:user.name,admin:admin(user)}:null});}
      if(path.startsWith('/api/setup')){
        if(!config.setupAllowed||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail('notFound',404);
        if(path==='/api/setup'&&method==='GET')return send(200,{token:settings.token,...settings.status(),usage:store.usage(),callback:`${config.origin}/auth/google/callback`});
        if(method==='POST'&&req.headers['x-setup-token']!==settings.token)fail('forbidden',403);
        if(path==='/api/setup'&&method==='POST')return send(200,await settings.save(await jsonBody(req)));
        if(path==='/api/setup/admin'&&method==='POST'){if(!user)fail('loginRequired',401);return send(200,await settings.save({ADMIN_GOOGLE_SUBS:[...new Set([...config.adminSubjects,user.id.replace(/^google:/,'')])].join(',')}));}
        fail('notFound',404);
      }
      if(path==='/auth/google'&&method==='GET'){
        if(!auth.enabled)return redirect('/?auth=not-configured');throttle(`login:${req.socket.remoteAddress}`,15);
        const result=auth.start();res.setHeader('Set-Cookie',cookie('jeju_oauth',result.binding,600));return redirect(result.url);
      }
      if(path==='/auth/google/callback'&&method==='GET'){
        try{const identity=await auth.finish({state:url.searchParams.get('state'),code:url.searchParams.get('code'),binding:cookies(req).jeju_oauth});if(token)store.destroySession(token);const session=store.createSession(identity.id,identity.name);res.setHeader('Set-Cookie',[cookie('jeju_session',session,7*86400),cookie('jeju_oauth','',0)]);return redirect('/');}
        catch{res.setHeader('Set-Cookie',cookie('jeju_oauth','',0));return redirect('/?auth=failed');}
      }
      if(path==='/api/logout'&&method==='POST'){store.destroySession(token);res.setHeader('Set-Cookie',cookie('jeju_session','',0));return send(200,{ok:true});}
      const query=()=>{const q=url.searchParams.get('q')?.trim();if(!q||q.length>100)fail('queryRequired');return q;};
      const page=()=>{const p=Number(url.searchParams.get('page')||1);if(!Number.isInteger(p)||p<1||p>45)fail('invalidRequest');return p;};
      const itemId=()=>{const id=url.searchParams.get('id');if(!id||!/^[\w:.-]{1,100}$/.test(id))fail('invalidRequest');return id;};
      if(method==='GET'){
        if(path==='/api/cities')return send(200,await catalog.cities());
        if(path==='/api/routes'){const result=await catalog.routes(query(),page());remember(result.routes,'route');return send(200,result);}
        if(path==='/api/stops'){const result=await catalog.stops(query(),page());remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/nearby'){const result=await catalog.nearby(url.searchParams.get('lat'),url.searchParams.get('lng'));remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/places')return send(200,await catalog.places(query(),page()));
        if(path==='/api/route-stops'){const result=await catalog.routeStops(itemId());remember(result.stops,'stop');return send(200,result);}
        if(path==='/api/positions')return send(200,await catalog.positions(itemId()));
        if(path==='/api/arrivals')return send(200,await catalog.arrivals(itemId()));
        if(path==='/api/geometry')return send(200,await catalog.geometry(url.searchParams.get('mapObject')));
      }
      if(path==='/api/journeys'&&method==='POST'){const p=await jsonBody(req);if(!['fastest','distance','walking','transfers'].includes(p?.sort))fail('invalidRequest');return send(200,await catalog.journeys(p.from,p.to,p.sort));}
      if(path==='/api/intent'&&method==='POST'){const p=await jsonBody(req);if(typeof p?.input!=='string'||!p.input.trim()||p.input.length>500)fail('queryRequired');return send(200,await catalog.intent(p.input));}
      if(path==='/api/posts'&&method==='GET')return send(200,{posts:store.listPosts(user?.id,{includeSamples:config.showSamples}).map(p=>({...p,contextName:store.context(p.route)?.name||null}))});
      if(path==='/api/posts'&&method==='POST'){if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,10);const p=validatePost(await jsonBody(req));return send(201,{id:store.createPost(user.id,p)});}
      const post=path.match(/^\/api\/posts\/([\w-]+)(?:\/(replies|like|report|block))?$/);
      if(post){
        const [,id,action]=post;if(!store.postExists(id))fail('notFound',404);
        if(action==='replies'&&method==='GET')return send(200,{replies:store.listReplies(id,user?.id)});
        if(['POST','PATCH','DELETE'].includes(method)){
          if(!user)fail('loginRequired',401);throttle(`write:${user.id}`,20);
          if(!action&&method==='DELETE'){if(!store.deletePost(user.id,id))fail('forbidden',403);return send(200,{ok:true});}
          if(!action&&method==='PATCH'){const p=await jsonBody(req);const previous=store.listPosts(user.id).find(p=>p.id===id);if(!previous?.owned)fail('forbidden',403);contexts.set(previous.route,{id:previous.route});if(!store.editPost(user.id,id,validatePost(p)))fail('forbidden',403);return send(200,{ok:true});}
          if(method==='POST'){
            if(action==='like'){store.toggleLike(user.id,id);return send(200,{ok:true});}
            if(action==='block'){store.blockPostAuthor(user.id,id);return send(200,{ok:true});}
            const p=await jsonBody(req);
            if(action==='report'){if(typeof p?.reason!=='string'||p.reason.trim().length<2||p.reason.length>500)fail('invalidRequest');return send(201,{id:store.report(user.id,id,p.reason.trim())});}
            if(action==='replies'){if(typeof p?.body!=='string'||p.body.trim().length<2||p.body.trim().length>1000)fail('commentValidation');store.reply(user.id,id,p.body.trim());return send(201,{ok:true});}
          }
        }
      }
      const reply=path.match(/^\/api\/replies\/([\w-]+)$/);
      if(reply&&method==='DELETE'){if(!user)fail('loginRequired',401);if(!store.deleteReply(user.id,reply[1]))fail('forbidden',403);return send(200,{ok:true});}
      if(path==='/api/admin/reports'&&method==='GET'){if(!admin(user))fail('forbidden',403);return send(200,{reports:store.listReports()});}
      const report=path.match(/^\/api\/admin\/reports\/([\w-]+)$/);
      if(report&&method==='POST'){if(!admin(user))fail('forbidden',403);const p=await jsonBody(req);if(typeof p?.hide!=='boolean')fail('invalidRequest');if(!store.moderate(report[1],p.hide))fail('notFound',404);return send(200,{ok:true});}
      if(path.startsWith('/api/'))fail('notFound',404);
      if(!['GET','HEAD'].includes(method))fail('methodNotAllowed',405);
      const pathname=path==='/'?'/index.html':path==='/setup'&&config.setupAllowed?'/setup.html':decodeURIComponent(path);
      const file=resolve(root,'public',`.${pathname}`);if(!file.startsWith(join(root,'public')+'/')&&!file.startsWith(join(root,'public')+'\\'))fail('forbidden',403);
      if(!mime[extname(file)])fail('notFound',404);
      const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:data);
    }catch(error){send(error.status||(error.code==='ENOENT'?404:500),{error:error.key||(error.code==='ENOENT'?'notFound':'serverError')});}
  });
  return {server,store,config};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp();app.server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`Jeju Bus ready: ${app.config.origin}`));
  const close=()=>app.server.close(()=>{app.store.close();process.exit(0);});process.on('SIGTERM',close);process.on('SIGINT',close);
}
