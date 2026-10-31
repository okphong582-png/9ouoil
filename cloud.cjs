const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {App}=require('./app.cjs'),{configured}=require('./backend.cjs');
const {renewLease,releaseLease}=require('./lease.cjs');
const cfg=process.env.TELEGRAM_BOT_TOKEN?{token:process.env.TELEGRAM_BOT_TOKEN}:JSON.parse(fs.readFileSync(path.join(__dirname,'.private/config.json'),'utf8'));
class ApiError extends Error{constructor(data){super('telegram_api_'+data.error_code);this.code=data.error_code;this.description=data.description||'';this.retry=data.parameters?.retry_after;}}
class Telegram{
 async call(method,data={}){
  const response=await fetch('https://api.telegram.org/bot'+cfg.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(method==='getUpdates'?55000:20000)});
  const result=await response.json();if(!result.ok)throw new ApiError(result);return result.result;
 }
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const tg=new Telegram(),me=await tg.call('getMe'),backend=configured(cfg);
 if(process.argv.includes('--check')){
  for(const source of backend.sources)await source.db.ref('licensesV9').limitToFirst(1).get();
  console.log(JSON.stringify({ok:true,username:me.username,keyDatabases:backend.sources.length,vaultKeyAvailable:backend.vaultKey.length===32}));process.exit(0);
 }
 const db=backend.sources[0].db,root=db.ref('_mizzeSupportV1'),owner=crypto.randomUUID(),lease=root.child('lease');
 const acquired=await lease.transaction(old=>!old||old.until<Date.now()?{owner,until:Date.now()+90000}:undefined);
 if(!acquired.committed){console.log('{"event":"another_worker_active"}');process.exit(0);}
 let stop=false;
 const release=async()=>{await releaseLease(lease,owner).catch(()=>{});};
 let lastRenewed=Date.now(),renewing=false;
 const renew=setInterval(async()=>{
  if(renewing)return;renewing=true;
  try{
   if(!await renewLease(lease,owner)){console.log('{"event":"lease_lost"}');process.exit(2);}
   lastRenewed=Date.now();console.log('{"event":"lease_renewed"}');
  }catch{console.log('{"event":"lease_network_retry"}');if(Date.now()-lastRenewed>70000)process.exit(2);}
  finally{renewing=false;}
 },20000);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop=true;});
 const states=new Map();
 const storage={get:id=>states.get(id),async set(id,value){await root.child('chats/'+id).set(value);states.set(id,value);}};
 const app=new App(tg,backend,storage);
 try{
  await tg.call('deleteWebhook',{drop_pending_updates:false});
  await tg.call('setMyCommands',{commands:[{command:'start',description:'Mở menu hỗ trợ Mizze'}]});
  await tg.call('setMyDescription',{description:'Support Mizze · Tra cứu key, hỗ trợ tài khoản/mật khẩu và reset thiết bị. Gửi /start để mở menu.'});
  const offsetRef=root.child('offset');let offset=(await offsetRef.get()).val()||0;
  const until=Date.now()+(Number(process.env.RUN_SECONDS)||18000)*1000;
  console.log(JSON.stringify({event:'ready',username:me.username}));let failures=0;
  while(!stop&&Date.now()<until){try{
   const updates=await tg.call('getUpdates',{offset,timeout:40,limit:30,allowed_updates:['message','edited_message','callback_query']});
   for(const u of updates){
    const chat=u.callback_query?.message?.chat||u.message?.chat||u.edited_message?.chat;
    if(chat?.type==='private'&&!states.has(chat.id))states.set(chat.id,(await root.child('chats/'+chat.id).get()).val());
    await app.handle(u);offset=u.update_id+1;await offsetRef.set(offset);
   }failures=0;
  }catch(e){failures++;console.log(JSON.stringify({event:'retry',code:e.code||'network_or_storage',attempt:Math.min(failures,10)}));
   if(e.code===409)throw Error('another_poller');
   await pause(Math.min(60000,(e.retry||Math.min(30,2**Math.min(failures,5)))*1000));
  }}
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'relaunch=true\n');
 }finally{clearInterval(renew);await release();}
 process.exit(0);
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({event:'stopped',reason:e.message==='another_poller'?'another_poller':'configuration_or_connection'}));process.exitCode=1;setTimeout(()=>process.exit(1),1000).unref();});
module.exports={Telegram};
