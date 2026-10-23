import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createStore } from '../lib/store.mjs';
import { createApp } from '../server.mjs';
import { createGoogleAuth, verifyIdToken } from '../lib/auth.mjs';
import { createTransit } from '../lib/transit.mjs';
import { messages,translate } from '../public/i18n.js';
import { journeys,rankJourneys,matchPlace } from '../public/data.js';

test('all four locales cover every UI key and interpolation',()=>{
  const expected=Object.keys(messages.ko).sort();
  for(const locale of ['ko','en','zh','ja']){
    assert.deepEqual(Object.keys(messages[locale]).sort(),expected);
    for(const text of Object.values(messages[locale]))assert.equal(typeof text,'string');
    assert.ok(translate(locale,'busIn',{n:6}).includes('6'));
    assert.ok(!translate(locale,'toward',{place:'TEST'}).includes('{place}'));
  }
});
test('journey criteria use actual sample metrics and never mutate source',()=>{
  assert.equal(rankJourneys(journeys,'fastest')[0].id,'r01');
  assert.equal(rankJourneys(journeys,'walking')[0].id,'r02');
  assert.equal(rankJourneys(journeys,'transfers')[0].transfers,0);
  assert.deepEqual(journeys.map(r=>r.id),['r01','r02','r03']);
  for(const r of journeys)assert.equal(r.walk+r.wait+r.ride,r.total);
  for(const name of ['제주공항','Jeju Airport','济州机场','済州空港'])assert.equal(matchPlace(name).id,'airport');
  assert.equal(matchPlace('somewhere unknown'),undefined);
});

test('community API enforces sessions, origin, validation and logout',async()=>{
  const store=createStore();
  const app=await createApp({store,env:{APP_ORIGIN:'http://127.0.0.1:3000',SHOW_SAMPLE_POSTS:'true'},fetchImpl:()=>{throw new Error('Unexpected external call');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  const request=(path,{token,origin=base,...options}={})=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Cookie:`jeju_session=${token}`} : {}),...options.headers}});
  try{
    assert.equal((await request('/')).status,200);
    assert.equal((await request('/.env')).status,404);
    const invalidHost=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(invalidHost,403);
    const status=await (await request('/api/status')).json();
    assert.equal(status.googleConfigured,false);assert.equal(status.mapMode,'openstreetmap');assert.equal(status.journeyMode,'unavailable');assert.equal(status.user,null);
    const posts=await (await request('/api/posts')).json();assert.equal(posts.posts.length,4);
    assert.equal('user_id' in posts.posts[0],false);
    assert.equal((await request('/api/posts',{method:'POST',body:'{}'})).status,401);
    const token=store.createSession('google:test-user','Test rider');
    const payload={title:'Test question',body:'A real local question for the test.',category:'question',route:'r01'};
    assert.equal((await request('/api/posts',{method:'POST',token,origin:'https://evil.example',body:JSON.stringify(payload)})).status,403);
    assert.equal((await request('/api/posts',{method:'POST',token,body:JSON.stringify({...payload,route:'invented'})})).status,400);
    assert.equal((await request('/api/posts',{method:'POST',token,body:JSON.stringify({...payload,title:' '})})).status,400);
    assert.equal((await request('/api/posts',{method:'POST',token,body:'x'.repeat(17000)})).status,413);
    const created=await request('/api/posts',{method:'POST',token,body:JSON.stringify(payload)});assert.equal(created.status,201);
    const {id}=await created.json();
    await request(`/api/posts/${id}/like`,{method:'POST',token,body:'{}'});
    let p=(await (await request('/api/posts',{token})).json()).posts.find(p=>p.id===id);assert.equal(p.likes,1);assert.equal(p.liked,true);
    await request(`/api/posts/${id}/like`,{method:'POST',token,body:'{}'});
    p=(await (await request('/api/posts',{token})).json()).posts.find(p=>p.id===id);assert.equal(p.likes,0);
    assert.equal((await request(`/api/posts/${id}/replies`,{method:'POST',token,body:JSON.stringify({body:' '})})).status,400);
    assert.equal((await request(`/api/posts/${id}/replies`,{method:'POST',token,body:JSON.stringify({body:'Helpful response'})})).status,201);
    const replies=await (await request(`/api/posts/${id}/replies`)).json();assert.equal(replies.replies[0].body,'Helpful response');
    assert.equal((await request('/api/posts/missing/replies')).status,404);
    const logout=await request('/api/logout',{method:'POST',token,body:'{}'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/HttpOnly.*SameSite=Lax/);
    assert.equal((await request('/api/posts',{method:'POST',token,body:JSON.stringify(payload)})).status,401);
    const callback=await request('/auth/google/callback?state=bad&code=bad',{redirect:'manual'});assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),'/?auth=failed');
  }finally{await new Promise(resolve=>app.server.close(resolve));store.close();}
});

test('posts and hashed sessions survive a database reopen',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'jejubus-test-'));
  try{
    const path=join(folder,'test.sqlite');let store=createStore(path);
    const token=store.createSession('google:persistent','Persistent rider');
    const id=store.createPost('google:persistent',{title:'Persistent post',body:'Persisted body',route:'r02',category:'tip'});
    assert.equal(store.db.prepare('SELECT token_hash FROM sessions').get().token_hash.includes(token),false);
    store.close();store=createStore(path);
    assert.equal(store.user(token).name,'Persistent rider');assert.ok(store.listPosts('google:persistent').some(p=>p.id===id));store.close();
  }finally{await rm(folder,{recursive:true,force:true});}
});

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
function jwt(claims,header={alg:'RS256',kid:'fixture-key'}){
  const body=[header,claims].map(p=>Buffer.from(JSON.stringify(p)).toString('base64url')).join('.');
  return `${body}.${sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url')}`;
}
const claims=()=>({iss:'https://accounts.google.com',aud:'client-id',sub:'test-subject',name:'Fixture rider',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce:'fixture-nonce'});
test('Google ID tokens reject tampering, wrong audience, expiry and nonce',()=>{
  const options={audience:'client-id',nonce:'fixture-nonce'};
  assert.equal(verifyIdToken(jwt(claims()),[jwk],options).sub,'test-subject');
  for(const patch of [{aud:'wrong'},{iss:'https://evil.example'},{exp:1},{nonce:'wrong'},{iat:Date.now()/1000+500},{aud:['client-id','other'],azp:'other'}])assert.throws(()=>verifyIdToken(jwt({...claims(),...patch}),[jwk],options));
  const valid=jwt(claims());const [h,p,s]=valid.split('.');
  assert.throws(()=>verifyIdToken(`${h}.${Buffer.from(JSON.stringify({...claims(),sub:'attacker'})).toString('base64url')}.${s}`,[jwk],options));
  assert.throws(()=>verifyIdToken(jwt(claims(),{alg:'none',kid:'fixture-key'}),[jwk],options));
});
test('OAuth binds state to browser, uses PKCE and consumes authorization once',async()=>{
  let nonce,calls=0;
  const auth=createGoogleAuth({origin:'http://localhost:3000',googleClientId:'client-id',googleClientSecret:'local-fixture-secret'},{fetchImpl:async url=>{calls++;return {ok:true,json:async()=>String(url).endsWith('/token')?{id_token:jwt({...claims(),nonce})}:{keys:[jwk]}};}});
  const start=auth.start();const url=new URL(start.url);nonce=url.searchParams.get('nonce');const state=url.searchParams.get('state');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));
  await assert.rejects(auth.finish({state,code:'fixture',binding:'different-browser'}));assert.equal(calls,0);
  const identity=await auth.finish({state,code:'fixture',binding:start.binding});assert.equal(identity.id,'google:test-subject');assert.equal(identity.name,'Fixture rider');
  await assert.rejects(auth.finish({state,code:'fixture',binding:start.binding}));assert.equal(calls,2);
});
test('transit stays offline until configured, caches live responses, and never fabricates a fallback',async()=>{
  const offline=createTransit({transitMode:'demo'},{fetchImpl:()=>{throw Error('unexpected network');}});
  assert.equal((await offline.arrivals()).mode,'demo');
  let calls=0;
  const config={transitMode:'tago',tagoKey:'fixture-key',cityCode:'fixture-city',stopId:'fixture-stop'};
  const live=createTransit(config,{fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:{routeno:'TEST',nodenm:'Fixture stop',arrtime:120,arrprevstationcnt:2}}}}})};}});
  assert.equal((await live.arrivals()).arrivals[0].seconds,120);await live.arrivals();assert.equal(calls,1);
  const failed=createTransit(config,{fetchImpl:async()=>({ok:false})});await assert.rejects(failed.arrivals());
  const invalid=createTransit(config,{fetchImpl:async()=>({ok:true,json:async()=>({response:{header:{resultCode:'30'}}})})});await assert.rejects(invalid.arrivals());
});
