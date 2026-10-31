// Firebase transactions may first receive null even for an existing record.
// Returning null forces a server comparison/retry; undefined aborts locally.
async function renewLease(ref,owner,now=Date.now()){
 const result=await ref.transaction(old=>old===null?null:old.owner===owner?{owner,until:now+90000}:undefined);
 const value=result.snapshot.val();
 return result.committed&&value?.owner===owner&&value.until>now;
}
async function releaseLease(ref,owner){
 return ref.transaction(old=>old===null?null:old.owner===owner?null:undefined);
}
module.exports={renewLease,releaseLease};
