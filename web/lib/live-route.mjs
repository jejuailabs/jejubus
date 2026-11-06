// 한 방향의 전 변형 차량을 합친다. 차량은 자기 변형 ID로만 조회되기 때문이다.
// 호출을 아끼려고 5분마다 전체를 훑고, 그사이에는 차량이 있던 변형만 다시 묻는다.
const SWEEP_MS=300000,EMPTY_RETRY_MS=60000,PARALLEL=4;

async function inBatches(ids,run){const out=[];for(let i=0;i<ids.length;i+=PARALLEL)out.push(...await Promise.allSettled(ids.slice(i,i+PARALLEL).map(run)));return out;}

export function createLiveRoute({positions,groupOf,now=Date.now}){
 const memory=new Map();
 return {
  async route(variantId){
   const group=await groupOf(variantId).catch(()=>null),ids=group?.variantIds||[variantId],key=group?.key||variantId,seen=memory.get(key)||{active:new Set(),sweptAt:0};
   const age=now()-seen.sweptAt,sweep=age>=SWEEP_MS||(!seen.active.size&&age>=EMPTY_RETRY_MS),targets=sweep?ids:ids.filter(id=>seen.active.has(id));
   const results=await inBatches(targets,id=>positions(id).then(r=>({...r,id})));
   const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
   if(targets.length&&!ok.length)throw results[0].reason;
   const vehicles=new Map(),active=new Set();
   for(const r of ok){if(r.vehicles.length)active.add(r.id);for(const v of r.vehicles)vehicles.set(v.id,v);}
   if(!sweep)for(const id of seen.active)if(!ok.some(r=>r.id===id))active.add(id);
   if(ok.length)memory.set(key,{active,sweptAt:sweep?now():seen.sweptAt});
   if(memory.size>300)memory.delete(memory.keys().next().value);
   return {vehicles:[...vehicles.values()],receivedAt:ok[0]?.receivedAt||new Date(now()).toISOString(),coverage:{total:ids.length,checked:targets.length,active:active.size,partial:ok.length<targets.length}};
  }
 };
}
