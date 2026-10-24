import {metricEvent,accumulateMetric} from './telemetry.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { seedPosts } from '../public/data.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function createStore(path=':memory:',{seed=true}={}) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,route TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,base_likes INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS likes(post_id TEXT NOT NULL REFERENCES posts(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(post_id,user_id));
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blocks(user_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(user_id,blocked_id));
    CREATE TABLE IF NOT EXISTS request_keys(user_id TEXT NOT NULL,request_id TEXT NOT NULL,post_id TEXT NOT NULL,PRIMARY KEY(user_id,request_id));
    CREATE TABLE IF NOT EXISTS api_usage(provider TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(provider,day));
    CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metrics(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS controls(provider TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  db.exec('PRAGMA busy_timeout=5000');
  for(const table of ['posts','replies'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='status'))db.exec(`ALTER TABLE ${table} ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`);
  for(const [name,type]of Object.entries({email:"TEXT",role:"TEXT NOT NULL DEFAULT 'member'",status:"TEXT NOT NULL DEFAULT 'active'",auth_version:"INTEGER NOT NULL DEFAULT 0",created:"INTEGER",last_login:"INTEGER"}))if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name===name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='auth_version'))db.exec('ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
  const encode = x=>JSON.stringify(x);
  const decode = x=>{try{return JSON.parse(x);}catch{return x;}};
  const upsertUser = (id,name)=>db.prepare('INSERT INTO users(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id,name);
  function seedSamples(){for (const p of seedPosts) {
    const id=`sample:${p.id}`;
    upsertUser(id,p.author);
    const exists=db.prepare('SELECT id FROM posts WHERE id=?').get(p.id);
    if (!exists) {
      const created=Date.now()-p.minutes*60000;
      db.prepare('INSERT INTO posts(id,user_id,category,route,title,body,created,base_likes) VALUES(?,?,?,?,?,?,?,?)').run(p.id,id,p.category,p.route,encode(p.title),encode(p.body),created,p.likes);
      const response={ko:'방향과 정류장 순서를 함께 확인해보세요. 이 답변은 화면 확인용 예시입니다.',en:'Check the direction and stop order together. This reply is sample content.',zh:'请同时确认方向和站点顺序。此回答为示例内容。',ja:'方向と停留所の順序を確認してみてください。この回答はサンプルです。'};
      for(let i=0;i<p.replies;i++) db.prepare('INSERT INTO replies(id,post_id,user_id,body,created) VALUES(?,?,?,?,?)').run(`sample:${p.id}:${i}`,p.id,id,encode(response),created+(i+1)*1000);
    }
  }}
  if(seed)seedSamples();
  const user = reqToken => {
    if (!reqToken) return null;
    return db.prepare("SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.status='active' AND s.auth_version=u.auth_version").get(hash(reqToken),Date.now()) || null;
  };
  function createSession(id,name,profile={}) {
    if(db.prepare('SELECT status FROM users WHERE id=?').get(id)?.status==='suspended')throw Object.assign(Error('accountSuspended'),{key:'accountSuspended',status:403});
    upsertUser(id,String(name).slice(0,80));
    db.prepare('UPDATE users SET email=coalesce(?,email),created=coalesce(created,?),last_login=? WHERE id=?').run(profile.email||null,Date.now(),Date.now(),id);
    const token=randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,Date.now()+7*86400000,db.prepare('SELECT auth_version FROM users WHERE id=?').get(id).auth_version);
    return token;
  }
  const listPosts = (uid,{includeSamples=true}={}) => db.prepare(`SELECT p.*,u.name AS author,
    (SELECT count(*) FROM replies r WHERE r.post_id=p.id AND r.status='published') AS replies,
    p.base_likes+(SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS likes,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM posts p JOIN users u ON u.id=p.user_id WHERE p.status='published'
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.blocked_id=p.user_id)
    ORDER BY p.created DESC`).all(uid||'',uid||'').filter(p=>includeSamples||!p.user_id.startsWith('sample:')).map(({user_id,base_likes,...p})=>({...p,title:decode(p.title),body:decode(p.body),liked:!!p.liked,owned:user_id===uid,sample:user_id.startsWith('sample:')}));
  return {
    db,user,createSession,listPosts,seedSamples,
    rememberContext:c=>db.prepare('INSERT INTO contexts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type').run(c.id,c.name,c.type),
    context:id=>db.prepare('SELECT * FROM contexts WHERE id=?').get(id),
    destroySession:token=>db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token||'')),
    postExists:id=>!!db.prepare("SELECT id FROM posts WHERE id=? AND status='published'").get(id),
    ownsPost:(uid,id)=>!!db.prepare("SELECT id FROM posts WHERE id=? AND user_id=? AND status='published'").get(id,uid),
    createPost:(uid,p)=>{
      if(p.requestId){const prior=db.prepare('SELECT post_id FROM request_keys WHERE user_id=? AND request_id=?').get(uid,p.requestId);if(prior)return prior.post_id;}
      const id=randomUUID();db.exec('BEGIN IMMEDIATE');
      try{db.prepare('INSERT INTO posts(id,user_id,category,route,title,body,created,base_likes) VALUES(?,?,?,?,?,?,?,0)').run(id,uid,p.category,p.route,encode(p.title),encode(p.body),Date.now());
        if(p.requestId)db.prepare('INSERT INTO request_keys VALUES(?,?,?)').run(uid,p.requestId,id);db.exec('COMMIT');return id;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    listReplies:(id,uid)=>db.prepare("SELECT r.id,r.body,r.created,r.user_id,u.name AS author FROM replies r JOIN users u ON u.id=r.user_id WHERE r.post_id=? AND r.status='published' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.blocked_id=r.user_id) ORDER BY r.created").all(id,uid||'').map(({user_id,...r})=>({...r,owned:user_id===uid,body:decode(r.body)})),
    reply:(uid,id,body)=>db.prepare('INSERT INTO replies(id,post_id,user_id,body,created) VALUES(?,?,?,?,?)').run(randomUUID(),id,uid,encode(body),Date.now()),
    editPost:(uid,id,p)=>db.prepare("UPDATE posts SET title=?,body=?,category=?,route=? WHERE id=? AND user_id=? AND status='published'").run(encode(p.title),encode(p.body),p.category,p.route,id,uid).changes>0,
    deletePost:(uid,id)=>db.prepare("UPDATE posts SET status='deleted' WHERE id=? AND user_id=? AND status='published'").run(id,uid).changes>0,
    deleteReply:(uid,id)=>db.prepare("UPDATE replies SET status='deleted' WHERE id=? AND user_id=? AND status='published'").run(id,uid).changes>0,
    report:(uid,postId,reason)=>{const prior=db.prepare("SELECT id FROM reports WHERE post_id=? AND user_id=? AND status='open'").get(postId,uid);if(prior)return prior.id;const reportId=randomUUID();db.prepare('INSERT INTO reports(id,post_id,user_id,reason,created) VALUES(?,?,?,?,?)').run(reportId,postId,uid,reason,Date.now());return reportId;},
    blockPostAuthor:(uid,postId)=>db.prepare('INSERT OR IGNORE INTO blocks(user_id,blocked_id) SELECT ?,user_id FROM posts WHERE id=? AND user_id!=?').run(uid,postId,uid),
    listReports:()=>db.prepare('SELECT r.id,r.post_id AS postId,r.reason,r.status,r.created,p.title FROM reports r JOIN posts p ON p.id=r.post_id ORDER BY r.created DESC LIMIT 200').all().map(r=>({...r,title:decode(r.title)})),
    moderate:(reportId,hide)=>{const r=db.prepare('SELECT post_id FROM reports WHERE id=?').get(reportId);if(!r)return false;db.exec('BEGIN IMMEDIATE');try{if(hide)db.prepare("UPDATE posts SET status='hidden' WHERE id=?").run(r.post_id);db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(reportId);db.exec('COMMIT');return true;}catch(error){db.exec('ROLLBACK');throw error;}},
    consumeApi:(provider,limit,period)=>{const day=period||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const result=db.prepare('INSERT INTO api_usage VALUES(?,?,1) ON CONFLICT(provider,day) DO UPDATE SET count=count+1 WHERE count<?').run(provider,day,limit);if(!result.changes)throw Object.assign(new Error('quotaReached'),{key:'quotaReached',status:429});},
    usage:(limit=20)=>db.prepare('SELECT provider,day,count FROM api_usage ORDER BY day DESC LIMIT ?').all(Math.min(500,limit)),
    recordMetric:event=>{const e=metricEvent(event),id=`${e.provider}:${e.day}:${e.period}`,prior=db.prepare('SELECT data FROM metrics WHERE id=?').get(id);db.prepare('INSERT INTO metrics VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,encode(accumulateMetric(prior?decode(prior.data):{},e)));},
    metrics:()=>db.prepare('SELECT data FROM metrics ORDER BY id DESC LIMIT 500').all().map(r=>decode(r.data)),
    adminUsers:()=>db.prepare('SELECT id,name,email,role,status,created,last_login AS lastLogin FROM users WHERE id NOT LIKE ? ORDER BY last_login DESC LIMIT 500').all('sample:%'),
    adminUserUpdate:(id,{action,actor,...patch})=>{if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))throw Object.assign(Error('notFound'),{key:'notFound',status:404});db.exec('BEGIN IMMEDIATE');try{if(patch.status)db.prepare('UPDATE users SET status=? WHERE id=?').run(patch.status,id);if(patch.role)db.prepare('UPDATE users SET role=? WHERE id=?').run(patch.role,id);if(action==='revoke'||patch.status==='suspended')db.prepare('UPDATE users SET auth_version=auth_version+1 WHERE id=?').run(id);db.prepare('INSERT INTO audit VALUES(?,?)').run(randomUUID(),encode({actor,target:id,action:action||'userUpdate',changes:patch,created:Date.now()}));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}},
    control:provider=>{const r=db.prepare('SELECT data FROM controls WHERE provider=?').get(provider);return r?decode(r.data):null;},
    controls:()=>db.prepare('SELECT data FROM controls').all().map(r=>decode(r.data)),
    setControl:(provider,value,actor)=>{const data={...value,provider,updated:Date.now()};db.prepare('INSERT INTO controls VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET data=excluded.data').run(provider,encode(data));db.prepare('INSERT INTO audit VALUES(?,?)').run(randomUUID(),encode({actor,target:provider,action:'apiControl',changes:value,created:Date.now()}));},
    audit:()=>db.prepare('SELECT data FROM audit ORDER BY rowid DESC LIMIT 50').all().map(r=>decode(r.data)),
    toggleLike:(uid,id)=>{
      if(db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(id,uid)) db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(id,uid);
      else db.prepare('INSERT INTO likes VALUES(?,?)').run(id,uid);
    },
    close:()=>db.close()
  };
}
