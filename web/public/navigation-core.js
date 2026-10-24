// Pure navigation geometry. No provider calls, DOM, storage or location collection.
const R=6371000, rad=x=>x*Math.PI/180;
export function distance(a,b){const x=rad(b.lng-a.lng)*Math.cos(rad((a.lat+b.lat)/2)),y=rad(b.lat-a.lat);return R*Math.hypot(x,y);}
export function bearing(a,b){return (Math.atan2(Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng)))*180/Math.PI+360)%360;}
export function prepareRoute(route){
 const cumulative=[0];for(let i=1;i<route.points.length;i++)cumulative.push(cumulative[i-1]+distance(route.points[i-1],route.points[i]));
 return {...route,cumulative,length:cumulative.at(-1)};
}
export function project(point,route,{min=0,max=Infinity}={}){
 let best=null;const scale=R*Math.PI/180,cos=Math.cos(rad(point.lat));
 for(let i=0;i<route.points.length-1;i++){
  if(route.cumulative[i+1]<min||route.cumulative[i]>max)continue;
  const a=route.points[i],b=route.points[i+1],ax=(a.lng-point.lng)*scale*cos,ay=(a.lat-point.lat)*scale,bx=(b.lng-point.lng)*scale*cos,by=(b.lat-point.lat)*scale,dx=bx-ax,dy=by-ay;
  const fraction=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),error=Math.hypot(ax+fraction*dx,ay+fraction*dy),along=route.cumulative[i]+fraction*(route.cumulative[i+1]-route.cumulative[i]);
  if(!best||error<best.error)best={error,along,index:i,point:{lat:a.lat+(b.lat-a.lat)*fraction,lng:a.lng+(b.lng-a.lng)*fraction}};
 }return best;
}
export function pointAt(route,meters){let i=route.cumulative.findIndex(v=>v>=meters);if(i<1)return i===0?route.points[0]:route.points.at(-1);const a=route.points[i-1],b=route.points[i],f=(meters-route.cumulative[i-1])/(route.cumulative[i]-route.cumulative[i-1]||1);return {lat:a.lat+(b.lat-a.lat)*f,lng:a.lng+(b.lng-a.lng)*f};}
export function createTracker(route){
 let progress=0,previous=null,offCount=0,arrivalCount=0;
 return {update(fix,now=Date.now()){
  if(!Number.isFinite(fix.lat)||!Number.isFinite(fix.lng)||!Number.isFinite(fix.accuracy)||fix.accuracy<0||fix.accuracy>60||!Number.isFinite(fix.timestamp)||now-fix.timestamp>15000||fix.timestamp>now+1000)return {quality:'weak'};
  if(previous&&fix.timestamp<=previous.timestamp)return {quality:'stale'};
  const elapsed=previous?(fix.timestamp-previous.timestamp)/1000:0;
  if(previous&&distance(previous,fix)>Math.max(150,elapsed*60+fix.accuracy+previous.accuracy))return {quality:'jump'};
  // Limit forward snapping at crossings/loops; permit a short reverse movement.
  const snap=project(fix,route,{min:Math.max(0,progress-100),max:previous?progress+Math.max(200,elapsed*60):Infinity});
  if(!snap)return {quality:'weak'};
  previous=fix;const expected=bearing(route.points[snap.index],route.points[snap.index+1]),angle=Number.isFinite(fix.heading)?Math.abs(((fix.heading-expected+540)%360)-180):0;
  const off=snap.error>Math.max(45,fix.accuracy*1.5)||(fix.speed>3&&angle>110);offCount=off?offCount+1:0;
  if(!off)progress=Math.max(progress,snap.along);
  const remaining=Math.max(0,route.length-progress),last=route.points.at(-1);
  arrivalCount=!off&&remaining<60&&distance(fix,last)<35&&(fix.speed==null||fix.speed<5)?arrivalCount+1:0;
  const next=route.guides.find(g=>g.along>progress+12)||route.guides.at(-1);
  return {quality:off?'offroute':'good',progress,remaining,snap,next,turnDistance:Math.max(0,(next?.along||route.length)-progress),reroute:offCount>=3,arrived:arrivalCount>=2,seconds:route.duration*(remaining/(route.length||1))};
 }};
}
