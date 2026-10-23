export const places = [
  { id:'airport', x:260, y:180, name:{ko:'제주공항',en:'Jeju Airport',zh:'济州机场',ja:'済州空港'} },
  { id:'cityhall', x:650, y:580, name:{ko:'제주시청',en:'Jeju City Hall',zh:'济州市政府',ja:'済州市庁'} },
  { id:'market', x:640, y:290, name:{ko:'동문시장',en:'Dongmun Market',zh:'东门市场',ja:'東門市場'} },
  { id:'terminal', x:430, y:440, name:{ko:'제주버스터미널',en:'Jeju Bus Terminal',zh:'济州巴士总站',ja:'済州バスターミナル'} },
  { id:'park', x:300, y:630, name:{ko:'한라수목원',en:'Halla Arboretum',zh:'汉拿树木园',ja:'漢拏樹木園'} }
];
export const journeys = [
  {id:'r01',number:'01',total:38,walk:4,wait:6,ride:28,transfers:0,distance:5.2,color:'#2167ff',points:[[650,580],[610,520],[530,470],[430,440],[380,360],[320,290],[260,180]],buses:[[540,477],[356,330],[290,235]]},
  {id:'r02',number:'02',total:42,walk:2,wait:9,ride:31,transfers:0,distance:6.1,color:'#00a582',points:[[650,580],[570,610],[450,560],[340,480],[280,370],[220,280],[260,180]],buses:[[450,560],[240,300]]},
  {id:'r03',number:'03',total:55,walk:9,wait:3,ride:43,transfers:1,distance:5.8,color:'#8b64d9',points:[[650,580],[700,480],[660,360],[570,280],[450,240],[350,210],[260,180]],buses:[[650,350],[410,228]]}
];
export const seedPosts = [
  {id:'p01',category:'question',route:'r01',author:'귤빛여행',avatar:'귤',color:'#fff0dd',minutes:5,likes:12,replies:3,
   title:{ko:'공항 가려면 어느 쪽에서 타나요?',en:'Which side should I board for the airport?',zh:'去机场应该在哪一侧上车？',ja:'空港へはどちら側で乗ればいいですか？'},
   body:{ko:'처음 제주에 왔어요. 반대편 정류장과 이름이 같아서 헷갈리네요. 방향 확인하는 팁이 있나요?',en:'It is my first visit. Both stops have the same name. How can I check the direction?',zh:'第一次来济州，两边的站名一样。怎么确认方向呢？',ja:'初めての済州です。両側の停留所名が同じで迷っています。方向の確認方法はありますか？'}},
  {id:'p02',category:'update',route:'r01',author:'제주살이',avatar:'제',color:'#e1f4ed',minutes:12,likes:28,replies:5,
   title:{ko:'정류장 승차 위치가 바뀌었어요',en:'The boarding point has moved',zh:'公交站上车位置变了',ja:'バス乗り場の位置が変わりました'},
   body:{ko:'현장 소식 예시입니다. 실제 변경 여부와 위치는 공식 안내에서 확인해주세요.',en:'This is a sample local update. Check official notices for actual changes.',zh:'这是现场消息示例。实际变化请以官方通知为准。',ja:'現地情報のサンプルです。実際の変更は公式案内をご確認ください。'}},
  {id:'p03',category:'concern',route:'r02',author:'퇴근길산책',avatar:'퇴',color:'#eee8ff',minutes:30,likes:16,replies:8,
   title:{ko:'퇴근 시간 배차가 너무 길어요',en:'Long waits during the evening commute',zh:'下班时间等车太久了',ja:'夕方の通勤時間、待ち時間が長いです'},
   body:{ko:'같은 노선 타는 분들은 어떻게 이동하시나요? 조금 걸어도 다른 선택지가 있으면 알고 싶어요.',en:'How do others on this route get home? I do not mind walking a little for another option.',zh:'坐这条线路的朋友怎么回家？多走一点也可以，有其他选择吗？',ja:'同じ路線の皆さんはどう帰っていますか？少し歩いても他の選択肢があれば知りたいです。'}},
  {id:'p04',category:'tip',route:'r03',author:'느린제주',avatar:'느',color:'#e3efff',minutes:48,likes:21,replies:2,
   title:{ko:'버스 방향, 이렇게 확인하면 편해요',en:'A simple way to check the bus direction',zh:'这样确认巴士方向更方便',ja:'バスの方向はこう確認すると便利です'},
   body:{ko:'노선번호만 보지 말고 버스 앞면의 목적지와 정류장 순서를 함께 확인해보세요.',en:'Check the destination on the front of the bus and the stop order as well as its number.',zh:'除了线路编号，还要确认车头的目的地和站点顺序。',ja:'路線番号だけでなく、車両前面の行き先と停留所の順序を確認してみてください。'}}
];
export function rankJourneys(items, sort='fastest') {
  const metric = {fastest:x=>x.total,walking:x=>x.walk,transfers:x=>x.transfers};
  const fn=metric[sort] || metric.fastest;
  return [...items].sort((a,b)=>fn(a)-fn(b)||a.total-b.total);
}
export function matchPlace(query) {
  const q=String(query).trim().toLocaleLowerCase();
  return places.find(p=>Object.values(p.name).some(n=>n.toLocaleLowerCase()===q));
}
