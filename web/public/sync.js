// 계정 저장: 로그인하면 기기 기록과 계정 기록을 합친다. 어느 쪽 기록도 버리지 않는다.
export const SYNC_KEYS={quest:'jb.quest',trips:'jb.trips',rides:'jb.rides',myStops:'jb.myStops',homeStop:'jb.homeStop',ttRecent:'jb.ttRecent'};
const byKey=(lists,key)=>[...new Map(lists.flat().filter(Boolean).map(x=>[key(x),x])).values()];
function mergeQuest(a,b){
 if(!a||!b)return a||b||null;
 const max=k=>Math.max(a[k]||0,b[k]||0),set=k=>[...new Set([...(a[k]||[]),...(b[k]||[])])];
 const days={...b.ticketDay};for(const [d,n] of Object.entries(a.ticketDay||{}))days[d]=Math.max(days[d]||0,n);
 return {...b,...a,points:max('points'),pointDay:{...b.pointDay,...a.pointDay},coins:max('coins'),xp:max('xp'),tickets:max('tickets'),done:{...b.done,...a.done},stops:{...b.stops,...a.stops},ticketDay:days,cards:set('cards'),owned:set('owned'),team:a.team||b.team||null,skin:a.skin||b.skin||null,actions:{...b.actions,...a.actions}};
}
export function mergeProgress(local={},remote={}){
 const legs=new Map();
 for(const leg of [...(remote.trips||[]),...(local.trips||[])]){const prior=legs.get(leg.id);if(!prior||(!prior.offAt&&leg.offAt)||prior.offAt)legs.set(leg.id,prior?.offAt&&!leg.offAt?prior:{...prior,...leg});}
 return {
  quest:mergeQuest(local.quest,remote.quest),
  trips:[...legs.values()].sort((x,y)=>x.at-y.at).slice(-300),
  rides:byKey([remote.rides,local.rides],r=>`${r.at}|${r.no}`).sort((x,y)=>x.at-y.at).slice(-500),
  myStops:byKey([remote.myStops,local.myStops],s=>s.id),
  homeStop:local.homeStop||remote.homeStop||null,
  ttRecent:[...new Set([...(local.ttRecent||[]),...(remote.ttRecent||[])])].slice(0,8)
 };
}
