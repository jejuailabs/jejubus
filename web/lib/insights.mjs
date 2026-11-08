// 어드민 대시보드 집계. 저장소에서 읽은 값만 쓰고, 셀 수 없는 수치는 counted:false로 남긴다.
import {koreaDay} from './telemetry.mjs';

const DAY=86400000;
const dayAt=day=>Date.parse(`${day}T00:00:00+09:00`);
const shift=(day,n)=>koreaDay(dayAt(day)+n*DAY+DAY/2);
// 한국 시간 기준 그 주의 월요일
export const weekOf=day=>{const w=new Date(`${day}T00:00:00Z`).getUTCDay();return shift(day,-((w+6)%7));};

// 회원 증감: 가입은 created, 탈퇴는 withdrawn(없으면 updated) 시각. 샘플 계정은 뺀다.
export function memberTrend(users,{now=Date.now(),days=14,weeks=8,cap=500}={}){
 const real=users.filter(u=>!String(u.id).startsWith('sample:')),today=koreaDay(now);
 const leftAt=u=>u.status==='withdrawn'?(u.withdrawn||u.updated||null):null;
 const daily=Array.from({length:days},(_,i)=>({day:shift(today,i-days+1),joined:0,left:0}));
 const weekly=Array.from({length:weeks},(_,i)=>({week:shift(weekOf(today),(i-weeks+1)*7),joined:0,left:0}));
 const add=(at,field)=>{if(!at)return;const d=koreaDay(at),row=daily.find(r=>r.day===d),w=weekly.find(r=>r.week===weekOf(d));if(row)row[field]++;if(w)w[field]++;};
 let unknownLeft=0;
 for(const u of real){add(u.created,'joined');if(u.status==='withdrawn'){const at=leftAt(u);if(at)add(at,'left');else unknownLeft++;}}
 const since=n=>dayAt(shift(today,-n+1));
 const count=(field,n)=>real.filter(u=>{const at=field==='joined'?u.created:leftAt(u);return at&&at>=since(n);}).length;
 const providers={};for(const u of real.filter(u=>u.status!=='withdrawn')){const p=String(u.id).split(':')[0];providers[p]=(providers[p]||0)+1;}
 return {today,
  total:real.filter(u=>u.status!=='withdrawn').length,active:real.filter(u=>(u.status||'active')==='active').length,
  suspended:real.filter(u=>u.status==='suspended').length,withdrawn:real.filter(u=>u.status==='withdrawn').length,
  joinedToday:count('joined',1),leftToday:count('left',1),joined7:count('joined',7),left7:count('left',7),joined30:count('joined',30),left30:count('left',30),
  visited7:real.filter(u=>u.lastLogin&&u.lastLogin>=since(7)).length,
  providers,daily,weekly,unknownLeft,truncated:users.length>=cap};
}

// 외부 서비스 쿼터. 서버가 호출할 때마다 세는 것(counted)과 세지 못하는 것(확인 필요)을 나눈다.
export const UNCOUNTED=[
 {id:'firestore',name:'Firestore',tier:'freeThenPaid',note:'noteFirestore'},
 {id:'bis',name:'Jeju BIS',tier:'public',note:'noteBis'},
 {id:'osm',name:'OpenStreetMap tiles',tier:'free',note:'noteOsm'},
 {id:'google-login',name:'Google sign-in',tier:'free',note:'noteLogin'}
];
export function quotaBoard(providers,{config={},usage=[],today}={}){
 const tier={tago:'free',kakao:'free','kakao-routing':'free',odsay:'free',blog:'free',ai:'paid','kakao-driving':config.navigationFreeVerified?'free':'paid'};
 const counted=providers.map(p=>({id:p.id,name:p.name,tier:tier[p.id]||'free',counted:true,configured:p.configured,on:!!(p.available&&p.enabled),count:p.count,limit:p.limit,remaining:p.remaining,ratio:p.limit?Math.min(1,p.count/p.limit):0}));
 const week=usage.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.day)&&r.day<=today&&r.day>=shift(today,-6));
 for(const row of counted)row.week=week.filter(r=>r.provider===row.id).reduce((n,r)=>n+(r.count||0),0);
 const uncounted=UNCOUNTED.filter(u=>u.id!=='firestore'||config.firestore).map(u=>({...u,counted:false,configured:true,on:true,count:null,limit:null,remaining:null}));
 return [...counted,...uncounted];
}

// 챗봇 지표. chat 계측(질문 결과)과 ai 계측(모델 호출·토큰)을 합친다.
// assistant=AI 길찾기 대화, room=실시간 채팅 버스봇. fallback=AI 대신 고정 문구로 답한 경우.
export function chatStats(metrics,{today,days=14,approvalId=''}={}){
 const from=n=>shift(today,-n+1);
 const series=Array.from({length:days},(_,i)=>({day:shift(today,i-days+1),questions:0,answered:0,failed:0,fallback:0,aiCalls:0}));
 const sum=n=>{const start=from(n),out={questions:0,answered:0,failed:0,fallback:0,assistant:0,room:0,aiCalls:0,aiFailures:0,inputTokens:0,outputTokens:0,estimatedMicroUsd:0,durationMs:0,chatDurationMs:0,unreported:0};
  for(const m of metrics){if(!m.day||m.day<start||m.day>today)continue;
   if(m.provider==='chat'){const [channel,outcome]=String(m.period).split(':'),n=m.requests||0;out.questions+=n;out[channel]=(out[channel]||0)+n;if(outcome in out)out[outcome]+=n;out.chatDurationMs+=m.durationMs||0;}
   if(m.provider==='ai'){out.aiCalls+=m.requests||0;out.aiFailures+=m.failures||0;out.inputTokens+=m.inputTokens||0;out.outputTokens+=m.outputTokens||0;out.estimatedMicroUsd+=m.estimatedMicroUsd||0;out.durationMs+=m.durationMs||0;out.unreported+=m.unreported||0;}}
  return {...out,fallbackRate:out.questions?out.fallback/out.questions:0,failureRate:out.questions?out.failed/out.questions:0,
   avgAnswerMs:out.questions?Math.round(out.chatDurationMs/out.questions):0,callsPerQuestion:out.questions?Math.round(out.aiCalls/out.questions*10)/10:0,
   costPerQuestionMicroUsd:out.answered?Math.round(out.estimatedMicroUsd/out.answered):0};};
 for(const m of metrics){const row=series.find(r=>r.day===m.day);if(!row)continue;
  if(m.provider==='chat'){const outcome=String(m.period).split(':')[1];row.questions+=m.requests||0;if(outcome in row)row[outcome]+=m.requests||0;}
  if(m.provider==='ai')row.aiCalls+=m.requests||0;}
 return {today:sum(1),week:sum(7),month:sum(30),series,approvalId};
}
