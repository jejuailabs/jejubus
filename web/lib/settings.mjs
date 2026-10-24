import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
const secretKeys=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TAGO_SERVICE_KEY','KAKAO_REST_KEY','ODSAY_API_KEY'];
const allowed=new Set([...secretKeys,'TAGO_CITY_CODE','KAKAO_ENABLED','ODSAY_ENABLED','SHOW_SAMPLE_POSTS','ADMIN_GOOGLE_SUBS']);
export function configuration(env){return {
  origin:env.APP_ORIGIN||`http://localhost:${Number(env.PORT)||3000}`,
  googleClientId:env.GOOGLE_CLIENT_ID||'',googleClientSecret:env.GOOGLE_CLIENT_SECRET||'',
  tagoKey:env.TAGO_SERVICE_KEY||'',cityCode:env.TAGO_CITY_CODE||'',stopId:env.TAGO_STOP_ID||'',transitMode:env.TAGO_SERVICE_KEY?'tago':env.TRANSIT_MODE||'demo',
  tagoDailyLimit:Math.min(1000,Math.max(1,Number(env.TAGO_DAILY_LIMIT)||1000)),
  kakaoKey:env.KAKAO_REST_KEY||'',kakaoEnabled:env.KAKAO_ENABLED==='true',kakaoDailyLimit:100,
  odsayKey:env.ODSAY_API_KEY||'',odsayEnabled:env.ODSAY_ENABLED==='true',odsayDailyLimit:Math.min(25,Math.max(1,Number(env.ODSAY_DAILY_LIMIT)||25)),
  aiKey:env.OPENAI_API_KEY||'',aiModel:env.OPENAI_MODEL||'',aiEnabled:env.AI_ENABLED==='true'&&env.AI_BILLING_APPROVED==='true'&&env.OPENAI_MODEL==='gpt-5.4-mini'&&/^[\w-]{8,80}$/.test(env.AI_APPROVAL_ID||'')&&Date.parse(env.AI_APPROVAL_UNTIL)>Date.now()&&Date.parse(env.AI_APPROVAL_UNTIL)<=Date.now()+31*86400000,
  aiDailyLimit:Math.min(20,Math.max(1,Number(env.AI_DAILY_LIMIT)||20)),aiPeriodCalls:Math.min(100,Math.max(1,Number(env.AI_PERIOD_CALL_LIMIT)||100)),aiApprovalId:env.AI_APPROVAL_ID||'',aiApprovalUntil:env.AI_APPROVAL_UNTIL||'',
  showSamples:env.SHOW_SAMPLE_POSTS==='true',adminSubjects:(env.ADMIN_GOOGLE_SUBS||'').split(',').map(v=>v.trim()).filter(Boolean),
  setupAllowed:env.NODE_ENV!=='production'&&(!env.HOST||['127.0.0.1','localhost','::1'].includes(env.HOST))&&/^http:\/\/localhost(?::\d+)?$/.test(env.APP_ORIGIN||`http://localhost:${Number(env.PORT)||3000}`)
};}
export function createSettings(file,initialEnv,{onChange=()=>{}}={}){
  const token=randomBytes(32).toString('base64url');
  let current={...initialEnv},writing=false,lastSource;
  return {
    token,
    status:()=>({google:!!(current.GOOGLE_CLIENT_ID&&current.GOOGLE_CLIENT_SECRET),tago:!!current.TAGO_SERVICE_KEY,kakao:!!current.KAKAO_REST_KEY,odsay:!!current.ODSAY_API_KEY,kakaoEnabled:current.KAKAO_ENABLED==='true',odsayEnabled:current.ODSAY_ENABLED==='true',samples:current.SHOW_SAMPLE_POSTS==='true'}),
    async reload(){
      if(writing||!file)return;
      let source;try{source=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
      if(source===lastSource)return;
      current={...initialEnv,...parseEnv(source)};
      await onChange(configuration(current));lastSource=source;
    },
    async save(fields){
      if(!file)throw Object.assign(Error('notFound'),{key:'notFound',status:404});
      if(writing)throw Object.assign(Error('rateLimited'),{key:'rateLimited',status:429});
      writing=true;
      try{
      if(!fields||typeof fields!=='object'||Array.isArray(fields))throw Error('invalidRequest');
      let source='';try{source=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      const updates={};
      for(const [key,value] of Object.entries(fields)){
        if(!allowed.has(key)||typeof value!=='string'||value.length>2048||/[\r\n\0"']/.test(value))throw Error('invalidRequest');
        if(secretKeys.includes(key)&&!value.trim())continue;
        if(['KAKAO_ENABLED','ODSAY_ENABLED','SHOW_SAMPLE_POSTS'].includes(key)&&!['true','false'].includes(value))throw Error('invalidRequest');
        if(key==='GOOGLE_CLIENT_ID'&&value&&!value.endsWith('.apps.googleusercontent.com'))throw Error('invalidRequest');
        if(key==='TAGO_CITY_CODE'&&value&&!/^\d{1,8}$/.test(value))throw Error('invalidRequest');
        updates[key]=value.trim();
      }
      for(const [key,value] of Object.entries(updates)){
        const line=`${key}=${value}`;const pattern=new RegExp(`^${key}=.*$`,'m');source=pattern.test(source)?source.replace(pattern,()=>line):source+`${source.endsWith('\n')||!source?'':'\n'}${line}\n`;
      }
      const temporary=`${file}.tmp`;await writeFile(temporary,source,{mode:0o600});await rename(temporary,file);
      current={...initialEnv,...parseEnv(source)};await onChange(configuration(current));lastSource=source;return this.status();
      }catch(error){if(error.message==='invalidRequest')Object.assign(error,{key:'invalidRequest',status:400});throw error;}finally{writing=false;}
    }
  };
}
