// 공지 감시: BIS 공개 공지 목록을 읽어 새 글과 본문 변경을 찾고, 사람이 게시할 초안으로 쌓는다.
// 공식 공지는 같은 글 맨 위에 내용을 덧붙이기도 해서 본문 해시를 비교한다. 자동으로 게시하지 않는다.
import {createHash,randomBytes} from 'node:crypto';
import {ServiceError} from './catalog.mjs';
import {adminOf} from './admin.mjs';

const BASE='https://bus.jeju.go.kr',RECENT_DAYS=45;
const fail=(key,status=400)=>{throw new ServiceError(key,status);};
const text=html=>String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();
export function parseNoticeList(html){
 return [...String(html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap(([,row])=>{
  const id=row.match(/goDetail\('(\d+)'\)/)?.[1],title=row.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1],day=row.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  return id&&title&&day?[{id,title:text(title),postedOn:day}]:[];
 });
}
export function parseNoticeDetail(html){
 const source=String(html),title=source.match(/제목<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/)?.[1];
 const start=source.indexOf('summary="공지사항입니다."'),end=source.indexOf('첨부파일',start);
 if(start<0)return null;
 const body=text(source.slice(start,end>start?end:undefined).replace(/^[^>]*>/,'')).replace(/^[\s\S]*?등록일\s*\d{4}-\d{2}-\d{2}\s*/,'');
 return {title:title?text(title):'',body};
}
export const bodyHash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,32);
// 노선 번호 후보. 틀릴 수 있으니 사람이 게시할 때 고친다.
export function routeCandidates(value,known=()=>true){
 const found=new Set();
 for(const m of String(value).matchAll(/(?<![\d.\-:~/])(\d{2,4}(?:-\d{1,2})?)\s*(?:번|,|·|노선|\s|$)/g))if(known(m[1]))found.add(m[1]);
 return [...found].slice(0,40);
}
// 제목의 ('26.11.7.~11.8.) 표기에서 기간 후보를 만든다.
export function periodCandidate(title){
 const m=String(title).match(/'?(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*[~∼-]\s*(?:'?(\d{2})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.?)?/);if(!m)return {startsOn:'',endsOn:''};
 const pad=n=>String(n).padStart(2,'0'),year=`20${m[1]}`,startsOn=`${year}-${pad(m[2])}-${pad(m[3])}`;
 if(!m[5])return {startsOn,endsOn:startsOn};
 const endYear=m[4]?`20${m[4]}`:Number(m[5])<Number(m[2])?String(Number(year)+1):year;
 return {startsOn,endsOn:`${endYear}-${pad(m[5])}-${pad(m[6])}`};
}
export function createNoticeWatch(config,store,{fetchImpl=fetch,now=Date.now,knownNumber=async()=>true,gap=500}={}){
 const guard=actor=>{if(!adminOf(config,actor))fail('forbidden',403);};
 const page=async path=>{const response=await fetchImpl(BASE+path,{signal:AbortSignal.timeout(10000)});if(!response.ok)fail('providerUnavailable',503);return response.text();};
 return {
  async check(){
   const list=parseNoticeList(await page('/notice/list')),since=new Date(now()-RECENT_DAYS*86400000).toISOString().slice(0,10);let fresh=0,changed=0;
   if(!list.length)fail('providerUnavailable',503);
   for(const item of list.filter(n=>n.postedOn>=since)){
    const detail=parseNoticeDetail(await page(`/notice/detail?noticeId=${item.id}`));if(!detail)continue;
    const hash=bodyHash(`${detail.title}\n${detail.body}`),prior=await store.recordGet('notice_watch',item.id);
    if(prior?.bodyHash===hash)continue;
    const candidates=routeCandidates(`${detail.title}\n${detail.body}`),numbers=[];
    for(const no of candidates)if(await knownNumber(no))numbers.push(no);
    await store.recordPut('notice_watch',item.id,{id:item.id,title:detail.title||item.title,postedOn:item.postedOn,bodyHash:hash,body:detail.body.slice(0,1500),numbers,...periodCandidate(detail.title||item.title),sourceUrl:`${BASE}/notice/detail?noticeId=${item.id}`,state:'draft',changed:!!prior,lastSeenAt:now()});
    prior?changed++:fresh++;
    await new Promise(r=>setTimeout(r,gap));
   }
   return {checked:list.length,fresh,changed,at:now()};
  },
  async drafts(actor){guard(actor);return {drafts:(await store.recordList('notice_watch',{field:'state',value:'draft',limit:100})).sort((a,b)=>b.postedOn.localeCompare(a.postedOn))};},
  async publish(actor,body){
   guard(actor);
   const draft=await store.recordGet('notice_watch',String(body?.id||''));if(!draft)fail('notFound',404);
   const clean=(value,max,key)=>{if(typeof value!=='string'||value.trim().length<2||[...value.trim()].length>max)fail(key);return value.trim();};
   const routeNos=Array.isArray(body.routeNos)?[...new Set(body.routeNos.map(String).filter(n=>/^[\w-]{1,20}$/.test(n)))].slice(0,40):[];
   if(!routeNos.length)fail('noticeRoute');
   const dates=[body.startsOn||'',body.endsOn||''];for(const d of dates)if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))fail('noticePeriod');
   const id=randomBytes(16).toString('hex');
   await store.recordPut('notices',id,{id,context:`no:${routeNos[0]}`,routeNos,routeName:routeNos.join(', ').slice(0,40),title:clean(body.title,80,'noticeTitle'),body:clean(body.body,500,'noticeBody'),startsOn:dates[0],endsOn:dates[1],sourceUrl:draft.sourceUrl,sourceNoticeId:draft.id,status:'published',author:actor.id,created:now()});
   await store.recordPut('notice_watch',draft.id,{...draft,state:'published'});
   return {id};
  },
  async dismiss(actor,id){guard(actor);const draft=await store.recordGet('notice_watch',String(id||''));if(!draft)fail('notFound',404);await store.recordPut('notice_watch',draft.id,{...draft,state:'dismissed'});return {ok:true};}
 };
}
