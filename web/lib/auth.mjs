import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';

const token=()=>randomBytes(32).toString('base64url');
export function verifyIdToken(jwt,keys,{audience,nonce,now=Date.now()}) {
  if(typeof jwt!=='string'||jwt.length>20000) throw new Error('Invalid token');
  const parts=jwt.split('.');
  if(parts.length!==3) throw new Error('Invalid token');
  const header=JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(header.alg!=='RS256'||!jwk||!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'))) throw new Error('Invalid signature');
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||!audiences.includes(audience)||(audiences.length>1&&claims.azp!==audience)||!Number.isFinite(claims.exp)||claims.exp<=now/1000||!Number.isFinite(claims.iat)||claims.iat>now/1000+60||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255) throw new Error('Invalid claims');
  return claims;
}
export function createGoogleAuth(config,{fetchImpl=fetch}={}) {
  const pending=new Map();
  const enabled=!!(config.googleClientId&&config.googleClientSecret);
  const redirectUri=`${config.origin}/auth/google/callback`;
  let cachedKeys=null;
  const getJson=async(url,options={})=>{
    const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Google request failed');
    return response.json();
  };
  return {
    enabled,
    start(){
      if(!enabled) throw new Error('Google not configured');
      for(const [key,p] of pending) if(p.expires<Date.now()) pending.delete(key);
      if(pending.size>1000) throw new Error('Too many sign-in requests');
      const state=token(),binding=token(),nonce=token(),verifier=token();
      pending.set(state,{binding,nonce,verifier,expires:Date.now()+600000});
      const query=new URLSearchParams({client_id:config.googleClientId,redirect_uri:redirectUri,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'});
      return {url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`,binding};
    },
    async finish({state,code,binding}){
      const request=pending.get(state);
      if(!request||request.expires<Date.now()||request.binding!==binding||!code) throw new Error('Invalid OAuth state');
      pending.delete(state);
      const result=await getJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.googleClientId,client_secret:config.googleClientSecret,code,grant_type:'authorization_code',redirect_uri:redirectUri,code_verifier:request.verifier})});
      if(!cachedKeys||cachedKeys.expires<Date.now()) cachedKeys={...(await getJson('https://www.googleapis.com/oauth2/v3/certs')),expires:Date.now()+3600000};
      // Refresh once when Google rotates signing keys.
      const header=JSON.parse(Buffer.from(String(result.id_token).split('.')[0],'base64url'));
      if(!cachedKeys.keys.some(k=>k.kid===header.kid)) cachedKeys={...(await getJson('https://www.googleapis.com/oauth2/v3/certs')),expires:Date.now()+3600000};
      const claims=verifyIdToken(result.id_token,cachedKeys.keys,{audience:config.googleClientId,nonce:request.nonce});
      return {id:`google:${claims.sub}`,name:String(claims.name||'Jeju rider').slice(0,80)};
    }
  };
}
