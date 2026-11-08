// 내 보드 계산: 탄 기록(jb.trips)과 최근 검색(jb.recent)만으로 기기 안에서 계산한다. 서버로 보내지 않는다.
const KST=9*3600000,DAY=86400000,WINDOW=28*DAY;
export const RECENT_MAX=20,RECENT_SHOW=8;
const kst=at=>new Date(at+KST);
export const dayType=at=>{const d=kst(at).getUTCDay();return d===0||d===6?'weekend':'weekday';};
export function partOf(at){const h=kst(at).getUTCHours();return h>=5&&h<11?'morning':h<14&&h>=11?'noon':h>=14&&h<18?'afternoon':h>=18&&h<22?'evening':'night';}
export const weekdayOf=at=>kst(at).getUTCDay();
const minuteOf=at=>{const d=kst(at);return d.getUTCHours()*60+d.getUTCMinutes();};
const gap=(a,b)=>{const d=Math.abs(minuteOf(a)-minuteOf(b));return Math.min(d,1440-d);};
const recent=(legs,now)=>legs.filter(l=>l&&l.no&&l.at<=now&&now-l.at<=WINDOW);
const top=(map)=>[...map.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
function tally(list,key){const m=new Map();for(const x of list){const k=key(x);if(k)m.set(k,(m.get(k)||0)+1);}return m;}

// 지금 요일 종류(평일·주말)와 앞뒤 1시간 안에 2번 이상 탄 번호와 탄 곳
export function suggestNow(legs,now=Date.now()){
 const same=recent(legs,now).filter(l=>dayType(l.at)===dayType(now)&&gap(l.at,now)<=60);
 const counts=tally(same,l=>`${l.no}|${l.stopId}`),best=[...counts.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1])[0];
 if(!best)return null;
 const leg=[...same].reverse().find(l=>`${l.no}|${l.stopId}`===best[0]);
 return {no:leg.no,stopId:leg.stopId,stopName:leg.stopName,lat:leg.lat??null,lng:leg.lng??null,count:best[1],day:dayType(now)};
}

// 탄 곳 → 내린 곳 짝을 지난 4주 기준 2번 이상인 것만
export function frequentRoutes(legs,now=Date.now(),limit=3){
 const done=recent(legs,now).filter(l=>l.offAt&&l.offName&&!l.auto&&l.stopName&&l.offName!==l.stopName),groups=new Map();
 for(const l of done){const k=`${l.stopId}|${l.offName}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);}
 return [...groups.values()].filter(g=>g.length>=2).sort((a,b)=>b.length-a.length||b.at(-1).at-a.at(-1).at).slice(0,limit).map(g=>{
  const last=g.at(-1);
  return {no:top(tally(g,l=>l.no)),stopId:last.stopId,stopName:last.stopName,lat:last.lat??null,lng:last.lng??null,offName:last.offName,offLat:last.offLat??null,offLng:last.offLng??null,count:g.length,day:top(tally(g,l=>dayType(l.at))),part:top(tally(g,l=>partOf(l.at)))};
 });
}

// 자주 탄 번호(지난 4주 2번 이상)
export function frequentBuses(legs,now=Date.now(),limit=5){
 return [...tally(recent(legs,now),l=>l.no).entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([no,count])=>({no,count}));
}

// 최근 탄 버스: 같은 번호·정류장은 한 번만
export function recentRides(legs,limit=3){
 const seen=new Set(),out=[];
 for(const l of [...legs].filter(l=>l&&l.no).sort((a,b)=>b.at-a.at)){const k=`${l.no}|${l.stopId}`;if(seen.has(k))continue;seen.add(k);out.push(l);if(out.length>=limit)break;}
 return out;
}

// 최근 검색. 같은 항목은 맨 앞으로 올린다.
export const recentId=item=>item.kind==='path'?`path:${item.from?.name}>${item.to?.name}`:`${item.kind}:${item.id||item.name}`;
export function addRecent(list,item,now=Date.now()){
 const entry={...item,key:recentId(item),at:now};
 return [entry,...(list||[]).filter(x=>x.key!==entry.key)].slice(0,RECENT_MAX);
}
export const dropRecent=(list,key)=>(list||[]).filter(x=>x.key!==key);

// 히어로 카드 고르기: 기다리는 버스 → 지금 시간대에 자주 탄 버스 → 집 정류장
export function pickHero({wait,legs,homeStop,now=Date.now()}){
 if(wait&&wait.no&&now-(wait.at||0)<=2700000)return {reason:'wait',no:wait.no,stopId:wait.stopId,stopName:wait.stopName};
 const s=suggestNow(legs||[],now);if(s)return {reason:'usual',...s};
 if(homeStop?.id)return {reason:'home',no:null,stopId:homeStop.id,stopName:homeStop.name};
 return null;
}
