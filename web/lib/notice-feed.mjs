// 공지 게시판: BIS 공개 공지를 요청이 올 때만 읽어 제목과 원문을 그대로 보여 준다.
// 앱이 내용을 판단하거나 고치지 않는다. 노선 영향은 제목에 적힌 번호만 표시한다.
import {ServiceError} from './catalog.mjs';
import {parseNoticeDetail,parseNoticeList,periodCandidate,routeCandidates} from './notice-watch.mjs';

const BASE='https://bus.jeju.go.kr',TTL=600000,RECENT_DAYS=14,KST=9*3600000;
export function noticeStatus({startsOn,endsOn,postedOn},today){
 if(endsOn)return endsOn<today?'past':startsOn>today?'upcoming':'active';
 const age=(Date.parse(today)-Date.parse(postedOn))/86400000;return age<=RECENT_DAYS?'recent':'past';
}
export function createNoticeFeed({fetchImpl=fetch,now=Date.now,knownNumber=async()=>true}={}){
 let cached=null;const details=new Map();
 const page=async path=>{const response=await fetchImpl(BASE+path,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new ServiceError('providerUnavailable',503);return response.text();};
 return {
  async list(){
   if(cached&&now()-cached.at<TTL)return cached.value;
   try{
    const today=new Date(now()+KST).toISOString().slice(0,10),rows=parseNoticeList(await page('/notice/list'));
    const notices=await Promise.all(rows.map(async n=>{const period=periodCandidate(n.title),candidates=routeCandidates(n.title),numbers=[];for(const no of candidates)if(await knownNumber(no))numbers.push(no);return {...n,...period,numbers,status:noticeStatus({...n,...period},today),url:`${BASE}/notice/detail?noticeId=${n.id}`};}));
    const order={active:0,upcoming:1,recent:2,past:3};notices.sort((a,b)=>order[a.status]-order[b.status]||b.postedOn.localeCompare(a.postedOn));
    await Promise.all(notices.filter(n=>n.status!=='past').slice(0,6).map(async n=>{try{const parsed=parseNoticeDetail(await page(`/notice/detail?noticeId=${n.id}`)),found=routeCandidates(parsed?.body||'');for(const no of found)if(!n.numbers.includes(no)&&await knownNumber(no))n.numbers.push(no);}catch{}}));
    const value={notices,receivedAt:new Date(now()).toISOString(),available:true};cached={at:now(),value};return value;
   }catch(error){const reason=String(error?.cause?.code||error?.name||error?.key||'unknown').slice(0,40);console.warn(JSON.stringify({kind:'noticeFeedFailed',reason}));return cached?.value||{notices:[],receivedAt:null,available:false,reason};}
  },
  async detail(id){
   if(!/^\d{1,12}$/.test(String(id)))throw new ServiceError('invalidRequest',400);
   if(details.has(id))return details.get(id);
   const parsed=parseNoticeDetail(await page(`/notice/detail?noticeId=${id}`));if(!parsed)throw new ServiceError('notFound',404);
   const value={...parsed,id,url:`${BASE}/notice/detail?noticeId=${id}`};if(details.size>40)details.clear();details.set(id,value);return value;
  }
 };
}
