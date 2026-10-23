import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
async function files(directory){const list=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==='vendor')continue;const path=join(directory,entry.name);if(entry.isDirectory())list.push(...await files(path));else if(/\.(?:m?js)$/.test(entry.name))list.push(path);}return list;}
const paths=['server.mjs',...await files('lib'),...await files('public'),...await files('test')];
for(const path of paths){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checked ${paths.length} files.`);
