// 카카오·네이버 로그인. 받는 정보는 회원번호와 닉네임뿐이며 access token은 바로 버린다.
import {randomBytes} from 'node:crypto';
const token=()=>randomBytes(32).toString('base64url');
const providers={
 kakao:{authorize:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',profile:'https://kapi.kakao.com/v2/user/me',
  ready:c=>c.kakaoLoginEnabled&&(c.kakaoLoginKey||c.kakaoKey)&&c.kakaoClientSecret,id:c=>c.kakaoLoginKey||c.kakaoKey,secret:c=>c.kakaoClientSecret,
  person:p=>({id:p.id,name:p.kakao_account?.profile?.nickname||p.properties?.nickname})},
 naver:{authorize:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token',profile:'https://openapi.naver.com/v1/nid/me',
  ready:c=>c.naverLoginEnabled&&c.naverLoginId&&c.naverLoginSecret,id:c=>c.naverLoginId,secret:c=>c.naverLoginSecret,
  person:p=>({id:p.response?.id,name:p.response?.nickname})}
};
export function createSocialAuth(config,{fetchImpl=fetch,stateStore=null}={}){
 const pending=new Map();
 const redirect=name=>`${config.origin}/auth/${name}/callback`;
 const provider=name=>Object.hasOwn(providers,name)&&providers[name].ready(config)?providers[name]:null;
 async function exchange(p,params){
  const response=await fetchImpl(p.token,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams({client_id:p.id(config),client_secret:p.secret(config),...params})});
  if(!response.ok)throw Error('Token request failed');const result=await response.json();if(!result.access_token)throw Error('Token missing');return result;
 }
 return {
  enabled:name=>!!provider(name),
  async start(name,{alert=false}={}){
   const p=provider(name);if(!p)throw Error('Provider not configured');
   for(const [key,value]of pending)if(value.expires<Date.now())pending.delete(key);if(pending.size>1000)throw Error('Too many sign-in requests');
   const state=token(),binding=token(),request={binding,provider:name,alert,expires:Date.now()+600000};
   if(stateStore)await stateStore.putOAuth(state,request);else pending.set(state,request);
   const query=new URLSearchParams({client_id:p.id(config),redirect_uri:redirect(name),response_type:'code',state,...(alert?{scope:'talk_message'}:{})});
   return {url:`${p.authorize}?${query}`,binding};
  },
  async finish(name,{state,code,binding}){
   const p=provider(name);if(!p)throw Error('Provider not configured');
   const request=stateStore?await stateStore.takeOAuth(state,binding):pending.get(state);
   if(!request||request.expires<Date.now()||request.binding!==binding||request.provider!==name||!code)throw Error('Invalid OAuth state');pending.delete(state);
   const tokens=await exchange(p,{grant_type:'authorization_code',code,state,redirect_uri:redirect(name)});
   if(request.alert)return {alert:true,refreshToken:tokens.refresh_token};
   const response=await fetchImpl(p.profile,{signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${tokens.access_token}`}});
   if(!response.ok)throw Error('Profile request failed');const person=p.person(await response.json());
   if(person.id===undefined||person.id===null||person.id==='')throw Error('Profile missing');
   return {id:`${name}:${person.id}`,name:String(person.name||'Jeju rider').slice(0,80)};
  }
 };
}
