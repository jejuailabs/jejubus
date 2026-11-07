// 앱 그림 모음. 그림은 전부 꾸밈이라 대체 글을 비우고, 의미는 옆의 글자가 맡는다.
// 공지와 안전에 관한 영역에는 표정 있는 버스를 넣지 않는다.
// 그림을 같은 파일 이름으로 바꿀 때 이 값을 올리면 캐시에 남은 옛 그림 대신 새 그림을 받는다.
export const ART_V='nb1';
export const art=(name,width,cls='')=>`<img class="art ${cls}" src="/art/${name}.webp?v=${ART_V}" width="${width}" alt="" loading="lazy" decoding="async">`;
const KST=9*3600000;
// 정류장 카드 배경. 이름에 장소 단서가 있으면 그것을, 없으면 권역을 따른다. 밤에는 밤바다.
export function placeScene(name='',lng=null,lat=null,now=Date.now()){
 const hour=new Date(now+KST).getUTCHours();if(hour>=20||hour<5)return 'night';
 if(/시청|터미널|시장|공항|청사|병원/.test(name))return 'city';if(/오름|한라|일출봉|산방산/.test(name))return 'oreum';if(/항|포구|해변|해수욕|바다/.test(name))return 'sea';if(/숲|휴양림|곶자왈|수목원/.test(name))return 'forest';
 const x=Number(lng),y=Number(lat);if(!x)return 'stonewall';if(x>=126.72)return 'stonewall';if(x<=126.38)return 'canola';return y>=33.38?'city':'orchard';
}
export const scenePath=id=>`/art/board/${id}.webp`;
export const TYPE_ART={typeEast:'east',typeWest:'west',typeSouth:'explorer',typeNorth:'commuter',typeNight:'night'};
export const CARD_ART={typeEast:'sea',typeWest:'sunset',typeSouth:'oreum',typeNorth:'oreum',typeNight:'night'};
export const rewardBg=id=>id==='first-ride'?'first-ride':['east','west','south','north','four-way'].includes(id)?'region':'weekly';
