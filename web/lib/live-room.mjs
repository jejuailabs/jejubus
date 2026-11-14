// 지금 대화: 근처에 접속한 사람들의 익명 대화. 로그인 없이 쓰고 이름은 하루 단위 가명이다.
// 위치는 약 200m 단위로 뭉개서 3분만 두고, 다른 사람에게는 거리 구간만 보여 준다. 대화는 최근 80개만 남긴다.
// 비용을 줄이려고 문서 두 개에 모아 읽는다. 동시에 쓰면 드물게 한 건이 빠질 수 있다.
import {createHash} from 'node:crypto';
import {ServiceError,coordinate,distanceMeters} from './catalog.mjs';

export const ROOM_RADII=[1,3,5,10];
const PRESENCE_MS=180000,KEEP=80,SID=/^[a-f0-9-]{36}$/,GRID=500,KST=9*3600000;
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const FIRST=['귤빛','바람','돌담','유채','오름','파도','동백','노을','한라','올레','쪽빛','억새'],SECOND=['여행자','탐험가','손님','산책자','승객','길동무','나그네','이웃'];
const day=now=>new Date(now+KST).toISOString().slice(0,10);
export function aliasOf(sid,now){const h=createHash('sha256').update(`${sid}|${day(now)}`).digest();return `${FIRST[h[0]%FIRST.length]} ${SECOND[h[1]%SECOND.length]} ${h[2]%90+10}`;}
export const coarse=point=>({lat:Math.round(point.lat*GRID)/GRID,lng:Math.round(point.lng*GRID)/GRID});
export function bandOf(from,to){if(!from||!to)return null;const km=distanceMeters(from,to)/1000;return ROOM_RADII.find(r=>km<=r)??null;}
// 전화번호와 링크는 올리지 못하게 막는다. 개인정보와 광고를 줄이려는 최소 장치다.
const BANNED=/시발|씨발|ㅅㅂ|병신|ㅂㅅ|개새끼|좆|지랄|꺼져|닥쳐|fuck|shit/i;
const blocked=text=>/(?:\d[\s-]?){9,}|https?:\/\/|www\./i.test(text)||BANNED.test(text.replace(/\s/g,''));
const place=body=>coordinate(body?.lat,body?.lng);
// 질문 한 줄: 최근 10분 안의 가장 새로운 질문을 모두에게 보여 준다.
const TOP_MS=600000;
export const isQuestion=text=>/[?？]\s*$|(나요|까요|ㄴ가요|어디|언제|몇\s*번|몇\s*분|있어요|되나요|맞아요)\s*[?？]?\s*$/.test(text);

export function createLiveRoom(store,{consume=async()=>{},ask=null,now=Date.now}={}){
 const load=async id=>(await store.recordGet('live_room',id))||{id,items:id==='presence'?{}:[]};
 const pruned=doc=>{const cut=now()-PRESENCE_MS;return Object.fromEntries(Object.entries(doc.items).filter(([,p])=>p.at>=cut));};
 const check=body=>{if(typeof body?.sid!=='string'||!SID.test(body.sid))fail('invalidRequest');};
 const post=async item=>{const doc=await load('messages');doc.items=[...doc.items,item].slice(-KEEP);await store.recordPut('live_room','messages',doc);return item;};
 return {
  async ping(body){
   check(body);await consume('live_presence',8000);
   const doc=await load('presence'),point=place(body);doc.items=pruned(doc);doc.items[body.sid]={alias:aliasOf(body.sid,now()),...(point?coarse(point):{}),at:now()};await store.recordPut('live_room','presence',doc);
   return {alias:doc.items[body.sid].alias};
  },
  async view({lat,lng,radius}){
   const point=coordinate(lat,lng),limit=ROOM_RADII.includes(radius)&&point?radius:null,[people,messages]=await Promise.all([load('presence'),load('messages')]);
   const inside=item=>{if(!limit)return true;const band=bandOf(point,item.lat?item:null);return band!==null&&band<=limit;};
   const list=Object.values(pruned(people)).filter(inside).map(p=>({alias:p.alias,band:point?bandOf(point,p.lat?p:null):null}));
   return {people:list.sort((a,b)=>(a.band??99)-(b.band??99)).slice(0,50),total:list.length,messages:messages.items.filter(m=>!m.hidden&&(m.bot||inside(m))).slice(-50).map(({id,alias,text,at,bot,lat:mLat,lng:mLng})=>({id,alias,text,at,bot:!!bot,band:point&&mLat?bandOf(point,{lat:mLat,lng:mLng}):null})),botReady:!!ask};
  },
  async top(){const {items}=await load('messages'),cut=now()-TOP_MS,item=[...items].reverse().find(m=>!m.hidden&&!m.bot&&m.at>=cut&&isQuestion(m.text));return {question:item?{id:item.id,alias:item.alias,text:item.text,at:item.at}:null};},
  async say(body,{locale='ko'}={}){
   check(body);const text=typeof body.text==='string'?body.text.trim():'';if(!text||text.length>200)fail('roomTextLength');if(blocked(text))fail('roomBlocked');
   await consume('live_room',1500);
   const point=place(body),at=now(),mine=await post({id:`${at}-${body.sid.slice(0,8)}`,alias:aliasOf(body.sid,at),text,at,...(point?coarse(point):{}),reports:0});
   if(!body.bot)return {message:mine};
   let reply;try{reply=await ask?.(text,locale);}catch{reply=null;}
   // 내 글은 이미 올라갔다. 봇 답 저장이 실패해도 보내기 자체를 실패로 돌리지 않는다(다시 보내면 글이 두 번 올라간다).
   let bot=null;try{bot=await post({id:`${now()}-bot`,alias:'버스봇',text:reply||'지금은 답하지 못해요. 잠시 뒤 다시 물어봐 주세요.',at:now(),bot:true,reports:0});}catch(error){console.warn(JSON.stringify({kind:'roomBotSaveFailed',key:error.key||error.name||'unknown'}));}
   return {message:mine,bot};
  },
  async adminList(){return {messages:(await load('messages')).items.slice(-80).reverse().map(({id,alias,text,at,bot,hidden,reporters})=>({id,alias,text,at,bot:!!bot,hidden:!!hidden,reports:reporters?.length||0}))};},
  async adminHide(id,hide){const doc=await load('messages'),item=doc.items.find(m=>m.id===id);if(!item)fail('notFound',404);item.hidden=!!hide;await store.recordPut('live_room','messages',doc);return {ok:true};},
  async report(body){
   check(body);const doc=await load('messages'),item=doc.items.find(m=>m.id===body.id);if(!item)fail('notFound',404);
   item.reporters=[...new Set([...(item.reporters||[]),body.sid.slice(0,8)])];if(item.reporters.length>=3)item.hidden=true;await store.recordPut('live_room','messages',doc);return {ok:true};
  }
 };
}
// 팀 대항전: 주간 합계만 둔다. 사람별 순위와 위치는 없다. 하루 기여는 기기당 100점까지.
export function createTeams(store,{consume=async()=>{},now=Date.now}={}){
 const TEAMS=['tangerine','sea','oreum'],weekId=()=>{const d=new Date(now()+KST),b=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));b.setUTCDate(b.getUTCDate()-((b.getUTCDay()+6)%7));return b.toISOString().slice(0,10);};
 return {
  async board(){return {week:weekId(),teams:(await store.recordGet('quest_week',weekId()))?.teams||{}};},
  async add(body){
   if(typeof body?.sid!=='string'||!SID.test(body.sid)||!TEAMS.includes(body.team)||!Number.isInteger(body.points)||body.points<1||body.points>100)fail('invalidRequest');
   await consume('quest',3000);const id=weekId(),doc=(await store.recordGet('quest_week',id))||{id,teams:{},gave:{}},key=`${body.sid.slice(0,13)}|${day(now())}`,used=doc.gave[key]||0,points=Math.min(body.points,100-used);if(points<=0)return {teams:doc.teams};
   doc.gave[key]=used+points;doc.teams[body.team]=(doc.teams[body.team]||0)+points;await store.recordPut('quest_week',id,doc);return {teams:doc.teams};
  }
 };
}
// 원탭 평가. 칭찬과 노선 평가의 개수만 남기고 사람을 특정할 값은 받지 않는다.
export const KUDOS={ontime:'route',clean:'route',comfy:'route',crowded:'route',kind:'driver',safe:'driver',waited:'driver'};
export function createKudos(store,{consume=async()=>{}}={}){
 const NUMBER=/^[\w-]{1,12}$/;
 return {
  async add(body){
   if(typeof body?.routeNo!=='string'||!NUMBER.test(body.routeNo)||!Object.hasOwn(KUDOS,body?.type))fail('invalidRequest');
   await consume('kudos',1500);const id=body.routeNo.split('-')[0],doc=(await store.recordGet('kudos',id))||{id,counts:{}};doc.counts[body.type]=(doc.counts[body.type]||0)+1;await store.recordPut('kudos',id,doc);return {counts:doc.counts};
  },
  async get(no){if(typeof no!=='string'||!NUMBER.test(no))fail('invalidRequest');return {counts:(await store.recordGet('kudos',no.split('-')[0]))?.counts||{}};}
 };
}
