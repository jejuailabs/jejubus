export const koreaDay=(at=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const int=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
export function metricEvent(event,at=Date.now()){
 if(!['tago','kakao','kakao-routing','kakao-driving','odsay','ai'].includes(event.provider))throw Error('Invalid metric provider');
 const inputTokens=int(event.usage?.input_tokens),outputTokens=int(event.usage?.output_tokens),cachedTokens=Math.min(inputTokens,int(event.usage?.input_tokens_details?.cached_tokens));
 return {provider:event.provider,day:koreaDay(at),period:event.period||'',operation:String(event.operation||'request').replace(/[^\w/-]/g,'').slice(0,100),ok:event.ok===true,reported:!!event.usage,inputTokens,outputTokens,cachedTokens,
  estimatedMicroUsd:event.provider==='ai'?Math.ceil((inputTokens-cachedTokens)*.75+cachedTokens*.075+outputTokens*4.5):0,durationMs:int(event.durationMs),at};
}
export function accumulateMetric(prior={},event){
 const add=(name,value)=>int(prior[name])+value;
 return {provider:event.provider,day:event.day,period:event.period,requests:add('requests',1),successes:add('successes',event.ok?1:0),failures:add('failures',event.ok?0:1),inputTokens:add('inputTokens',event.inputTokens),outputTokens:add('outputTokens',event.outputTokens),cachedTokens:add('cachedTokens',event.cachedTokens),estimatedMicroUsd:add('estimatedMicroUsd',event.estimatedMicroUsd),unreported:add('unreported',event.provider==='ai'&&!event.reported?1:0),durationMs:add('durationMs',event.durationMs),lastAt:event.at};
}
