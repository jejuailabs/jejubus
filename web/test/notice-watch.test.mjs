import {createNoticeFeed,noticeStatus} from '../lib/notice-feed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createNoticeWatch,parseNoticeDetail,parseNoticeList,periodCandidate,routeCandidates} from '../lib/notice-watch.mjs';
import {createRouteAdmin} from '../lib/route-admin.mjs';

const list=`<tbody><tr><td>1</td><td><a href="javascript:goDetail('709')" class="table_link"><span style="x">임시변경 알림('26.11.7.~11.8.)&nbsp;</span></a></td><td>2026-11-05</td></tr><tr><td>2</td><td><a href="javascript:goDetail('10')"><span>옛 공지</span></a></td><td>2020-01-01</td></tr></tbody>`;
const detail=body=>`<table><tr><th>제목</th><td colspan="3">임시변경 알림('26.11.7.~11.8.)</td></tr><table summary="공지사항입니다."><tr><td>${body}</td></tr></table></table>첨부파일`;
const admin={id:'google:a',role:'admin'},member={id:'google:b'};
const setup=(pages)=>{const store=createStore(':memory:',{seed:false}),hits=[];const fetchImpl=async url=>{hits.push(url);return {ok:true,text:async()=>url.includes('/list')?list:detail(pages.body)};};return {store,hits,watch:createNoticeWatch({},store,{fetchImpl,now:()=>Date.parse('2026-11-07T00:00:00Z'),knownNumber:async n=>['711-2','201'].includes(n),gap:0})};};

test('공지 목록과 본문을 읽는다',()=>{
 assert.deepEqual(parseNoticeList(list)[0],{id:'709',title:"임시변경 알림('26.11.7.~11.8.)",postedOn:'2026-11-05'});
 assert.equal(parseNoticeDetail(detail('<p>본문&nbsp;내용</p>')).body,'본문 내용');assert.equal(parseNoticeDetail('없음'),null);
});
test('번호와 기간은 후보로만 뽑고 날짜·시각은 번호로 잡지 않는다',()=>{
 assert.deepEqual(routeCandidates('711-2번 노선 조정, 201번 우회',n=>true),['711-2','201']);
 assert.ok(!routeCandidates("10:30~11:30 '26.11.7.").includes('30'));
 assert.deepEqual(periodCandidate("알림('26.11.7.~11.8.)"),{startsOn:'2026-11-07',endsOn:'2026-11-08'});
 assert.deepEqual(periodCandidate("알림('26.12.30.~1.2.)"),{startsOn:'2026-12-30',endsOn:'2027-01-02'});
 assert.deepEqual(periodCandidate('알림'),{startsOn:'',endsOn:''});
});
test('새 글만 초안이 되고, 같은 본문은 다시 쓰지 않고, 바뀌면 변경으로 표시한다',async()=>{
 const pages={body:'711-2번 우회'},{watch}=setup(pages);
 assert.deepEqual((({fresh,changed})=>[fresh,changed])(await watch.check()),[1,0]);
 assert.deepEqual((({fresh,changed})=>[fresh,changed])(await watch.check()),[0,0]);
 pages.body='711-2번 우천 취소';const r=await watch.check();assert.equal(r.changed,1);
 const {drafts}=await watch.drafts(admin);assert.equal(drafts.length,1);assert.equal(drafts[0].changed,true);assert.deepEqual(drafts[0].numbers,['711-2']);assert.equal(drafts[0].startsOn,'2026-11-07');
});
test('게시는 관리자만, 번호가 있어야 하고, 게시하면 번호 전체에 보인다',async()=>{
 const {store,watch}=setup({body:'711-2번 우회'});await watch.check();
 const draft={id:'709',title:'임시 변경',body:'본문 내용',routeNos:['711-2'],startsOn:'2026-11-07',endsOn:'2026-11-08'};
 await assert.rejects(watch.publish(member,draft),{key:'forbidden'});await assert.rejects(watch.publish(admin,{...draft,routeNos:[]}),{key:'noticeRoute'});
 await watch.publish(admin,draft);assert.equal((await watch.drafts(admin)).drafts.length,0);
 const ra=createRouteAdmin({},store,{now:()=>Date.parse('2026-11-07T12:00:00+09:00')});
 const {notices}=await ra.today(async()=>null);assert.deepEqual(notices[0].numbers,['711-2']);assert.ok(notices[0].sourceUrl.includes('noticeId=709'));
 assert.equal((await ra.noticesByNumber(['711-2'],'S',async()=>null)).get('711-2')[0].title,'임시 변경');
});
test('목록을 못 읽으면 실패로 알린다',async()=>{
 const store=createStore(':memory:',{seed:false}),watch=createNoticeWatch({},store,{fetchImpl:async()=>({ok:true,text:async()=>'<html></html>'})});
 await assert.rejects(watch.check(),{key:'providerUnavailable'});
});
test('공지 게시판: 기간으로 진행 중과 지난 공지를 나누고 실패해도 멈추지 않는다',async()=>{
 const html=`<tr><td onclick="goDetail('10')"><span>행사 임시변경 알림('26.11.7.~11.8.)</span></td><td>2026-11-05</td></tr><tr><td onclick="goDetail('9')"><span>202-2번 임시변경 알림('26. 9. 28.)</span></td><td>2026-09-20</td></tr><tr><td onclick="goDetail('8')"><span>앱 안내</span></td><td>2026-11-01</td></tr>`;
 let down=false;const feed=createNoticeFeed({now:()=>Date.parse('2026-11-07T03:00:00Z'),knownNumber:async no=>no==='202-2',fetchImpl:async()=>{if(down)throw Error('x');return {ok:true,text:async()=>html};}});
 const {notices}=await feed.list();assert.deepEqual(notices.map(n=>[n.id,n.status]),[['10','active'],['8','recent'],['9','past']]);assert.deepEqual(notices[2].numbers,['202-2']);
 assert.equal(noticeStatus({startsOn:'2026-12-01',endsOn:'2026-12-02',postedOn:'2026-11-01'},'2026-11-07'),'upcoming');
 down=true;const fresh=createNoticeFeed({fetchImpl:async()=>{throw Error('x');}});assert.equal((await fresh.list()).available,false);
 await assert.rejects(feed.detail('../x'),{key:'invalidRequest'});
});
