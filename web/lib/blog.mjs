// 블로그 후기: 제목·글쓴이·날짜·요약 60자·원문 링크만 보여 준다. 본문과 사진은 가져오지 않는다.
const SIX_HOURS=6*3600000;
const entities={lt:'<',gt:'>',amp:'&',quot:'"','#39':"'",apos:"'"};
const strip=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/&(lt|gt|amp|quot|#39|apos);/g,(_,k)=>entities[k]).replace(/\s+/g,' ').trim();
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:null;}catch{return null;}};
const brief=value=>{const chars=[...strip(value)];return chars.length>60?`${chars.slice(0,60).join('')}…`:chars.join('');};
const post=(title,blogger,date,summary,url,provider)=>({title:strip(title).slice(0,120),blogger:strip(blogger).slice(0,60),date,summary:brief(summary),url:safeUrl(url),provider});
export function createBlog(config,{fetchImpl=fetch,consume,now=Date.now}={}){
 const cache=new Map();
 const naver=()=>config.naverSearchId&&config.naverSearchSecret;
 const kakao=()=>config.kakaoKey&&config.kakaoEnabled;
 const enabled=()=>!!(config.blogEnabled&&(naver()||kakao()));
 async function request(query){
  if(naver()){
   const url=new URL('https://naverapihub.apigw.ntruss.com/search/v1/blog');url.search=new URLSearchParams({query,display:'5',sort:'sim'});
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000),headers:{'X-NCP-APIGW-API-KEY-ID':config.naverSearchId,'X-NCP-APIGW-API-KEY':config.naverSearchSecret}});
   if(!response.ok)throw Error('blog failed');
   return (await response.json()).items?.map(i=>post(i.title,i.bloggername,/^\d{8}$/.test(i.postdate||'')?`${i.postdate.slice(0,4)}-${i.postdate.slice(4,6)}-${i.postdate.slice(6)}`:'',i.description,i.link,'naver'))||[];
  }
  const url=new URL('https://dapi.kakao.com/v2/search/blog');url.search=new URLSearchParams({query,size:'5'});
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000),headers:{Authorization:`KakaoAK ${config.kakaoKey}`}});
  if(!response.ok)throw Error('blog failed');
  return (await response.json()).documents?.map(d=>post(d.title,d.blogname,String(d.datetime||'').slice(0,10),d.contents,d.url,'daum'))||[];
 }
 return {
  enabled,
  async search(name){
   if(!enabled())return {enabled:false,posts:[]};
   const query=`제주 버스 ${name}`,hit=cache.get(query);if(hit?.until>now())return {enabled:true,cached:true,posts:hit.posts};
   await consume('blog',config.blogDailyLimit||100);
   const posts=(await request(query)).filter(p=>p.url).slice(0,3);
   if(cache.size>300)cache.clear();cache.set(query,{posts,until:now()+SIX_HOURS});
   return {enabled:true,cached:false,posts};
  }
 };
}
