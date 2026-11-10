import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {directionGroups,indexNetwork,numberFamilies,radiusOf,search,searchNumbers,stopsWithin,walkMinutes} from '../public/map-lab-search.js';

// 동서로 놓인 작은 노선망. 100번은 A→B→C→D, 200번은 X→C→E, 300번은 A2→F(A에서 도보 범위)
const at=(x,y=0)=>({lat:33.5+y/111000,lng:126.5+x/92900});
const raw=[['A','가정류장',at(0)],['B','나정류장',at(1000)],['C','다정류장',at(2000)],['D','라정류장',at(3000)],['X','마정류장',at(2000,800)],['E','바정류장',at(2000,-3000)],['A2','사정류장',at(0,300)],['F','아정류장',at(3000,350)]];
const stops=raw.map(([id,name,p])=>[id,name,'',p.lat,p.lng]),idx=Object.fromEntries(raw.map(([id],i)=>[id,i]));
const seq=(id,no,list)=>({id,no,type:'',start:'',end:'',stops:list.map(s=>idx[s])});
const net=indexNetwork({stops,variants:[seq('v1','100',['A','B','C','D']),seq('v2','200',['X','C','E']),seq('v3','300',['A2','F'])]});

test('도보 분을 직선 반경으로 바꾸고 다시 분으로 돌린다',()=>{
 assert.equal(Math.round(radiusOf(10)),515);
 assert.equal(Math.round(walkMinutes(radiusOf(10))),10);
});
test('도보 0분은 가장 가까운 곳만, 10분은 범위 안 전부',()=>{
 assert.deepEqual(stopsWithin(net,at(0),0).map(o=>o.stop.id),['A']);
 assert.deepEqual(stopsWithin(net,at(0),10).map(o=>o.stop.id),['A','A2']);
});
test('방향이 맞는 직행만 찾는다',()=>{
 const forward=search(net,at(0),at(3000));
 assert.deepEqual(forward.options.map(o=>o.legs.map(l=>l.no)),[['100']]);
 assert.equal(forward.options[0].legs[0].stops,3);
 assert.equal(search(net,at(3000),at(0)).options.length,0);
});
test('도보 범위를 넓히면 더 편한 탑승 정류장이 후보가 된다',()=>{
 const closest=search(net,at(0),at(3000,350));
 assert.equal(closest.options.some(o=>o.key==='d|300'),false);
 const wider=search(net,at(0),at(3000,350),{walkFrom:10,walkTo:10});
 const direct=wider.options.find(o=>o.key==='d|300');
 assert.ok(direct);
 assert.equal(direct.boardStop.id,'A2');
 assert.equal(direct.transfers,0);
});
test('환승 경로의 갈아타는 정류장을 알려 준다',()=>{
 const r=search(net,at(0),at(2000,-3000));
 const option=r.options.find(o=>o.transfers===1);
 assert.deepEqual(option.legs.map(l=>l.no),['100','200']);
 assert.equal(net.stops[option.legs[0].alight].id,'C');
 assert.equal(net.stops[option.legs[1].board].id,'C');
});
test('번호를 본 번호로 묶고 방향별로 나눈다',()=>{
 const n2=indexNetwork({stops,variants:[seq('a','202',['A','B','C']),seq('b','202',['C','B','A']),seq('c','202',['A','B','C','D']),seq('d','202-1',['A','B']),seq('e','43-1',['X','C'])]});
 const groups=directionGroups(n2,'202');
 assert.equal(groups.length,3);
 assert.deepEqual(groups.map(g=>g.to),['라정류장','다정류장','가정류장']);
 const families=numberFamilies(n2);
 assert.deepEqual(families.get('202'),['202','202-1']);
 assert.deepEqual(searchNumbers(families,'20').map(r=>r.no),['202']);
 assert.deepEqual(searchNumbers(families,'202-').map(r=>r.no),['202-1']);
 assert.deepEqual(searchNumbers(families,'43').map(r=>r.no),['43-1']);
 assert.deepEqual(searchNumbers(families,'abc'),[]);
});
test('대표 버튼의 번호는 모두 실제 번호표에 있다',async()=>{
 const real=indexNetwork(JSON.parse(await readFile(new URL('../public/data/network.json',import.meta.url),'utf8')));
 const source=await readFile(new URL('../public/map-lab.js',import.meta.url),'utf8');
 const numbers=[...source.match(/const QUICK=\[.*\];/)[0].matchAll(/numbers:\[([^\]]+)\]/g)].flatMap(m=>m[1].replaceAll("'",'').split(','));
 assert.ok(numbers.length>=20);
 for(const no of numbers)assert.ok(real.variants.some(v=>v.no===no),no);
});
test('실제 번호표에서 공항→중문 도보 10분 확대가 후보를 줄이지 않는다',async()=>{
 const real=JSON.parse(await readFile(new URL('../public/data/network.json',import.meta.url),'utf8'));
 const n=indexNetwork(real),airport={lat:33.5067,lng:126.4933},jungmun={lat:33.2546,lng:126.4120};
 const base=search(n,airport,jungmun),wide=search(n,airport,jungmun,{walkFrom:10,walkTo:10});
 assert.ok(wide.total>=base.total);
 assert.ok(wide.options.length>0);
 for(const o of wide.options)for(const l of o.legs)assert.ok(l.to>l.from);
});
