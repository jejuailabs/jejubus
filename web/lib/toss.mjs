// 토스페이먼츠 테스트 결제. 설정에서 test_ 키만 받으므로 실제 돈이 움직이지 않는다.
import {ServiceError} from './catalog.mjs';
export function createToss(config,{fetchImpl=fetch}={}){
 return {
  enabled:()=>!!(config.tossClientKey&&config.tossSecretKey),
  async confirm({paymentKey,orderId,amount}){
   if(!config.tossSecretKey)throw new ServiceError('paymentFailed',503);
   const response=await fetchImpl('https://api.tosspayments.com/v1/payments/confirm',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Basic ${Buffer.from(`${config.tossSecretKey}:`).toString('base64')}`,'Content-Type':'application/json'},body:JSON.stringify({paymentKey,orderId,amount})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.status!=='DONE')throw Object.assign(new ServiceError('paymentFailed',402),{providerCode:result.code||null});
   return result;
  }
 };
}
