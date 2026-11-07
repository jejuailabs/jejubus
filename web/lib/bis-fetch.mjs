// BIS 서버는 중간 인증서를 보내지 않아 서버 환경의 Node가 연결을 거부한다.
// 인증서 검사는 끄지 않고, 빠진 Sectigo 인증서만 신뢰 목록에 더해 이 호출에만 쓴다.
import https from 'node:https';
import tls from 'node:tls';
import {SECTIGO_BIS} from './certs/sectigo-bis.mjs';

const ca=[...tls.rootCertificates,SECTIGO_BIS];
export function bisFetch(url,{signal}={}){
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{ca,signal,headers:{'User-Agent':'jejubus'}},response=>{
   const chunks=[];response.on('data',c=>chunks.push(c));response.on('error',reject);
   response.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,text:async()=>body});});
  });
  request.on('error',reject);
 });
}
