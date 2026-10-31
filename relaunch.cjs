(async()=>{
 const response=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/actions/workflows/support.yml/dispatches',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,'Content-Type':'application/json',Accept:'application/vnd.github+json'},body:JSON.stringify({ref:process.env.GITHUB_REF_NAME||'main'}),signal:AbortSignal.timeout(20000)});
 if(response.status!==204)throw Error('dispatch_http_'+response.status);console.log('Next worker requested.');
})().catch(()=>{console.error('Could not dispatch next worker; hourly scheduler will retry.');process.exitCode=1;});
