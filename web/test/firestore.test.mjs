import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createFirestoreClient,createFirestoreStore} from '../lib/firestore.mjs';
import {createGoogleAuth} from '../lib/auth.mjs';
import {createCatalog} from '../lib/catalog.mjs';

function memoryClient(){
  const docs=new Map();let version=0;
  const key=(c,id)=>`${c}/${id}`,copy=x=>x?structuredClone(x):null;
  const get=async(c,id)=>copy(docs.get(key(c,id)));
  const client={get,getMany:(c,ids)=>Promise.all(ids.map(id=>get(c,id))),
    async list(c,{field,value,order,limit=100}={}){return [...docs].filter(([k,d])=>k.startsWith(c+'/')&&(!field||d.data[field]===value)).map(([,d])=>copy(d.data)).sort((a,b)=>order?(a[order]<b[order]?1:a[order]>b[order]?-1:0):0).slice(0,limit);},
    async commit(writes){for(const w of writes){const existing=docs.get(key(w.collection,w.id));if(existing?.version!==w.prior?.version)throw Object.assign(Error('conflict'),{retryable:true});}for(const w of writes){const k=key(w.collection,w.id);if(w.remove)docs.delete(k);else docs.set(k,{data:copy(w.data),version:String(++version)});}},
    async atomic(run){for(let i=0;i<10;i++)try{return await run();}catch(e){if(!e.retryable||i===9)throw e;}}
  };return client;
}

test('Firestore adapter shares sessions, posts, counters, moderation and OAuth across instances',async()=>{
  const client=memoryClient(),a=createFirestoreStore(client),b=createFirestoreStore(client);
  const token=await a.createSession('google:author','Author');assert.equal((await b.user(token)).name,'Author');
  await a.rememberContexts([{id:'route:201',name:'201',type:'route'}]);assert.equal((await b.context('route:201')).name,'201');
  const p={title:'Question',body:'Real question',route:'route:201',category:'question',requestId:'unique-request'};
  const ids=await Promise.all([a.createPost('google:author',p),b.createPost('google:author',p)]);assert.equal(ids[0],ids[1]);const id=ids[0];
  await b.createSession('google:reader','Reader');await a.toggleLike('google:reader',id);assert.equal((await b.listPosts('google:reader'))[0].liked,true);
  await b.toggleLike('google:reader',id);assert.equal((await a.listPosts())[0].likes,0);
  await a.reply('google:reader',id,'Helpful reply');const r=(await b.listReplies(id,'google:reader'))[0];assert.equal(r.owned,true);
  assert.equal(await a.deleteReply('google:author',r.id),false);assert.equal(await b.deleteReply('google:reader',r.id),true);assert.equal((await a.listPosts())[0].replies,0);
  assert.equal(await b.editPost('google:reader',id,p),false);
  await b.blockPostAuthor('google:reader',id);assert.equal((await b.listPosts('google:reader')).length,0);
  const report=await b.report('google:reader',id,'Problem');assert.equal(await b.report('google:reader',id,'Again'),report);assert.match(report,/^[\w-]+$/);
  assert.equal(await a.moderate(report,true),true);assert.equal(await b.postExists(id),false);
  await a.putOAuth('one-time-state',{binding:'browser',nonce:'nonce',verifier:'pkce',expires:Date.now()+60000});
  assert.equal(await b.takeOAuth('one-time-state','wrong-browser'),null);
  const consumed=await Promise.all([a.takeOAuth('one-time-state','browser'),b.takeOAuth('one-time-state','browser')]);assert.equal(consumed.filter(Boolean).length,1);
  await a.destroySession(token);assert.equal(await b.user(token),null);
});

test('shared quota is atomic and awaited before a provider network request',async()=>{
  const client=memoryClient(),a=createFirestoreStore(client),b=createFirestoreStore(client);
  const results=await Promise.allSettled(Array.from({length:5},(_,i)=>(i%2?a:b).consumeApi('tago',3)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,3);assert.equal((await a.usage())[0].count,3);
  let calls=0;const catalog=createCatalog({tagoKey:'fixture',cityCode:'39',tagoDailyLimit:3},{consume:a.consumeApi,fetchImpl:()=>{calls++;throw Error('unexpected');}});
  await assert.rejects(catalog.cities(),e=>e.key==='quotaReached');assert.equal(calls,0);
});

test('AI approval cap is shared across instances and does not reset at the next midnight',async()=>{
 const client=memoryClient(),dayOne=Date.UTC(2026,9,24),a=createFirestoreStore(client,{now:()=>dayOne}),b=createFirestoreStore(client,{now:()=>dayOne+86400000});
 const results=await Promise.allSettled([a.consumeApi('ai_budget',2,'approval:fixed'),b.consumeApi('ai_budget',2,'approval:fixed'),a.consumeApi('ai_budget',2,'approval:fixed')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 await assert.rejects(b.consumeApi('ai_budget',2,'approval:fixed'),{key:'quotaReached'});
 await b.consumeApi('ai_budget',2,'approval:new');
 assert.equal((await a.usage()).find(r=>r.day==='approval:fixed').count,2);
});

test('serverless OAuth persists state before redirect and consumes it through another instance',async()=>{
  const client=memoryClient(),stateA=createFirestoreStore(client),stateB=createFirestoreStore(client),config={origin:'https://jejubus.example',googleClientId:'fixture',googleClientSecret:'fixture-secret'};
  const a=createGoogleAuth(config,{stateStore:stateA}),b=createGoogleAuth(config,{stateStore:stateB,fetchImpl:async()=>{throw Error('token endpoint intentionally unavailable');}});
  const start=await a.start(),state=new URL(start.url).searchParams.get('state');
  await assert.rejects(b.finish({state,code:'code',binding:'wrong'}));assert.ok(await client.get('oauth',state));
  await assert.rejects(b.finish({state,code:'code',binding:start.binding}),/token endpoint/);assert.equal(await client.get('oauth',state),null);
});

test('Firestore REST stays offline without approval and uses namespace and conditional commits',async()=>{
  let calls=0;await assert.rejects(createFirestoreClient({},{fetchImpl:()=>{calls++;}}),e=>e.key==='databaseApprovalRequired');assert.equal(calls,0);
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const credential={project_id:'fixture-project',client_email:'fixture@fixture-project.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const requests=[],client=await createFirestoreClient({FIREBASE_BILLING_APPROVED:'true',FIREBASE_PROJECT_ID:'fixture-project',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential)},{fetchImpl:async(url,options)=>{requests.push({url,options});if(String(url).includes('oauth2.'))return {ok:true,json:async()=>({access_token:'fixture-token',expires_in:3600})};return {ok:true,json:async()=>({})};}});
  assert.equal(requests.length,0);await client.commit([{collection:'posts',id:'post',data:{title:'제주',likes:0,status:'published'},prior:null}]);
  const commit=JSON.parse(requests[1].options.body);assert.match(commit.writes[0].update.name,/\/jejubus_posts\/[a-f0-9]{64}$/);assert.deepEqual(commit.writes[0].currentDocument,{exists:false});assert.deepEqual(commit.writes[0].update.fields.likes,{integerValue:'0'});assert.equal(requests[1].options.headers.Authorization,'Bearer fixture-token');
});
