// 제주 버스 미션. 버스 기록(trips.js)을 재료로 쓰는 게임층이다. 진행 상황은 이 기기에만 저장한다.
// 현금성 보상은 없다. 탑승을 증명할 수단이 없어서 앱 안의 귤, 카드, 스킨만 준다.
import {gradeOf} from './board.js';
import {regionOf,REGIONS} from './game.js';
import {dayOf,journeysOf} from './trips.js';

const KST=9*3600000;
const hour=at=>new Date(at+KST).getUTCHours();
const closed=legs=>legs.filter(l=>l.offAt&&!l.auto);
// 임시 그림 자리. 파일 확장자만 바꾸면 진짜 이미지로 바뀐다. 목록은 내MVP_설계문서/미션_이미지_프롬프트.md
const SLOT_EXT={};
export const slot=(name,width,cls='')=>`<img class="art q-slot ${cls}" data-slot="${name}" src="/art/quest/${name}.${SLOT_EXT[name]||'svg'}" width="${width}" alt="" loading="lazy" decoding="async">`;

export const POOL=[
 ['newNo',20,legs=>legs.some(l=>l.firstNo)],
 ['express',15,legs=>legs.some(l=>gradeOf(l.no)==='express')],
 ['green',10,legs=>legs.some(l=>gradeOf(l.no)==='branch')],
 ['blue',10,legs=>legs.some(l=>gradeOf(l.no)==='trunk')],
 ['tour',25,legs=>legs.some(l=>gradeOf(l.no)==='tour')],
 ['transfer',25,legs=>journeysOf(legs).some(j=>j.legs.length>1)],
 ['early',20,legs=>legs.some(l=>hour(l.at)<8)],
 ['sunset',15,legs=>legs.some(l=>{const h=hour(l.at);return h>=17&&h<19;})],
 ['late',20,legs=>legs.some(l=>hour(l.at)>=20)],
 ['twice',15,legs=>legs.length>=2],
 ['far',20,legs=>legs.some(l=>(l.painted||0)>=10)],
 ['lucky',15,(legs,a,day)=>legs.some(l=>String(l.no).replace(/\D/g,'').at(-1)===day.at(-1))],
 ['kudo',10,(legs,a)=>(a.kudo||0)>=1],
 ['chat',10,(legs,a)=>(a.chat||0)>=1],
];
const WEEKLY=[['wRides',60,5],['wRoutes',60,3],['wDays',80,3],['wStops',80,30]];
export const LEVELS=[0,50,150,300,600,1000,1600,2500,4000];
export const levelOf=xp=>{let i=0;while(i+1<LEVELS.length&&xp>=LEVELS[i+1])i++;return {level:i+1,from:LEVELS[i],to:LEVELS[i+1]??null};};
const hash=text=>[...String(text)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
// 오늘의 미션은 모두 같다. 그래야 커뮤니티에서 같은 이야기를 할 수 있다.
export function todayMissions(day){
 const list=[...POOL],out=[['ride',10,legs=>legs.length>=1]];let seed=hash(day);
 while(out.length<3){out.push(list.splice(seed%list.length,1)[0]);seed=(seed*7+11)>>>0;}
 return out;
}
export const weekOf=at=>{const d=new Date(at+KST),base=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));base.setUTCDate(base.getUTCDate()-((base.getUTCDay()+6)%7));return base.toISOString().slice(0,10);};
export const weekStats=(legs,now)=>{const list=closed(legs).filter(l=>weekOf(l.at)===weekOf(now));return {rides:list.length,routes:new Set(list.map(l=>l.no)).size,days:new Set(list.map(l=>dayOf(l.at))).size,stops:list.reduce((n,l)=>n+(l.painted||0),0)};};
export const blankQuest=()=>({coins:0,xp:0,done:{},tickets:0,ticketDay:{},stops:{},cards:[],actions:{},owned:[],skin:null,team:null,sent:0});
// 진행 평가: 끝낸 미션을 찾아 보상을 더한다. 같은 미션은 한 번만 준다.
export function evaluate(quest,legs,now=Date.now()){
 const day=dayOf(now),week=weekOf(now),today=closed(legs).filter(l=>dayOf(l.at)===day),acts=quest.actions[day]||{},s=weekStats(legs,now),fresh=[],q={...quest,done:{...quest.done}};
 for(const [id,reward,test] of todayMissions(day)){const key=`${day}:${id}`;if(!q.done[key]&&test(today,acts,day)){q.done[key]=true;q.coins+=reward;q.xp+=reward;fresh.push({id,reward});}}
 for(const [id,reward,goal] of WEEKLY){const key=`${week}:${id}`,value={wRides:s.rides,wRoutes:s.routes,wDays:s.days,wStops:s.stops}[id];if(!q.done[key]&&value>=goal){q.done[key]=true;q.coins+=reward;q.xp+=reward;fresh.push({id,reward});}}
 return {quest:q,fresh};
}
export const CARDS=[['airport','공항',/공항/,'common'],['terminal','터미널',/버스터미널/,'common'],['cityhall','시청',/제주시청/,'common'],['market','오일장',/오일시장|민속오일/,'rare'],['hamdeok','함덕',/함덕/,'common'],['gimnyeong','김녕',/김녕/,'rare'],['seongsan','성산',/성산/,'rare'],['pyoseon','표선',/표선/,'rare'],['namwon','남원',/남원/,'rare'],['seogwipo','서귀포',/서귀포/,'common'],['jungmun','중문',/중문/,'common'],['moseulpo','모슬포',/모슬포|운진항/,'rare'],['hallim','한림',/한림/,'rare'],['aewol','애월',/애월/,'rare'],['seongpanak','성판악',/성판악/,'legend'],['eoseungsaeng','어승생',/어승생|영실|1100/,'legend']].map(([id,name,rule,rarity])=>({id,name,rule,rarity}));
export const cardsFor=names=>CARDS.filter(c=>names.some(n=>c.rule.test(n))).map(c=>c.id);
// 내린 뒤 호출. 지나온 정류장을 칠하고 카드와 뽑기권을 준다. 뽑기권은 곧 오던 버스를 탄 기록에만 하루 3장까지.
export function applyRide(quest,leg,path,now=Date.now()){
 const q={...quest,stops:{...quest.stops},cards:[...quest.cards],ticketDay:{...quest.ticketDay}},day=dayOf(now),before=Object.keys(q.stops).length;
 for(const s of path)if(!q.stops[s.id])q.stops[s.id]=regionOf(s.lat,s.lng)||'north';
 const added=Object.keys(q.stops).length-before,cards=cardsFor([leg.stopName,...path.map(s=>s.name)]).filter(id=>!q.cards.includes(id));q.cards.push(...cards);
 const quick=(now-leg.at)>=120000,ticket=!!leg.verified&&quick&&(q.ticketDay[day]||0)<3;if(ticket){q.tickets+=1;q.ticketDay[day]=(q.ticketDay[day]||0)+1;}
 return {quest:q,added,cards,ticket};
}
export function rollTicket(random=Math.random){const r=random();return r<.05?{rarity:'legend',coins:30+Math.floor(random()*21)}:r<.3?{rarity:'rare',coins:8+Math.floor(random()*8)}:{rarity:'common',coins:2+Math.floor(random()*4)};}
export const SKINS=[['sea',120],['canola',120],['camellia',200],['night',300]];
export const TEAMS=['tangerine','sea','oreum'];
export const regionShare=(stops,totals)=>Object.fromEntries(REGIONS.map(id=>{const n=Object.values(stops).filter(r=>r===id).length;return [id,{n,pct:totals[id]?Math.min(100,Math.round(n/totals[id]*1000)/10):0}];}));
const bar=(pct,cls='')=>`<span class="q-bar ${cls}"><i style="width:${Math.min(100,pct)}%"></i></span>`;
export function questMarkup({quest:q,legs,board,totals,now=Date.now(),guest=false},e,t){
 const day=dayOf(now),lv=levelOf(q.xp),span=lv.to?Math.round((q.xp-lv.from)/(lv.to-lv.from)*100):100,s=weekStats(legs,now),share=regionShare(q.stops,totals),total=Object.keys(q.stops).length,all=REGIONS.reduce((n,r)=>n+(totals[r]||0),0)||1,tt=board?.teams||{},max=Math.max(1,...TEAMS.map(x=>tt[x]||0));
 const missions=todayMissions(day).map(([id,reward])=>{const done=q.done[`${day}:${id}`];return `<li class="q-mission ${done?'done':''}">${slot(`mission-${id}`,44)}<div><strong>${t(`qm_${id}`)}</strong><small>${t('qCoins',{n:reward})}</small></div><b>${done?'✓':''}</b></li>`;}).join('');
 const weekly=WEEKLY.map(([id,reward,goal])=>{const v={wRides:s.rides,wRoutes:s.routes,wDays:s.days,wStops:s.stops}[id];return `<li><span>${t(`qm_${id}`,{n:goal})}</span><small>${Math.min(v,goal)}/${goal} · ${t('qCoins',{n:reward})}</small>${bar(v/goal*100)}</li>`;}).join('');
 return `<section class="quest"><header class="q-hero">${slot('hero',96,'q-hero-art')}<div><span class="eyebrow">JEJU BUS QUEST</span><h2>${t(`qLv${lv.level}`)}</h2><p>Lv.${lv.level} · ${t('qWallet',{n:q.coins})}</p>${bar(span)}<small>${lv.to?t('qNext',{n:lv.to-q.xp}):t('qMax')}</small></div></header>
 ${guest?`<button class="save-login" data-action="login">${t('syncLogin')}</button>`:''}${q.tickets?`<button class="q-ticket" data-q-spin="1">${slot('ticket',44)}<span>${t('qTickets',{n:q.tickets})}</span></button>`:''}
 <h3 class="q-head">${t('qToday')}</h3><ul class="q-missions">${missions}</ul>
 <h3 class="q-head">${t('qWeek')}</h3><ul class="q-weekly">${weekly}</ul>
 <h3 class="q-head">${t('qConquest')} <small>${total}/${all} · ${Math.round(total/all*1000)/10}%</small></h3><div class="q-regions">${REGIONS.map(r=>`<div><span>${t(`region_${r}`)}</span>${bar(share[r].pct*4)}<small>${share[r].n} · ${share[r].pct}%</small></div>`).join('')}</div>
 <h3 class="q-head">${t('qTeams')}</h3>${q.team?`<div class="q-teams">${TEAMS.map(x=>`<div class="${q.team===x?'mine':''}">${slot(`team-${x}`,30)}<span>${t(`qTeam_${x}`)}</span>${bar((tt[x]||0)/max*100,`t-${x}`)}<small>${tt[x]||0}</small></div>`).join('')}</div>`:`<p class="muted">${t('qPickTeam')}</p><div class="q-pick">${TEAMS.map(x=>`<button data-q-team="${x}">${slot(`team-${x}`,40)}<span>${t(`qTeam_${x}`)}</span></button>`).join('')}</div>`}
 <h3 class="q-head">${t('qCards')} <small>${q.cards.length}/${CARDS.length}</small></h3><div class="q-cards">${CARDS.map(c=>{const has=q.cards.includes(c.id);return `<figure class="q-card ${has?'on':''} r-${c.rarity}">${slot(`card-${c.id}`,70)}<figcaption>${has?e(c.name):'?'}</figcaption></figure>`;}).join('')}</div>
 <h3 class="q-head">${t('qShop')}</h3><div class="q-shop">${SKINS.map(([id,price])=>{const own=q.owned.includes(id),on=q.skin===id;return `<button data-q-skin="${id}" data-q-price="${price}" class="${on?'on':''}" ${!own&&q.coins<price?'disabled':''}>${slot(`skin-${id}`,40)}<span>${t(`qSkin_${id}`)}</span><small>${on?t('qOn'):own?t('qUse'):t('qCoins',{n:price})}</small></button>`;}).join('')}</div>
 <p class="q-note">${t('qRules')}</p></section>`;
}
export const spinSheet=(result,e,t)=>`<div class="reward q-spin r-${result.rarity}" style="background-image:url(/art/reward/${result.rarity==='legend'?'first-ride':result.rarity==='rare'?'region':'weekly'}-bg.webp)">${slot('ticket',120)}<h2>${t(`qRare_${result.rarity}`)}</h2><p>${t('qGot',{n:result.coins})}</p></div>`;
export const rideSheet=({added,cards,fresh,ticket},e,t)=>`<div class="form-modal q-result"><h2>${t('qRideDone')}</h2><p>${t('qPainted',{n:added})}</p>${cards.map(id=>{const c=CARDS.find(x=>x.id===id);return `<div class="q-new">${slot(`card-${id}`,56)}<span>${t('qNewCard',{name:e(c.name)})}</span></div>`;}).join('')}${fresh.map(m=>`<p class="q-win">${t(`qm_${m.id}`,{n:''})} · ${t('qCoins',{n:m.reward})}</p>`).join('')}${ticket?`<p class="q-win">${t('qGotTicket')}</p>`:''}<button class="tt-go" data-action="close">${t('qGoOn')}</button></div>`;
