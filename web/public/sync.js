// 계정 저장: 로그인하면 기기 기록과 계정 기록을 합친다. 어느 쪽 기록도 버리지 않는다.
export const SYNC_KEYS={quest:'jb.quest',trips:'jb.trips',rides:'jb.rides',myStops:'jb.myStops',homeStop:'jb.homeStop',ttRecent:'jb.ttRecent',places:'jb.places',favGone:'jb.favGone',recent:'jb.recent'};
const byKey=(lists,key)=>[...new Map(lists.flat().filter(Boolean).map(x=>[key(x),x])).values()];
function mergeQuest(a,b){
 if(!a||!b)return a||b||null;
 const max=k=>Math.max(a[k]||0,b[k]||0),set=k=>[...new Set([...(a[k]||[]),...(b[k]||[])])];
 const days={...b.ticketDay};for(const [d,n] of Object.entries(a.ticketDay||{}))days[d]=Math.max(days[d]||0,n);
 return {...b,...a,points:max('points'),pointDay:{...b.pointDay,...a.pointDay},coins:max('coins'),xp:max('xp'),tickets:max('tickets'),done:{...b.done,...a.done},stops:{...b.stops,...a.stops},ticketDay:days,cards:set('cards'),owned:set('owned'),team:a.team||b.team||null,skin:a.skin||b.skin||null,actions:{...b.actions,...a.actions}};
}
function mergeGone(a,b){const out={...b};for(const [k,at] of Object.entries(a||{}))out[k]=Math.max(out[k]||0,at);return out;}
// 지운 뒤에 다시 저장한 항목만 살린다. 예전 항목은 저장 시각이 없어 지운 기록이 있으면 빠진다.
const alive=(list,gone,prefix)=>list.filter(x=>(x.at||0)>=(gone[prefix+x.id]||0));
export function mergeProgress(local={},remote={}){
 const legs=new Map(),gone=mergeGone(local.favGone,remote.favGone);
 for(const leg of [...(remote.trips||[]),...(local.trips||[])]){const prior=legs.get(leg.id);if(!prior||(!prior.offAt&&leg.offAt)||prior.offAt)legs.set(leg.id,prior?.offAt&&!leg.offAt?prior:{...prior,...leg});}
 return {
  quest:mergeQuest(local.quest,remote.quest),
  trips:[...legs.values()].sort((x,y)=>x.at-y.at).slice(-300),
  rides:byKey([remote.rides,local.rides],r=>`${r.at}|${r.no}`).sort((x,y)=>x.at-y.at).slice(-500),
  myStops:alive(byKey([remote.myStops,local.myStops],s=>s.id),gone,'stop:'),
  places:alive(byKey([remote.places,local.places],p=>p.id),gone,'place:'),
  favGone:gone,
  homeStop:local.homeStop||remote.homeStop||null,
  ttRecent:[...new Set([...(local.ttRecent||[]),...(remote.ttRecent||[])])].slice(0,8),
  recent:byKey([remote.recent,local.recent],r=>r.key).filter(r=>(r.at||0)>=Math.max(gone['recent:*']||0,gone['recent:'+r.key]||0)).sort((x,y)=>y.at-x.at).slice(0,20)
 };
}
