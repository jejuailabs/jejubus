// 탑승 판별. 탑승 중 화면이 켜져 있는 동안의 위치만 쓰고, 좌표는 이 기기 밖으로 보내지 않는다.
// 계정에는 판별 결과와 거리, 시간, 포인트만 저장한다.
export const STOP_RADIUS_M=30,VEHICLE_KMH=15,HALT_KMH=5,WALK_KMH=7,MAX_ACCURACY_M=60;
const POINT_KM=5,POINT_MIN=1,RIDE_CAP=200,DAY_CAP=600;
const meters=(a,b)=>{const r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return Math.hypot(x,y)*6371000;};
export function addSample(list,s){if(s.accuracy>MAX_ACCURACY_M)return list;const last=list.at(-1);if(last&&s.t-last.t<5000)return list;return [...list,{t:s.t,lat:s.lat,lng:s.lng}].slice(-720);}
function segments(samples){const out=[];for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i],sec=(b.t-a.t)/1000;if(sec<=0)continue;const m=meters(a,b),kmh=m/sec*3.6;if(kmh>130)continue;out.push({from:a,to:b,sec,m,kmh});}return out;}
// 차 속도로 움직이다 잠깐 멈춘 곳이 노선 정류장 근처면 정류장 정차로 센다.
export function classify(samples,stops=[]){
 if(samples.length<4)return {kind:'none',km:0,minutes:0,stopHits:0,halts:0};
 const segs=segments(samples);let vehicleSec=0,km=0,halts=0,stopHits=0,moving=false,haltSec=0,counted=false;
 for(const s of segs){
  if(s.kmh>=VEHICLE_KMH){vehicleSec+=s.sec;km+=s.m/1000;moving=true;haltSec=0;counted=false;continue;}
  if(s.kmh>=HALT_KMH){km+=s.m/1000;continue;}
  haltSec+=s.sec;
  if(moving&&!counted&&haltSec>=8&&haltSec<=180){counted=true;halts+=1;if(stops.some(p=>meters(s.to,p)<=STOP_RADIUS_M))stopHits+=1;}
 }
 const minutes=Math.round(segs.reduce((n,s)=>n+s.sec,0)/60);
 if(vehicleSec<60)return {kind:'walk',km:Math.round(km*10)/10,minutes,stopHits,halts};
 const need=km>=3?2:1;
 return {kind:stopHits>=need?'bus':'vehicle',km:Math.round(km*10)/10,minutes,stopHits,halts};
}
// 걷는 속도가 3분 이어지고 노선에서 벗어나면 내린 것으로 본다.
export function looksOff(samples,stops=[],now=samples.at(-1)?.t){
 const recent=samples.filter(s=>now-s.t<=180000);if(recent.length<4||now-recent[0].t<150000)return false;
 const segs=segments(recent),sec=segs.reduce((n,s)=>n+s.sec,0)||1,kmh=segs.reduce((n,s)=>n+s.m,0)/sec*3.6,here=recent.at(-1);
 return kmh>=1&&kmh<=WALK_KMH&&!stops.some(p=>meters(here,p)<=STOP_RADIUS_M*2)&&samples.some(s=>s.t<recent[0].t);
}
export function nearestStop(stops,point){return [...stops].sort((a,b)=>meters(point,a)-meters(point,b))[0]||null;}
// 포인트: 거리와 시간 기준. 인증 100%, 본인 확인 50%, 그 밖에는 0. 사용처는 나중에 붙인다.
export function ridePoints(check,confirmed,earnedToday=0){
 const rate=check.kind==='bus'?1:check.kind==='vehicle'&&confirmed?.5:0;if(!rate)return 0;
 const raw=Math.round((check.km*POINT_KM+check.minutes*POINT_MIN)*rate);return Math.max(0,Math.min(raw,RIDE_CAP,DAY_CAP-earnedToday));
}
export const confirmSheet=(no,check,e,t)=>`<div class="form-modal log-sheet"><h2>${t('rideAsk',{no:e(no)})}</h2><p class="muted">${t('rideAskHelp',{km:check.km})}</p><button class="tt-go" data-ride-confirm="yes">${t('rideYes')}</button><button class="log-skip" data-ride-confirm="no">${t('rideNo')}</button></div>`;
