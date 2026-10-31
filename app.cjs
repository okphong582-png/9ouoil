const crypto=require('node:crypto');
const {status}=require('./backend.cjs');
const escape=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const button=(text,data)=>({text,callback_data:data});
const HOME=[[button('🔑 Key báo đủ thiết bị','lookup')],[button('🔐 Sai tài khoản / mật khẩu','lookup')],[button('♻️ Reset thiết bị của key','reset')]];
function parseInput(raw){
 if(typeof raw!=='string'||raw.length>1024)throw Error('format');
 let text=raw.trim().replace(/^```[^\n]*\n?|```$/g,'').trim();
 const labeled=text.match(/^(?:tk|tài khoản|tai khoan|key|account)\s*:\s*([^\s|]+)\s*(?:\||\n)\s*(?:mk|mật khẩu|mat khau|password|pass)\s*:\s*([^\s|]+)$/i);
 let key,password;if(labeled){[,key,password]=labeled;}else{
 const parts=text.split(/\s*[|｜]\s*|\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(parts.length>2)throw Error('format');[key,password]=parts;
 }
 key=key?.replace(/^[`"']|[`"']$/g,'').trim();password=password?.replace(/^[`"']|[`"']$/g,'').trim();
 if(!/^[!-~]{8,128}$/.test(key||'')||(password!==undefined&&!/^[!-~]{8,128}$/.test(password)))throw Error('format');
 return {key:key.toUpperCase(),password};
}
class App{
 constructor(tg,backend,storage,clock=Date.now){this.tg=tg;this.backend=backend;this.storage=storage;this.clock=clock;this.sessions=new Map();}
 state(id){
  let s=this.sessions.get(id);if(!s){s={menuId:this.storage.get(id)?.menuId||null,phase:'home',at:this.clock(),hits:[]};this.sessions.set(id,s);}
  if(this.clock()-s.at>900000){delete s.item;delete s.confirm;s.phase='home';}s.at=this.clock();
  if(this.sessions.size>2000)for(const [key,value]of this.sessions)if(key!==id&&this.clock()-value.at>900000)this.sessions.delete(key);
  return s;
 }
 async remove(id,message){try{await this.tg.call('deleteMessage',{chat_id:id,message_id:message});return true;}catch{return false;}}
 async render(id,s,text,rows=HOME){
  const p={chat_id:id,text,parse_mode:'HTML',reply_markup:{inline_keyboard:rows}};
  if(s.menuId){try{await this.tg.call('editMessageText',{...p,message_id:s.menuId});return;}catch(e){
   if(/message is not modified/i.test(e.description||''))return;
   const deleted=await this.remove(id,s.menuId);
   if(!deleted&&!/message to edit not found|message can't be edited/i.test(e.description||''))throw e;
  }}
  const message=await this.tg.call('sendMessage',p);s.menuId=message.message_id;
  await this.storage.set(id,{menuId:s.menuId});
 }
 async home(id,s,extra=''){
  delete s.item;delete s.confirm;s.phase='home';
  await this.render(id,s,'<b>SUPPORT MIZZE</b>\n\nChào bạn 👋\nBạn đang cần giúp gì?'+(extra?'\n\n'+extra:''));
 }
 async prompt(id,s,phase){s.phase=phase;delete s.item;delete s.confirm;
  await this.render(id,s,'<b>SUPPORT MIZZE · '+(phase==='reset'?'RESET THIẾT BỊ':'TRA CỨU KEY')+'</b>\n\nGửi key hoặc <code>TK | MK</code>.\nBot sẽ tự tách đúng tài khoản và mật khẩu.\nTin bạn gửi sẽ được xóa khỏi cuộc trò chuyện.',[[button('‹ Về menu','home')]]);
 }
 async details(id,s,notice=''){
  const i=s.item,r=i.record,v=status(r,this.clock());
  const count=Object.keys(r.devices||{}).length;
  const names={active:'✅ Tài khoản / mật khẩu đang hoạt động',pending:'🟡 Key hợp lệ · chưa kích hoạt',expired:'⛔ Key đã hết hạn',disabled:'⛔ Key đã bị khóa',missing:'Không xác định được key'};
  let text='<b>SUPPORT MIZZE · KẾT QUẢ</b>\n\n'+names[v]+'\nThiết bị: '+count+'/'+r.maxDevices;
  if(v==='active')text+='\nHết hạn: '+escape(new Date(r.expiresAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}));
  if(v==='pending')text+='\nHạn bắt đầu từ lần đăng nhập đầu tiên.';
  if(count>=r.maxDevices)text+='\n⚠️ Đã đủ số thiết bị. Nếu đổi máy, chọn reset bên dưới.';
  if(i.corrected)text+='\nMật khẩu bạn gửi chưa đúng; bot đã tìm lại bộ thông tin chính xác.';
  const rows=[];
  if(['active','pending'].includes(v)){
   text+='\n\nTài khoản: <code>'+escape(i.key)+'</code>';
   if(i.password){text+='\nMật khẩu: <code>'+escape(i.password)+'</code>';rows.push([{text:'📋 Copy tài khoản',copy_text:{text:i.key}},{text:'📋 Copy mật khẩu',copy_text:{text:i.password}}]);}
   else text+='\nChưa mở được mật khẩu của key này. Hãy gửi <code>TK | MK</code> để kiểm tra.';
   rows.push([button('♻️ Reset thiết bị','request_reset')]);
  }
  if(notice)text+='\n\n'+escape(notice);
  rows.push([button('Tra key khác','lookup'),button('‹ Menu','home')]);
  s.phase='details';await this.render(id,s,text,rows);
 }
 async confirm(id,s){
  if(!s.item)return this.prompt(id,s,'reset');
  if(!['active','pending'].includes(status(s.item.record,this.clock())))return this.details(id,s,'Key không còn hiệu lực, không thể reset.');
  s.confirm={token:crypto.randomBytes(12).toString('hex'),until:this.clock()+120000};
  await this.render(id,s,'<b>BẠN MUỐN RESET KEY NÀY KHÔNG?</b>\n\nTài khoản: <code>'+escape(s.item.key)+'</code>\nGỡ tất cả thiết bị đang liên kết.\nGiữ nguyên mật khẩu và hạn key.\nTối đa 2 lần/ngày.',[[button('✅ Có, reset ngay','confirm:'+s.confirm.token)],[button('Không, quay lại','cancel')]]);
 }
 async handle(update){
  const q=update.callback_query,m=update.message||update.edited_message;
  const chat=q?.message?.chat||m?.chat,id=chat?.id;
  if(!chat||chat.type!=='private'||(q?q.from.id:m.from?.id)!==id)return;
  const s=this.state(id);
  if(q){
   await this.tg.call('answerCallbackQuery',{callback_query_id:q.id}).catch(()=>{});
   if(q.message.message_id!==s.menuId)return;
   if(q.data==='home')return this.home(id,s);
   if(q.data==='lookup'||q.data==='reset')return this.prompt(id,s,q.data);
   if(q.data==='request_reset')return this.confirm(id,s);
   if(q.data==='cancel'){delete s.confirm;return s.item?this.details(id,s):this.home(id,s);}
   if(q.data?.startsWith('confirm:')){
    if(!s.confirm||s.confirm.until<this.clock()||q.data!=='confirm:'+s.confirm.token)return;
    const operation=s.confirm.token;delete s.confirm;
    try{s.item.record=await this.backend.reset(s.item,operation);return this.details(id,s,'✅ Đã reset thiết bị. Mở lại menu game và đăng nhập bằng tài khoản/mật khẩu này.');}
    catch(e){const messages={reset_limit:'Bạn đã dùng hết 2 lượt reset hôm nay.',no_devices:'Key chưa có thiết bị cần reset.',unavailable:'Key đã hết hạn hoặc bị khóa.',conflict:'Key vừa thay đổi. Hãy tra cứu lại.'};return this.details(id,s,messages[e.message]||'Chưa reset được do lỗi kết nối. Vui lòng thử lại.');}
   }
   return;
  }
  await this.remove(id,m.message_id);
  if(/^\/start(?:@\w+)?(?:\s|$)/.test(m.text||''))return this.home(id,s);
  s.hits=s.hits.filter(t=>t>this.clock()-60000);
  if(s.hits.length>=8)return this.render(id,s,'Bạn thao tác quá nhanh. Hãy chờ một phút.',[[button('‹ Menu','home')]]);
  if(!m.text)return this.render(id,s,'Hãy gửi key hoặc <code>TK | MK</code>.',[[button('‹ Menu','home')]]);
  let input;try{input=parseInput(m.text);}catch{return this.render(id,s,'Chưa đọc được thông tin. Gửi theo mẫu <code>TK | MK</code> hoặc chỉ gửi key.',[[button('‹ Menu','home')]]);}
  s.hits.push(this.clock());const phase=s.phase;
  try{
   const item=await this.backend.lookup(input);
   if(!item){delete s.item;return this.render(id,s,'Không tìm thấy bộ thông tin này. Kiểm tra lại hoặc gửi đủ <code>TK | MK</code>.',[[button('‹ Menu','home')]]);}
   s.item=item;delete s.confirm;
   return phase==='reset'?this.confirm(id,s):this.details(id,s);
  }catch{return this.render(id,s,'Hệ thống key đang mất kết nối. Hãy thử lại sau.',[[button('Thử lại','lookup'),button('‹ Menu','home')]]);}
 }
}
module.exports={App,parseInput};
