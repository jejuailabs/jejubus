import {createApp} from '../web/server.mjs';

let pending;
export default async function handler(req,res){
  try{
    const url=new URL(req.url,'http://internal');
    if(url.searchParams.has('__jeju_path')){
      const path=url.searchParams.get('__jeju_path');url.searchParams.delete('__jeju_path');
      req.url=`/${path.replace(/^\/+/, '')}${url.searchParams.size?'?'+url.searchParams:''}`;
    }
    pending??=createApp({env:process.env,settingsFile:null});
    const app=await pending;
    return app.handler(req,res);
  }catch{
    pending=null;
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'databaseConfigurationRequired'}));
  }
}
