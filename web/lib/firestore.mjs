import {readFile} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,sign} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const hash=value=>createHash('sha256').update(value).digest('hex');
const failure=(key='storageUnavailable',status=503)=>Object.assign(Error(key),{key,status});
const encode=value=>value===null?{nullValue:null}:typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{integerValue:String(value)}:typeof value==='string'?{stringValue:value}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
const decode=value=>'nullValue'in value?null:'booleanValue'in value?value.booleanValue:'integerValue'in value?Number(value.integerValue):'doubleValue'in value?value.doubleValue:'stringValue'in value?value.stringValue:'arrayValue'in value?(value.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(value.mapValue?.fields||{}).map(([k,v])=>[k,decode(v)]));

// Construction is offline. Authentication and database requests start only on use.
export async function createFirestoreClient(env,{fetchImpl=fetch,now=Date.now}={}){
  if(env.FIREBASE_BILLING_APPROVED!=='true')throw failure('databaseApprovalRequired');
  const project=env.FIREBASE_PROJECT_ID,namespace=env.FIREBASE_NAMESPACE||'jejubus';
  if(!/^[a-z][a-z0-9-]{4,61}$/.test(project||'')||!/^\w{1,40}$/.test(namespace))throw failure('databaseConfiguration');
  let credentials;try{credentials=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||await readFile(env.FIREBASE_SERVICE_ACCOUNT_PATH,'utf8'));}catch{throw failure('databaseConfiguration');}
  if(credentials.project_id!==project||!credentials.client_email||!credentials.private_key)throw failure('databaseConfiguration');
  const database=`projects/${project}/databases/(default)`,base=`https://firestore.googleapis.com/v1/${database}/documents`;
  let cachedToken,tokenPending;
  async function accessToken(){
    if(cachedToken?.expires>now()+60000)return cachedToken.value;
    if(tokenPending)return tokenPending;
    tokenPending=(async()=>{
      const iat=Math.floor(now()/1000),payload=[{alg:'RS256',typ:'JWT'},{iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
      const assertion=`${payload}.${sign('RSA-SHA256',Buffer.from(payload),credentials.private_key).toString('base64url')}`;
      const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
      if(!response.ok)throw failure();const result=await response.json();if(!result.access_token)throw failure();
      cachedToken={value:result.access_token,expires:now()+Number(result.expires_in||3600)*1000};return cachedToken.value;
    })();try{return await tokenPending;}finally{tokenPending=null;}
  }
  async function request(suffix,body){
    const response=await fetchImpl(base+suffix,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${await accessToken()}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===404&&body===undefined)return null;
    if(!response.ok){const error=failure();error.retryable=[409,412].includes(response.status);try{error.providerCode=(await response.json()).error?.status;}catch{}if(suffix===':commit'&&error.providerCode==='FAILED_PRECONDITION')error.retryable=true;throw error;}return response.json();
  }
  const collection=name=>`${namespace}_${name}`;
  const path=(name,id)=>`${collection(name)}/${hash(String(id))}`;
  const unpack=doc=>doc?{path:doc.name.slice(doc.name.indexOf('/documents/')+11),data:Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)])),version:doc.updateTime}:null;
  const client={
    async get(name,id){return unpack(await request('/'+path(name,id)));},
    async getMany(name,ids){const rows=await request(':batchGet',{documents:ids.map(id=>`${database}/documents/${path(name,id)}`)});const byPath=new Map(rows.filter(x=>x.found).map(x=>[x.found.name,unpack(x.found)]));return ids.map(id=>byPath.get(`${database}/documents/${path(name,id)}`)||null);},
    async list(name,{field,value,order,limit=100}={}){const query={from:[{collectionId:collection(name)}],limit};if(field)query.where={fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:encode(value)}};if(order)query.orderBy=[{field:{fieldPath:order},direction:'DESCENDING'}];return (await request(':runQuery',{structuredQuery:query})).filter(x=>x.document).map(x=>unpack(x.document).data);},
    async commit(writes){if(!writes.length)return;await request(':commit',{writes:writes.map(w=>w.remove?{delete:`${database}/documents/${path(w.collection,w.id)}`,currentDocument:w.prior?{updateTime:w.prior.version}:{exists:false}}:{update:{name:`${database}/documents/${path(w.collection,w.id)}`,fields:Object.fromEntries(Object.entries(w.data).map(([k,v])=>[k,encode(v)]))},currentDocument:w.prior?{updateTime:w.prior.version}:{exists:false}})});},
    async atomic(run){for(let attempt=0;attempt<5;attempt++){try{return await run();}catch(error){if(!error.retryable||attempt===4)throw error;await delay(50*2**attempt+Math.floor(Math.random()*50));}}}
  };return client;
}

// Every collection is isolated from the existing app by the jejubus namespace.
export function createFirestoreStore(client,{now=Date.now}={}){
  const contextCache=new Map();
  const get=async(c,id)=>(await client.get(c,id))?.data;
  const write=(collection,id,data,prior)=>({collection,id,data,prior});
  async function put(c,id,data){return client.atomic(async()=>{const prior=await client.get(c,id);await client.commit([write(c,id,data,prior)]);});}
  async function changePost(uid,id,update){return client.atomic(async()=>{const prior=await client.get('posts',id);if(!prior||prior.data.user_id!==uid||prior.data.status!=='published')return false;await client.commit([write('posts',id,{...prior.data,...update},prior)]);return true;});}
  async function blocked(uid){return new Set(uid?(await client.list('blocks',{field:'user_id',value:uid,limit:500})).map(b=>b.blocked_id):[]);}
  return {
    async user(token){if(!token)return null;const s=await get('sessions',hash(token));return s&&s.expires>now()?{id:s.user_id,name:s.name}:null;},
    async createSession(id,name){name=String(name).slice(0,80);await put('users',id,{id,name});const token=randomBytes(32).toString('base64url');await put('sessions',hash(token),{user_id:id,name,expires:now()+7*86400000});return token;},
    async destroySession(token){if(!token)return;await client.atomic(async()=>{const prior=await client.get('sessions',hash(token));if(prior)await client.commit([{collection:'sessions',id:hash(token),remove:true,prior}]);});},
    seedSamples(){throw failure('productionSamplesDisabled');},
    async rememberContext(c){const prior=await client.get('contexts',c.id);if(prior?.data.name===c.name&&prior?.data.type===c.type)return;await put('contexts',c.id,c);},
    async rememberContexts(items){const unique=[...new Map(items.map(c=>[c.id,c])).values()],changed=unique.filter(c=>JSON.stringify(contextCache.get(c.id))!==JSON.stringify(c));if(!changed.length)return;await client.atomic(async()=>{const priors=await client.getMany('contexts',changed.map(c=>c.id));const writes=changed.flatMap((c,i)=>JSON.stringify(priors[i]?.data)===JSON.stringify(c)?[]:[write('contexts',c.id,c,priors[i])]);await client.commit(writes);});for(const c of changed)contextCache.set(c.id,c);if(contextCache.size>3000)contextCache.clear();},
    context:id=>get('contexts',id),
    putOAuth:(state,data)=>put('oauth',state,data),
    async takeOAuth(state,binding){if(!state||!binding)return null;return client.atomic(async()=>{const prior=await client.get('oauth',state);if(!prior||prior.data.expires<now()||prior.data.binding!==binding)return null;await client.commit([{collection:'oauth',id:state,remove:true,prior}]);return prior.data;});},
    async listPosts(uid){const [posts,excluded]=await Promise.all([client.list('posts',{order:'created',limit:100}),blocked(uid)]);return Promise.all(posts.filter(p=>p.status==='published'&&!excluded.has(p.user_id)).map(async({user_id,status,...p})=>({...p,owned:user_id===uid,sample:false,liked:uid?!!await get('likes',`${p.id}:${uid}`):false})));},
    async postExists(id){return (await get('posts',id))?.status==='published';},
    async ownsPost(uid,id){const p=await get('posts',id);return p?.user_id===uid&&p.status==='published';},
    async createPost(uid,p){return client.atomic(async()=>{
      const key=p.requestId?`${uid}:${p.requestId}`:null,prior=key?await client.get('requests',key):null;if(prior)return prior.data.post_id;
      const author=await get('users',uid);if(!author)throw failure('loginRequired',401);const id=randomUUID();
      const data={id,user_id:uid,author:author.name,category:p.category,route:p.route,title:p.title,body:p.body,created:now(),likes:0,replies:0,status:'published'};
      await client.commit([write('posts',id,data,null),...(key?[write('requests',key,{post_id:id},null)]:[])]);return id;
    });},
    async listReplies(id,uid){const [replies,excluded]=await Promise.all([client.list('replies',{field:'post_id',value:id,limit:200}),blocked(uid)]);return replies.filter(r=>r.status==='published'&&!excluded.has(r.user_id)).sort((a,b)=>a.created-b.created).map(({user_id,post_id,status,...r})=>({...r,owned:user_id===uid}));},
    async reply(uid,id,body){return client.atomic(async()=>{const post=await client.get('posts',id),author=await get('users',uid);if(!post||post.data.status!=='published')throw failure('notFound',404);const replyId=randomUUID();await client.commit([write('replies',replyId,{id:replyId,post_id:id,user_id:uid,author:author.name,body,created:now(),status:'published'},null),write('posts',id,{...post.data,replies:post.data.replies+1},post)]);});},
    editPost:(uid,id,p)=>changePost(uid,id,{title:p.title,body:p.body,category:p.category,route:p.route}),
    deletePost:(uid,id)=>changePost(uid,id,{status:'deleted'}),
    async deleteReply(uid,id){return client.atomic(async()=>{const r=await client.get('replies',id);if(!r||r.data.user_id!==uid||r.data.status!=='published')return false;const p=await client.get('posts',r.data.post_id);await client.commit([write('replies',id,{...r.data,status:'deleted'},r),...(p?[write('posts',r.data.post_id,{...p.data,replies:Math.max(0,p.data.replies-1)},p)]:[])]);return true;});},
    async toggleLike(uid,id){return client.atomic(async()=>{const [p,l]=await Promise.all([client.get('posts',id),client.get('likes',`${id}:${uid}`)]);if(!p||p.data.status!=='published')throw failure('notFound',404);await client.commit([write('posts',id,{...p.data,likes:Math.max(0,p.data.likes+(l?-1:1))},p),l?{collection:'likes',id:`${id}:${uid}`,remove:true,prior:l}:write('likes',`${id}:${uid}`,{post_id:id,user_id:uid},null)]);});},
    async report(uid,id,reason){const key=hash(`${id}:${uid}`);return client.atomic(async()=>{const prior=await client.get('reports',key);if(prior?.data.status==='open')return key;const post=await get('posts',id);await client.commit([write('reports',key,{id:key,postId:id,reason,status:'open',created:now(),title:post.title},prior)]);return key;});},
    async blockPostAuthor(uid,id){const p=await get('posts',id);if(p&&p.user_id!==uid)await put('blocks',`${uid}:${p.user_id}`,{user_id:uid,blocked_id:p.user_id});},
    listReports:()=>client.list('reports',{order:'created',limit:200}),
    async moderate(reportId,hide){return client.atomic(async()=>{const r=await client.get('reports',reportId);if(!r)return false;const p=hide?await client.get('posts',r.data.postId):null;await client.commit([write('reports',reportId,{...r.data,status:'resolved'},r),...(p?[write('posts',r.data.postId,{...p.data,status:'hidden'},p)]:[])]);return true;});},
    async consumeApi(provider,limit){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now())),id=`${provider}:${day}`;return client.atomic(async()=>{const prior=await client.get('usage',id),count=prior?.data.count||0;if(count>=limit)throw failure('quotaReached',429);await client.commit([write('usage',id,{provider,day,count:count+1},prior)]);});},
    usage:()=>client.list('usage',{order:'day',limit:20}),
    close(){}
  };
}
