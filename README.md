# jejubus

제주 버스 검색·실시간 운행정보와 노선/정류장 커뮤니티 웹앱.

애플리케이션은 `web/`에 있습니다. Node.js 22.13 이상에서 실행합니다.

```powershell
cd web
npm run dev
```

로컬 주소: http://localhost:3000/

환경변수는 `web/.env.local`에 직접 입력합니다. Google OAuth 값은 파일 저장 후 앱을 새로고침하면 반영됩니다. 이 파일과 Firebase Admin 서비스 계정 JSON, DB 파일은 Git에서 제외합니다.

- [앱 실행과 검증](web/README.md)
- [기획·디자인 레퍼런스](내MVP_설계문서/08_개발착수_지도중심형.md)
- [외부 API 발급·검증 상태](내MVP_설계문서/09_API발급과_실연동_검증.md)

GitHub: https://github.com/jejuailabs/jejubus

Vercel 자동 배포 연결은 사용자가 준비한 프로젝트를 사용합니다. 운영은 승인된 기존 Firebase Firestore를 사용하고, 로컬 개발용 SQLite는 배포에서 분리합니다. Google OAuth 상태·세션과 API 사용량은 Firestore에서 서버 간 공유합니다. 환경변수 27개 등록 및 실제 DB/교통 API/로컬 Google 로그인을 검증했습니다. 배포와 운영 검증 기록은 [환경변수 연결 현황](내MVP_설계문서/10_환경변수_연결현황.md)에 있습니다.
