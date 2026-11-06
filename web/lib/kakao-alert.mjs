// 관리자 본인 카카오톡 '나에게 보내기'. 실패해도 저장 흐름을 막지 않는다.
// 알림 글에는 접수 번호와 항목 이름만 넣고, 손님 닉네임과 문의 내용은 넣지 않는다.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const KEY='kakaoAlert';
const keyOf=config=>createHash('sha256').update(`${config.kakaoClientSecret}:alert`).digest();
function seal(config,value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',keyOf(config),iv),data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
function open(config,value){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64')),d=createDecipheriv('aes-256-gcm',keyOf(config),iv);d.setAuthTag(tag);return Buffer.concat([d.update(data),d.final()]).toString('utf8');}
export function createKakaoAlert(config,store,{fetchImpl=fetch}={}){
 const key=()=>config.kakaoLoginKey||config.kakaoKey,ready=()=>!!(config.kakaoAlertEnabled&&key()&&config.kakaoClientSecret);
 const save=refresh=>store.recordPut('secrets',KEY,{id:KEY,value:seal(config,refresh),updated:Date.now()});
 return {
  ready,save,
  async connected(){return ready()&&!!await store.recordGet('secrets',KEY);},
  async send(message){
   try{
    if(!ready())return false;const row=await store.recordGet('secrets',KEY);if(!row)return false;
    const tokens=await fetchImpl('https://kauth.kakao.com/oauth/token',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams({grant_type:'refresh_token',client_id:key(),client_secret:config.kakaoClientSecret,refresh_token:open(config,row.value)})});
    if(!tokens.ok)throw Error('refresh failed');const result=await tokens.json();if(result.refresh_token)await save(result.refresh_token);
    const link=`${config.origin}/admin`,sent=await fetchImpl('https://kapi.kakao.com/v2/api/talk/memo/default/send',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${result.access_token}`,'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams({template_object:JSON.stringify({object_type:'text',text:String(message).slice(0,200),link:{web_url:link,mobile_web_url:link}})})});
    if(!sent.ok)throw Error('send failed');return true;
   }catch{console.warn(JSON.stringify({kind:'kakaoAlertFailure'}));return false;}
  }
 };
}
