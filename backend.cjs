const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const hashPair=(key,password)=>crypto.createHash('sha256').update(`mizze-pair-v1\n${key.trim().toUpperCase().length}:${key.trim().toUpperCase()}\n${password.length}:${password}`).digest('hex');
const dayStart=now=>Math.floor((now+25200000)/86400000)*86400000-25200000;
function status(r,now=Date.now()){
 if(!r||r.protocol!==9||![2,3].includes(r.credentialMode)||!Number.isSafeInteger(r.maxDevices)||r.maxDevices<1)return 'missing';
 if(!r.enabled||(r.lock&&(r.lock.until===0||r.lock.until>now)))return 'disabled';
 if(r.timeMode==='firstUse'&&r.activatedAt===0&&r.expiresAt===0)return 'pending';
 return Number.isSafeInteger(r.expiresAt)&&r.expiresAt>now?'active':'expired';
}
function resetRecord(r,now,operation){
 if(!['active','pending'].includes(status(r,now)))throw Error('unavailable');
 if(r.supportReset?.operations?.[operation])return r;
 if(!Object.keys(r.devices||{}).length)throw Error('no_devices');
 const history=[...(r.portal?.resetHistory||[]),...(r.portal?[]:r.supportReset?.history||[])].filter(t=>t>=dayStart(now)&&t<=now);
 if(history.length>=2)throw Error('reset_limit');
 const n=structuredClone(r);delete n.devices;
 if(n.portal){n.portal.bindingVersion++;n.portal.resetHistory=[...history,now];n.portal.lastResetAt=now;}
 const ops=Object.entries(n.supportReset?.operations||{}).slice(-15);
 n.supportReset={history:[...history,now],operations:{...Object.fromEntries(ops),[operation]:now}};
 return n;
}
function openVault(v,key){
 if(v?.v!==1||key.length!==32)throw Error('vault_unavailable');
 const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(v.iv,'base64'));d.setAuthTag(Buffer.from(v.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data,'base64')),d.final()]).toString());
}
class Backend{
 constructor(sources,vaultKey,backup){this.sources=sources;this.vaultKey=vaultKey;this.backup=backup;}
 async lookup(input){
  const key=input.key.toUpperCase();
  for(const source of this.sources){
   if(input.password){const hash=hashPair(key,input.password),r=(await source.db.ref('licensesV9/'+hash).get()).val();
    if(r)return {source,hash,record:r,key,password:input.password,corrected:false};}
   let all;try{all=(await source.db.ref('licenseAdminV9').orderByChild('key').equalTo(key).limitToFirst(2).get()).val()||{};}
   catch(e){if(!/index not defined|no index defined/i.test(String(e.message)))throw e;
    all=(await source.db.ref('licenseAdminV9').get()).val()||{};}
   for(const [hash,m] of Object.entries(all)){
    if(!/^[a-f0-9]{64}$/.test(hash)||String(m.key).toUpperCase()!==key)continue;
    const record=(await source.db.ref('licensesV9/'+hash).get()).val();if(!record)continue;
    let pair;try{pair=openVault(m.vault,this.vaultKey);}catch{}
    if(pair&&pair.key.toUpperCase()===key&&hashPair(key,pair.password)===hash)
     return {source,hash,record,key:pair.key,password:pair.password,corrected:!!input.password&&pair.password!==input.password};
    return {source,hash,record,key,password:null,corrected:false};
   }
  }
  return null;
 }
 async reset(item,operation){
  const ref=item.source.db.ref('licensesV9/'+item.hash);
  for(let attempt=0;attempt<3;attempt++){
   const old=(await ref.get()).val();const next=resetRecord(old,Date.now(),operation);
   if(next===old)return old;
   await this.backup(item.source.name,item.hash,old);
   const before=JSON.stringify(old);let failure;
   const result=await ref.transaction(value=>{
    if(value===null)return null;
    if(JSON.stringify(value)!==before)return;
    try{return resetRecord(value,Date.now(),operation);}catch(e){failure=e.message;return;}
   });
   if(result.committed&&result.snapshot.val())return result.snapshot.val();
   if(failure)throw Error(failure);
  }
  throw Error('conflict');
 }
}
function configured(cfg){
 const root=cfg.workspace,load=createRequire(root?path.join(root,'web-key-vercel/package.json'):path.join(__dirname,'package.json'));
 const {initializeApp,cert}=load('firebase-admin/app'),{getDatabase}=load('firebase-admin/database');
 const values=process.env.FIREBASE_CONFIG_JSON?JSON.parse(process.env.FIREBASE_CONFIG_JSON):JSON.parse(fs.readFileSync(cfg.firebaseConfig,'utf8').replace(/^\uFEFF/,''));
 const sources=[];for(const prefix of ['LEGACY_','']){
  if(!values[prefix+'FIREBASE_SERVICE_ACCOUNT_JSON'])continue;
  const a=JSON.parse(values[prefix+'FIREBASE_SERVICE_ACCOUNT_JSON']);
  if(a.type!=='service_account'||a.token_uri!=='https://oauth2.googleapis.com/token')throw Error('firebase_config');
  if(sources.some(s=>s.name===a.project_id))continue;
  const db=getDatabase(initializeApp({credential:cert(a),databaseURL:values[prefix+'FIREBASE_DATABASE_URL']},'support-'+a.project_id));
  sources.push({name:a.project_id,db});
 }
 const vault=Buffer.from(process.env.BOT_VAULT_KEY||fs.readFileSync(cfg.vaultKeyFile,'utf8').trim(),'base64');
 return new Backend(sources,vault,async(project,hash,record)=>{
  if(!cfg.workspace){
   const data=JSON.stringify(record),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',vault,iv);
   const body=Buffer.concat([c.update(data),c.final()]);
   const backup={v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:body.toString('base64')};
   const ref=sources.find(s=>s.name===project).db.ref('_mizzeSupportV1/backups').push();
   await ref.set({hash,at:Date.now(),vault:backup});
   const saved=(await ref.get()).val();if(JSON.stringify(openVault(saved.vault,vault))!==data)throw Error('backup_verification');
   return;
  }
  execFileSync(cfg.python,[path.join(__dirname,'backup_reset.py'),cfg.backupRoot],{input:JSON.stringify({project,hash,record}),stdio:['pipe','ignore','pipe'],windowsHide:true});
 });
}
module.exports={Backend,configured,hashPair,status,resetRecord,openVault,dayStart};
