from pathlib import Path
import datetime,hashlib,json,sys,zipfile
value=json.loads(sys.stdin.read());blob=json.dumps(value['record'],ensure_ascii=False,sort_keys=True).encode()
name='firebase/'+value['project']+'/licensesV9/'+value['hash']+'.json'
target=Path(sys.argv[1])/('Support-Mizze-before-reset-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.zip')
digest=hashlib.sha256(blob).hexdigest()
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as z:
 z.writestr(name,blob);z.writestr('BACKUP-SHA256.json',json.dumps({name:digest}))
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None and hashlib.sha256(z.read(name)).hexdigest()==digest
