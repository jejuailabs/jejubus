// 상황별 기능 테스트(23회차): 정상·경계·틀림·권한·탈퇴·외부 연동 꺼짐.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createFirestoreStore} from '../lib/firestore.mjs';
import {createApp} from '../server.mjs';
import {createMemberService,WITHDRAWN_NAME} from '../lib/member.mjs';
import {createKakaoAlert} from '../lib/kakao-alert.mjs';
import {createBlog} from '../lib/blog.mjs';
import {createRouteAdmin} from '../lib/route-admin.mjs';
import {createSocialAuth} from '../lib/social-auth.mjs';
import {configuration} from '../lib/settings.mjs';

const config={adminSubjects:['owner'],adminEmails:[]};
const owner={id:'google:owner',name:'운영자'},a={id:'google:a',name:'회원A'},b={id:'google:b',name:'회원B'};
const route='route:JEB405320111',body={context:route,contextName:'201',rating:5,text:'배차가 잘 맞아요'};

function memoryClient(){
 const docs=new Map();let version=0;const key=(c,id)=>`${c}/${id}`,copy=x=>x?structuredClone(x):null,get=async(c,id)=>copy(docs.get(key(c,id)));
 return {get,getMany:(c,ids)=>Promise.all(ids.map(id=>get(c,id))),
  async list(c,{field,value,limit=100}={}){return [...docs].filter(([k,d])=>k.startsWith(c+'/')&&(!field||d.data[field]===value)).map(([,d])=>copy(d.data)).slice(0,limit);},
  async commit(writes){for(const w of writes){const k=key(w.collection,w.id);if(w.remove)docs.delete(k);else docs.set(k,{data:copy(w.data),version:String(++version)});}},
  async atomic(run){return run();}};
}
const stores={sqlite:()=>{const s=createStore(':memory:',{seed:false});return s;},firestore:()=>createFirestoreStore(memoryClient())};

for(const [name,make]of Object.entries(stores)){
 test(`${name}: 후기는 서버가 작성자를 정하고 회원당 하나, 평균을 계산한다`,async()=>{
  const store=make(),m=createMemberService(config,store);await store.createSession(a.id,a.name);await store.createSession(b.id,b.name);
  await m.saveReview(a,{...body,nickname:'가짜닉네임',user_id:'google:owner'});await m.saveReview(a,{...body,rating:4});await m.saveReview(b,{...body,rating:1});
  const list=await m.reviews(route,a.id);assert.equal(list.summary.count,2);assert.equal(list.summary.average,2.5);
  assert.ok(list.reviews.every(r=>!('user_id'in r)&&r.nickname!=='가짜닉네임'));assert.equal(list.reviews.filter(r=>r.owned).length,1);
 });
 test(`${name}: 같은 번호의 변형 후기는 합치고 회원당 최신 하나만 센다`,async()=>{
  const store=make(),m=createMemberService(config,store);await store.createSession(a.id,a.name);await store.createSession(b.id,b.name);
  await m.saveReview(a,{...body,context:'route:v1',rating:1});await m.saveReview(b,{...body,context:'route:v2',rating:5});
  const merged=await m.reviews('route:v1',null,['route:v1','route:v2']);assert.equal(merged.summary.count,2);assert.equal(merged.summary.average,3);
  await new Promise(r=>setTimeout(r,2));await m.saveReview(a,{...body,context:'route:v2',rating:3});
  assert.equal((await m.reviews('route:v1',null,['route:v2'])).summary.count,2);
  assert.equal((await m.reviews('route:v1')).summary.count,1);
 });
 test(`${name}: 후기 입력 경계와 다른 회원의 수정·삭제를 막는다`,async()=>{
  const store=make(),m=createMemberService(config,store);
  await assert.rejects(m.saveReview(a,{...body,rating:0}),{key:'reviewRating'});await assert.rejects(m.saveReview(a,{...body,rating:6}),{key:'reviewRating'});await assert.rejects(m.saveReview(a,{...body,rating:4.5}),{key:'reviewRating'});
  await assert.rejects(m.saveReview(a,{...body,text:'네글자임'}),{key:'reviewText'});await assert.rejects(m.saveReview(a,{...body,text:'가'.repeat(201)}),{key:'reviewText'});await assert.rejects(m.saveReview(a,{...body,context:'admin:x'}),{key:'invalidRequest'});
  await m.saveReview(a,{...body,text:'가'.repeat(200)});await m.saveReview(a,{...body,text:'다섯글자다'});
  const [{id}]=(await m.reviews(route)).reviews;
  await assert.rejects(m.updateReview(b,id,{rating:1,text:'남의 후기 수정'}),{key:'forbidden'});await assert.rejects(m.deleteReview(b,id),{key:'forbidden'});
  await m.updateReview(a,id,{rating:3,text:'내 후기 수정함'});assert.equal((await m.reviews(route)).reviews[0].rating,3);
  await m.deleteReview(a,id);assert.equal((await m.reviews(route)).summary.count,0);
 });
 test(`${name}: 관리자가 숨긴 후기는 사라지고 작성자가 되살릴 수 없다`,async()=>{
  const store=make(),m=createMemberService(config,store);await m.saveReview(a,body);const [{id}]=(await m.reviews(route)).reviews;
  await assert.rejects(m.setReviewHidden(a,id,true),{key:'forbidden'});await assert.rejects(m.adminReviews(a),{key:'forbidden'});
  await m.setReviewHidden(owner,id,true);assert.equal((await m.reviews(route)).summary.count,0);
  await assert.rejects(m.saveReview(a,body),{key:'reviewHidden'});await assert.rejects(m.updateReview(a,id,{rating:5,text:'다시 공개 시도'}),{key:'reviewHidden'});
  await m.setReviewHidden(owner,id,false);assert.equal((await m.reviews(route)).summary.count,1);
 });
 test(`${name}: 문의는 중복 접수되지 않고 답변이 본인에게만 보인다`,async()=>{
  const sent=[],store=make(),m=createMemberService(config,store,{notify:async text=>sent.push(text)});await store.createSession(a.id,a.name);await store.createSession(b.id,b.name);
  const question='010-1234-5678 번호로 연락 주세요',one=await m.createInquiry(a,{requestId:'request-0001',question}),two=await m.createInquiry(a,{requestId:'request-0001',question});
  assert.equal(one.id,two.id);assert.match(one.id,/^Q[0-9A-F]{8}$/);assert.equal(sent.length,1);assert.ok(!sent[0].includes('010')&&!sent[0].includes(a.name));
  await assert.rejects(m.createInquiry(a,{requestId:'request-0002',question:'짧음'}),{key:'inquiryText'});await assert.rejects(m.createInquiry(a,{requestId:'x',question}),{key:'invalidRequest'});
  await assert.rejects(m.answerInquiry(a,one.id,{answer:'내가 답변'}),{key:'forbidden'});await assert.rejects(m.answerInquiry(owner,'../x',{answer:'답변입니다'}),{key:'invalidRequest'});
  const admin=await m.adminInquiries(owner);assert.equal(admin.open,1);assert.ok(!('user_id'in admin.inquiries[0]));
  await m.answerInquiry(owner,one.id,{answer:'확인했습니다'});
  assert.equal((await m.me(a)).inquiries[0].status,'answered');assert.equal((await m.me(b)).inquiries.length,0);assert.equal((await m.adminInquiries(owner)).open,0);
 });
 test(`${name}: 찜은 회원별로 저장되고 마이페이지는 자기 기록만 준다`,async()=>{
  const store=make(),m=createMemberService(config,store);await store.createSession(a.id,a.name);await store.createSession(b.id,b.name);
  const item={id:'JEB1',number:'201',start:'제주시',end:'서귀포'};
  assert.equal((await m.toggleSaved(a,{item})).saved,true);assert.equal((await m.toggleSaved(a,{item,saved:true})).saved,true);assert.equal((await m.saved(a)).saved.length,1);assert.equal((await m.saved(b)).saved.length,0);
  await m.saveReview(a,body);const mine=await m.me(a),other=await m.me(b);assert.equal(mine.reviews.length,1);assert.equal(other.reviews.length,0);assert.equal(mine.profile.visits,1);
  assert.ok(!JSON.stringify(mine).includes('google:a'));assert.equal((await m.toggleSaved(a,{item})).saved,false);assert.equal((await m.toggleSaved(a,{item,saved:false})).saved,false);
  await assert.rejects(m.toggleSaved(a,{item:{id:'<x>',number:'1'}}),{key:'invalidRequest'});
 });
 test(`${name}: 탈퇴하면 세션·찜·문의가 없어지고 후기는 익명이 되며 다시 가입할 수 있다`,async()=>{
  const store=make(),m=createMemberService(config,store),token=await store.createSession(a.id,a.name,{email:'a@example.com'});
  await m.saveReview(a,body);await m.toggleSaved(a,{item:{id:'JEB1',number:'201'}});await m.createInquiry(a,{requestId:'request-0003',question:'문의 내용입니다'});
  await assert.rejects(m.withdraw(a,{}),{key:'invalidRequest'});await assert.rejects(m.withdraw({...owner},{confirm:true}),{key:'protectedAccount'});
  await m.withdraw(a,{confirm:true});assert.equal(await store.user(token),null);assert.equal((await store.recordList('saved')).length,0);assert.equal((await store.recordList('inquiries')).length,0);
  const review=(await m.reviews(route)).reviews[0];assert.equal(review.nickname,WITHDRAWN_NAME);assert.equal((await store.recordList('reviews'))[0].user_id,null);
  const fresh=await store.createSession(a.id,'다시온회원');assert.equal((await store.user(fresh)).name,'다시온회원');
 });
}

test('Firestore 탈퇴는 게시글 작성자 이름 사본도 바꾼다',async()=>{
 const client=memoryClient(),store=createFirestoreStore(client);await store.createSession(a.id,a.name);await store.rememberContext({id:route,name:'201',type:'route'});
 await store.createPost(a.id,{title:'제목입니다',body:'본문입니다',category:'tip',route});await store.withdraw(a.id,WITHDRAWN_NAME);
 assert.equal((await store.listPosts())[0].author,WITHDRAWN_NAME);
});

async function server(env={},fetchImpl=()=>{throw Error('외부 호출 금지');}){
 const store=createStore(':memory:',{seed:false}),app=await createApp({store,env:{APP_ORIGIN:'http://127.0.0.1:3000',ADMIN_GOOGLE_SUBS:'owner',...env},fetchImpl});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
 const call=(path,{token,...o}={})=>fetch(base+path,{redirect:'manual',...o,headers:{'Content-Type':'application/json',Origin:base,...(token?{Cookie:`jeju_session=${token}`}:{}),...o.headers}});
 return {app,store,base,call,close:()=>new Promise(r=>app.server.close(()=>{store.close();r();}))};
}
const json=body=>({method:'POST',body:JSON.stringify(body)});

test('API: 로그아웃 상태에서는 쓰기와 내 기록이 막히고, 일반 회원은 관리 API를 쓸 수 없다',async()=>{
 const s=await server();try{
  const token=s.store.createSession(a.id,a.name);
  for(const [path,options]of [['/api/reviews',json(body)],['/api/inquiries',json({requestId:'request-0001',question:'문의 내용입니다'})],['/api/me',{}],['/api/me/saved',{}],['/api/me/withdraw',json({confirm:true})]])assert.equal((await s.call(path,options)).status,401,path);
  for(const path of ['/api/admin/reviews','/api/admin/inquiries'])assert.equal((await s.call(path,{token})).status,403,path);
  assert.equal((await s.call('/api/admin/inquiries/Q12345678',{token,...json({answer:'답변입니다'})})).status,403);
  assert.equal((await s.call('/api/reviews',{token,...json(body),headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await s.call('/api/reviews',{token,...json(body)})).status,201);
  const list=await (await s.call(`/api/reviews?context=${encodeURIComponent(route)}`)).json();assert.equal(list.reviews[0].owned,false);assert.equal(list.reviews[0].nickname,a.name);
  assert.equal((await s.call('/my')).status,200);
 }finally{await s.close();}
});

test('API: 키가 없으면 카카오·네이버 로그인과 블로그는 꺼져 있고 외부 호출이 없다',async()=>{
 const s=await server();try{
  const status=await (await s.call('/api/status')).json();assert.deepEqual(status.login,{google:false,kakao:false,naver:false});assert.equal(status.capabilities.blog,false);assert.equal(status.channelId,null);
  assert.equal((await s.call('/auth/kakao')).headers.get('location'),'/?auth=not-configured');
  assert.deepEqual(await (await s.call('/api/blog?q=201')).json(),{enabled:false,posts:[]});
  const token=s.store.createSession(owner.id,owner.name);assert.equal((await s.call('/auth/kakao/alert',{token})).status,403);
 }finally{await s.close();}
});

test('카카오 로그인: 처음은 가입, 다시 오면 방문 횟수 증가, state가 다르면 거절, 토큰은 저장하지 않는다',async()=>{
 const calls=[],fake=async(url,options={})=>{calls.push(String(url));if(String(url).includes('/oauth/token'))return {ok:true,json:async()=>({access_token:'ACCESS'})};return {ok:true,json:async()=>({id:777,kakao_account:{profile:{nickname:'귤나무'},email:'x@example.com'}})};};
 const s=await server({KAKAO_REST_KEY:'REST',KAKAO_CLIENT_SECRET:'SECRET',KAKAO_LOGIN_ENABLED:'true'},fake);try{
  const start=async()=>{const r=await s.call('/auth/kakao'),u=new URL(r.headers.get('location')),binding=r.headers.get('set-cookie').match(/jeju_oauth=([^;]+)/)[1];assert.equal(u.host,'kauth.kakao.com');assert.ok(!u.searchParams.has('scope'));return {state:u.searchParams.get('state'),binding};};
  const finish=(state,binding)=>s.call(`/auth/kakao/callback?state=${state}&code=C`,{headers:{Cookie:`jeju_oauth=${binding}`}});
  let flow=await start();const wrong=await finish('forged',flow.binding);assert.equal(wrong.headers.get('location'),'/?auth=failed');
  flow=await start();let done=await finish(flow.state,flow.binding);assert.equal(done.headers.get('location'),'/?auth=ok');
  const session=done.headers.getSetCookie().find(c=>c.startsWith('jeju_session=')).split(';')[0].slice(13);
  let me=await (await s.call('/api/status',{token:session})).json();assert.equal(me.user.name,'귤나무');assert.equal(me.user.visits,1);assert.equal(me.user.admin,false);
  flow=await start();done=await finish(flow.state,flow.binding);const again=done.headers.getSetCookie().find(c=>c.startsWith('jeju_session=')).split(';')[0].slice(13);me=await (await s.call('/api/status',{token:again})).json();assert.equal(me.user.visits,2);
  assert.ok(!JSON.stringify(s.store.adminUsers()).includes('x@example.com'));assert.ok(!JSON.stringify(s.store.adminUsers()).includes('ACCESS'));
 }finally{await s.close();}
});

test('네이버 로그인 설정과 프로필 해석',async()=>{
 const c=configuration({NAVER_LOGIN_CLIENT_ID:'ID',NAVER_LOGIN_CLIENT_SECRET:'S',NAVER_LOGIN_ENABLED:'true',APP_ORIGIN:'http://localhost:3000'}),auth=createSocialAuth(c,{fetchImpl:async url=>({ok:true,json:async()=>String(url).includes('token')?{access_token:'A'}:{response:{id:'n1',nickname:'별명'}}})});
 assert.equal(auth.enabled('naver'),true);assert.equal(auth.enabled('kakao'),false);assert.equal(auth.enabled('constructor'),false);
 const {url,binding}=await auth.start('naver');const state=new URL(url).searchParams.get('state');
 await assert.rejects(auth.finish('kakao',{state,code:'c',binding}));
 assert.deepEqual(await auth.finish('naver',{state,code:'c',binding}),{id:'naver:n1',name:'별명'});
});

test('카카오톡 알림: 연결 전에는 조용히 건너뛰고, 실패해도 던지지 않으며, 토큰을 암호화해 저장한다',async()=>{
 const store=createStore(':memory:',{seed:false}),c={kakaoAlertEnabled:true,kakaoKey:'K',kakaoClientSecret:'S',origin:'http://localhost:3000'},sent=[];
 const alert=createKakaoAlert(c,store,{fetchImpl:async(url,options)=>{if(String(url).includes('oauth/token')){sent.push(options.body.get('refresh_token'));return {ok:true,json:async()=>({access_token:'A'})};}sent.push(JSON.parse(options.body.get('template_object')).text);return {ok:true,json:async()=>({})};}});
 assert.equal(await alert.send('테스트'),false);await alert.save('REFRESH-TOKEN');assert.ok(!store.recordGet('secrets','kakaoAlert').value.includes('REFRESH'));
 assert.equal(await alert.send('💬 새 문의'),true);assert.deepEqual(sent,['REFRESH-TOKEN','💬 새 문의']);
 const broken=createKakaoAlert(c,store,{fetchImpl:async()=>{throw Error('down');}});assert.equal(await broken.send('x'),false);store.close();
});

test('블로그: 태그를 지우고 60자로 줄이며 위험한 링크를 버리고 6시간 저장한다',async()=>{
 let calls=0,time=0,headers;const blog=createBlog({blogEnabled:true,naverSearchId:'ID',naverSearchSecret:'SECRET'},{now:()=>time,consume:async()=>{},fetchImpl:async(url,options)=>{calls++;headers=options.headers;return {ok:true,json:async()=>({items:[{title:'<b>201번</b> 버스 &amp; 후기',bloggername:'블로거',postdate:'20261101',description:'가'.repeat(80),link:'https://blog.naver.com/a/1'},{title:'위험',link:'javascript:alert(1)'}]})};}});
 const first=await blog.search('201');assert.equal(first.posts.length,1);assert.equal(first.posts[0].title,'201번 버스 & 후기');assert.equal([...first.posts[0].summary].length,61);assert.equal(first.posts[0].date,'2026-11-01');assert.equal(headers['X-NCP-APIGW-API-KEY-ID'],'ID');
 assert.equal((await blog.search('201')).cached,true);assert.equal(calls,1);time=6*3600000+1;await blog.search('201');assert.equal(calls,2);
});

test('결제 샘플: 금액은 서버 기록으로 검증하고, 본인 것만, 한 번만 승인하며 live 키는 쓰지 않는다',async()=>{
 const store=createStore(':memory:',{seed:false}),calls=[],toss={enabled:()=>true,confirm:async p=>{calls.push(p);return {status:'DONE'};}};
 const m=createMemberService(config,store,{toss});await store.createSession(a.id,a.name);await store.createSession(b.id,b.name);
 const {id}=await m.createInquiry(a,{requestId:'request-0009',question:'제주 일주 코스를 상담받고 싶어요'});
 await assert.rejects(m.setPayment(a,id,{action:'request',amount:5000}),{key:'forbidden'});await assert.rejects(m.setPayment(owner,id,{action:'request',amount:99}),{key:'paymentAmount'});await assert.rejects(m.setPayment(owner,id,{action:'confirm'}),{key:'paymentState'});
 await m.setPayment(owner,id,{action:'request',amount:5000});const q=(await m.me(a)).inquiries[0];assert.equal(q.payStatus,'pending');assert.match(q.orderId,/^jb-Q[0-9A-F]{8}-[0-9a-f]{12}$/);
 const body={paymentKey:'pay_key',orderId:q.orderId,amount:'5000'};
 await assert.rejects(m.confirmCard(a,{...body,amount:'100'}),{key:'paymentMismatch'});await assert.rejects(m.confirmCard(b,body),{key:'notFound'});await assert.rejects(m.confirmCard(a,{...body,orderId:'bad'}),{key:'invalidRequest'});assert.equal(calls.length,0);
 await m.confirmCard(a,body);await m.confirmCard(a,body);assert.equal(calls.length,1);assert.equal(calls[0].amount,5000);
 const done=(await m.me(a)).inquiries[0];assert.equal(done.payStatus,'test_paid');assert.ok(!('paymentKey'in done));assert.ok(!('paymentKey'in (await m.adminInquiries(owner)).inquiries[0]));
 await assert.rejects(m.setPayment(owner,id,{action:'cancel'}),{key:'paymentState'});
 const second=await m.createInquiry(a,{requestId:'request-0010',question:'계좌이체로 상담받고 싶어요'});await m.setPayment(owner,second.id,{action:'request',amount:3000});await m.setPayment(owner,second.id,{action:'confirm'});assert.equal((await store.recordGet('inquiries',second.id)).payStatus,'paid');
 const live=configuration({TOSS_CLIENT_KEY:'live_ck_x',TOSS_SECRET_KEY:'live_sk_x'});assert.equal(live.tossClientKey,'');assert.equal(live.tossSecretKey,'');assert.equal(configuration({TOSS_CLIENT_KEY:'test_ck_x',TOSS_SECRET_KEY:'test_sk_x'}).tossSecretKey,'test_sk_x');
 store.close();
});

for(const [name,make]of Object.entries(stores)){
 test(`${name}: 어드민 노선 안내는 기간과 공개 상태를 지키고 대시보드는 집계만 준다`,async()=>{
  let now=Date.parse('2026-11-10T03:00:00Z');const store=make(),admin=createRouteAdmin(config,store,{now:()=>now}),m=createMemberService(config,store);await store.createSession(a.id,a.name);
  const base={context:route,routeName:'201',title:'임시 우회 안내',body:'공사로 일부 정류장을 지나지 않습니다',startsOn:'2026-11-10',endsOn:'2026-11-12',sourceUrl:'https://bus.jeju.go.kr/notice'};
  await assert.rejects(admin.saveNotice(a,base),{key:'forbidden'});await assert.rejects(admin.overview(a),{key:'forbidden'});
  await assert.rejects(admin.saveNotice(owner,{...base,sourceUrl:'javascript:alert(1)'}),{key:'noticeSource'});await assert.rejects(admin.saveNotice(owner,{...base,endsOn:'2026-11-09'}),{key:'noticePeriod'});await assert.rejects(admin.saveNotice(owner,{...base,context:'x'}),{key:'noticeRoute'});await assert.rejects(admin.saveNotice(owner,{...base,title:'가'}),{key:'noticeTitle'});
  const {id}=await admin.saveNotice(owner,base);assert.equal((await admin.notices(route)).notices.length,1);assert.ok(!('author'in(await admin.notices(route)).notices[0]));
  now=Date.parse('2026-11-13T03:00:00Z');assert.equal((await admin.notices(route)).notices.length,0);now=Date.parse('2026-11-11T03:00:00Z');
  await admin.setNotice(owner,id,'hide');assert.equal((await admin.notices(route)).notices.length,0);await admin.setNotice(owner,id,'show');await admin.saveNotice(owner,{...base,id,title:'수정한 안내'});assert.equal((await admin.notices(route)).notices[0].title,'수정한 안내');
  await m.saveReview(a,body);await m.toggleSaved(a,{item:{id:'JEB405320111',number:'201'}});await m.createInquiry(a,{requestId:'request-0020',question:'막차 시간이 궁금합니다',context:route,contextName:'201'});
  const o=await admin.overview(owner);assert.equal(o.counts.members,1);assert.equal(o.counts.openInquiries,1);assert.equal(o.counts.liveNotices,1);const r=o.routes[0];assert.deepEqual([r.name,r.saved,r.reviews,r.inquiries,r.notices,r.average],['201',1,1,1,1,5]);assert.ok(!JSON.stringify(o.routes).includes('google:a'));
  await admin.setNotice(owner,id,'delete');assert.equal((await admin.overview(owner)).notices.length,0);await assert.rejects(admin.setNotice(owner,id,'show'),{key:'notFound'});
 });
}

test('마이페이지에서만 토스 스크립트를 허용한다',async()=>{
 const s=await server();try{assert.ok((await s.call('/my')).headers.get('content-security-policy').includes('js.tosspayments.com'));assert.ok(!(await s.call('/')).headers.get('content-security-policy').includes('tosspayments'));assert.equal((await s.call('/api/me/payments/confirm',json({}))).status,401);assert.equal((await s.call('/api/admin/inquiries/Q12345678/payment',json({action:'cancel'}))).status,403);}finally{await s.close();}
});

test('환경변수 기본값은 모두 꺼짐이고 잘못된 채널 ID는 무시한다',()=>{
 const c=configuration({KAKAO_CHANNEL_ID:'javascript:alert(1)'});assert.equal(c.kakaoChannelId,'');assert.equal(c.kakaoLoginEnabled,false);assert.equal(c.blogEnabled,false);assert.equal(c.kakaoAlertEnabled,false);assert.equal(configuration({KAKAO_CHANNEL_ID:'_AbCdE'}).kakaoChannelId,'_AbCdE');
});
