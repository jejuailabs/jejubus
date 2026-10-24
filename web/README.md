# 제주버스

Node.js 22.13 이상. 실제 지도와 버스 정보·커뮤니티를 연결하는 로컬 웹앱이다.

```powershell
cd web
npm run dev
```

앱: http://localhost:3000/ · API 발급 및 로컬 설정: http://localhost:3000/setup

TAGO 4종 승인·키 연결과 카카오 장소 검색·버스 길찾기 실연동을 완료했다. 제주 도시코드 39, 201번 노선·경유 정류장·실제 운행 차량 좌표 및 정류장 도착 응답을 확인했다. ODsay `jejubus` Basic도 실제 제주 길찾기와 지도 경로선을 검증했으며, 무료 30회/일 중 앱은 최대 25회/일로 제한한다. Google OAuth의 로컬 실제 로그인과 사용자 프로필 표시를 확인했다. OpenAI 키는 저장했으나 유료 추론은 비활성이다.

발급 순서·비용 조건·검증 상태는 [09 API 발급과 실연동 검증](../내MVP_설계문서/09_API발급과_실연동_검증.md), 설정 완료 목록은 [10 환경변수 연결 현황](../내MVP_설계문서/10_환경변수_연결현황.md)에 있다. 키는 `web/.env.local` 또는 로컬 설정 화면에 입력한다. `.env.local`, SQLite DB 및 비밀값은 Git에서 제외한다. Vercel `jejuai/jejubus` Production Secret 27개를 저장했다. 사용자 승인 후 기존 Firebase Blaze에 실제 문서 저장·재조회와 커뮤니티/세션/OAuth/한도 공유를 검증했다. 운영은 Firestore, 로컬 오프라인 개발은 SQLite를 선택한다. `api/index.mjs`와 `vercel.json`으로 서버리스 실행을 준비했고 로컬 Vercel 빌드를 통과했다. 운영 배포 결과는 10번 문서에 기록한다.

검증:

```powershell
npm test
npm run check
```

외부 호출 없는 UI 검증용 서버: `node test/qa-server.mjs`. 출력된 임시 localhost 주소를 사용한다. 모든 계정·버스·시간은 `QA` 모의 데이터이며 메모리 DB만 쓴다. 15분 후 자동 종료한다. 이 서버를 서비스용으로 실행하지 않는다.

유료 API/AI, 결제 계정, 호스팅·DB·도메인 배포는 기본 비활성이다. 추가 비용이 발생하거나 불확실한 실행은 서비스·요금·예산·기간별 사용자 승인 이후에만 진행한다.
