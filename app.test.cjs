const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {App,parseInput}=require('./app.cjs'),{status,resetRecord,hashPair,openVault}=require('./backend.cjs');
const now=1800000000000,key='TEST-ONLY-ACCOUNT',password='Password-TEST-Only';
const record=()=>({protocol:9,credentialMode:2,enabled:true,maxDevices:1,createdAt:now-5000,expiresAt:now+86400000,devices:{['a'.repeat(64)]:{version:1,claimedAt:now-1000}}});
function fixture(){
 const messages=new Map(),sent=[],calls=[],store=new Map();let mid=100,resetCount=0;
 const tg={async call(method,p){calls.push({method,p});if(method==='deleteMessage'){messages.delete(p.message_id);return true;}if(method==='sendMessage'){messages.set(++mid,p);sent.push(mid);return {message_id:mid};}if(method==='editMessageText'){assert(messages.has(p.message_id));messages.set(p.message_id,p);return true;}return true;}};
 const backend={async lookup(input){return {key,password,hash:hashPair(key,password),record:record(),corrected:input.password&&input.password!==password};},async reset(item,op){resetCount++;return resetRecord(item.record,now,op);}};
 const app=new App(tg,backend,{get:id=>store.get(id),set:(id,v)=>store.set(id,v)},()=>now);
 const message=(text,id=1)=>({message:{message_id:++mid,from:{id},chat:{id,type:'private'},text}});
 const callback=(data,id=1,menu=app.state(id).menuId)=>({callback_query:{id:'callback',from:{id},message:{message_id:menu,chat:{id,type:'private'}},data}});
 return {app,messages,sent,calls,store,backend,message,callback,resets:()=>resetCount};
}
test('parse key, TK|MK, labeled and multiline without leaking separators',()=>{
 for(const raw of [key+' | '+password,key+'\n'+password,'TK: '+key+' | MK: '+password,'Tài khoản: '+key+'\nMật khẩu: '+password])assert.deepEqual(parseInput(raw),{key,password});
 assert.deepEqual(parseInput(key.toLowerCase()),{key,password:undefined});
 for(const raw of ['abc','a|b|c',key+' | '+password+' | extra','/other'])assert.throws(()=>parseInput(raw));
});
test('repeated start, input, navigation and copy buttons keep a single bot message',async()=>{
 const f=fixture();await f.app.handle(f.message('/start'));await f.app.handle(f.message('/start'));
 await f.app.handle(f.callback('lookup'));await f.app.handle(f.message(key+' | '+password));
 assert.equal(f.sent.length,1);assert.equal(f.messages.size,1);
 const view=[...f.messages.values()][0];assert.match(view.text,/đang hoạt động/);
 assert.equal(view.reply_markup.inline_keyboard[0][0].copy_text.text,key);
 assert.equal(view.reply_markup.inline_keyboard[0][1].copy_text.text,password);
 assert(f.calls.filter(x=>x.method==='deleteMessage').length>=3);
});
test('reset requires confirmation; stale and replayed callbacks cannot reset twice',async()=>{
 const f=fixture();await f.app.handle(f.message('/start'));await f.app.handle(f.callback('reset'));
 await f.app.handle(f.message(key));assert.equal(f.resets(),0);
 const nonce=f.app.state(1).confirm.token;await f.app.handle(f.callback('confirm:wrong'));assert.equal(f.resets(),0);
 await f.app.handle(f.callback('confirm:'+nonce));await f.app.handle(f.callback('confirm:'+nonce));
 assert.equal(f.resets(),1);assert.equal(f.messages.size,1);
 assert.match([...f.messages.values()][0].text,/Đã reset/);
});
test('cancel and another chat cannot use the pending confirmation',async()=>{
 const f=fixture();await f.app.handle(f.message('/start'));await f.app.handle(f.callback('reset'));await f.app.handle(f.message(key));
 const token=f.app.state(1).confirm.token;await f.app.handle(f.callback('cancel'));await f.app.handle(f.callback('confirm:'+token));
 await f.app.handle(f.callback('confirm:'+token,2,f.app.state(1).menuId));assert.equal(f.resets(),0);
});
test('only private chat, invalid format cleanup, menu survives process restart',async()=>{
 const f=fixture();await f.app.handle({message:{from:{id:1},chat:{id:-1,type:'group'},text:key,message_id:4}});assert.equal(f.sent.length,0);
 await f.app.handle(f.message('/start'));await f.app.handle(f.message('invalid'));
 const app=new App(f.app.tg,f.backend,f.app.storage,()=>now);await app.handle(f.message('/start'));
 assert.equal(f.sent.length,1);assert.equal(f.messages.size,1);
});
test('reset preserves expiration, schedule and lock policy, caps two per VN day',()=>{
 const r=record(),op='operation_1234567';let n=resetRecord(r,now,op);
 assert.equal(n.expiresAt,r.expiresAt);assert.equal(n.enabled,true);assert(!n.devices);assert(r.devices);
 assert.equal(resetRecord(n,now,op),n);
 n.devices=r.devices;n=resetRecord(n,now+1,'another_operation');n.devices=r.devices;
 assert.throws(()=>resetRecord(n,now+2,'third_operation'),/reset_limit/);
 for(const p of [{enabled:false},{expiresAt:now-1},{lock:{until:0}}])assert.throws(()=>resetRecord({...record(),...p},now,'op'),/unavailable/);
});
test('portal reset increments binding version and shares website daily quota',()=>{
 const r={...record(),portal:{bindingVersion:2,resetHistory:[now-10],lastResetAt:now-10}};
 const n=resetRecord(r,now,'portal_op');assert.equal(n.portal.bindingVersion,3);assert.equal(n.portal.resetHistory.length,2);
 n.devices=r.devices;assert.throws(()=>resetRecord(n,now+1,'new_op'),/reset_limit/);
});
test('vault decryption verifies authentication tag and credentials hash',()=>{
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([c.update(JSON.stringify({key:'TEST',password})),c.final()]);
 const v={v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};
 assert.equal(openVault(v,key).password,password);assert.throws(()=>openVault(v,crypto.randomBytes(32)));
 assert.equal(hashPair('  test-key  ',password),hashPair('TEST-KEY',password));
});
