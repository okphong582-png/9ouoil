const test=require('node:test'),assert=require('node:assert/strict');
const {renewLease,releaseLease}=require('./lease.cjs');
function ref(record){return {record,async transaction(fn){
 const cold=fn(null);if(cold===undefined)return {committed:false,snapshot:{val:()=>this.record}};
 const next=fn(this.record);if(next===undefined)return {committed:false,snapshot:{val:()=>this.record}};
 this.record=next;return {committed:true,snapshot:{val:()=>this.record}};
}};}
test('repeated cold-cache renewals keep the same owner alive',async()=>{
 const r=ref({owner:'mine',until:100000});
 for(let now=20000;now<=300000;now+=20000){assert(await renewLease(r,'mine',now));assert.equal(r.record.until,now+90000);}
});
test('another worker lease is never renewed or released',async()=>{
 const r=ref({owner:'another',until:100000}),original=structuredClone(r.record);
 assert.equal(await renewLease(r,'mine',20000),false);await releaseLease(r,'mine');assert.deepEqual(r.record,original);
});
test('a genuinely missing lease is not mistaken for successful renewal',async()=>{
 assert.equal(await renewLease(ref(null),'mine',20000),false);
});
test('cold-cache release removes only the owned record',async()=>{
 const r=ref({owner:'mine',until:100000});await releaseLease(r,'mine');assert.equal(r.record,null);
});
