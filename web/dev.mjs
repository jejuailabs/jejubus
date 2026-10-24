import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createStore} from './lib/store.mjs';
import {createApp} from './server.mjs';

let store;
if(process.env.DATABASE_PROVIDER!=='firestore'){
  const directory=join(dirname(fileURLToPath(import.meta.url)),'data');
  await mkdir(directory,{recursive:true});
  store=createStore(join(directory,'jejubus.sqlite'),{seed:process.env.SHOW_SAMPLE_POSTS==='true'});
}
const app=await createApp({store});
app.server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`Jeju Bus ready: ${app.config.origin}`));
const close=()=>app.server.close(async()=>{await app.store.close();process.exit(0);});
process.on('SIGTERM',close);process.on('SIGINT',close);
