export function createTransit(config,{fetchImpl=fetch}={}) {
  let cache=null;
  const enabled=config.transitMode==='tago'&&!!(config.tagoKey&&config.cityCode&&config.stopId);
  return {
    enabled,
    async arrivals(){
      if(!enabled) return {mode:'demo',source:null,updatedAt:null,arrivals:[]};
      if(cache&&cache.expires>Date.now()) return cache.value;
      const url=new URL('https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList');
      url.search=new URLSearchParams({serviceKey:config.tagoKey,cityCode:config.cityCode,nodeId:config.stopId,_type:'json',numOfRows:'100'});
      const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000)});
      if(!response.ok) throw new Error('Transit provider unavailable');
      const data=await response.json();
      if(!['00',0,'0'].includes(data.response?.header?.resultCode)) throw new Error('Transit provider rejected request');
      let items=data.response?.body?.items?.item||[];
      if(!Array.isArray(items)) items=[items];
      const arrivals=items.filter(x=>Number.isFinite(Number(x.arrtime))&&Number(x.arrtime)>=0).map(x=>({route:String(x.routeno),stop:String(x.nodenm),seconds:Number(x.arrtime),remainingStops:Number(x.arrprevstationcnt)}));
      const value={mode:'live',source:'국토교통부 TAGO',updatedAt:new Date().toISOString(),arrivals};
      cache={value,expires:Date.now()+15000};
      return value;
    }
  };
}
