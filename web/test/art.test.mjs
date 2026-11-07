import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {art,placeScene,rewardBg,scenePath,TYPE_ART} from '../public/art.js';
import {gameMarkup,REGIONS} from '../public/game.js';
import {busFace,gradeOf} from '../public/board.js';

const noon=Date.parse('2026-11-10T12:00:00+09:00'),night=Date.parse('2026-11-10T22:00:00+09:00'),file=path=>new URL(`../public${path}`,import.meta.url);
test('정류장 배경은 이름과 권역을 따르고 밤에는 밤바다다',()=>{
 assert.equal(placeScene('제주국제공항3(용담,시청)[북]',126.49,33.5,noon),'city');assert.equal(placeScene('김녕항',126.75,33.55,noon),'sea');assert.equal(placeScene('어딘가',126.2,33.3,noon),'canola');assert.equal(placeScene('어딘가',126.5,33.25,noon),'orchard');
 assert.equal(placeScene('김녕항',126.75,33.55,night),'night');assert.ok(existsSync(file(scenePath('night'))));
});
test('화면이 부르는 그림 파일이 모두 있다',()=>{
 const html=gameMarkup([{no:'201',stopId:'s',region:'east',at:noon}],x=>x,k=>k);
 for(const [,src] of html.matchAll(/src="([^"]+)"/g))assert.ok(existsSync(file(src)),src);
 for(const id of REGIONS)assert.ok(existsSync(file(`/art/stamp/${id}.webp`)));
 for(const name of Object.values(TYPE_ART))assert.ok(existsSync(file(`/art/share/type-${name}.webp`)));
 for(const id of ['first-ride','east','sunset'])assert.ok(existsSync(file(`/art/reward/${rewardBg(id)}-bg.webp`)));
 assert.ok(existsSync(file('/art/scene/login.webp')));assert.ok(art('scene/login',10).includes('alt=""'));
});
test('번호판 버스는 등급 색을 쓰고 번호를 이스케이프한다',()=>{
 for(const no of ['101','201','415','810-1','999']){const g=gradeOf(no),src=/src="([^"]+)"/.exec(busFace(no,x=>x,k=>k))[1];assert.ok(existsSync(file(src)),g);}
 assert.ok(busFace('<b>',x=>x.replace(/</g,'&lt;'),k=>k).includes('&lt;b>'));
});
