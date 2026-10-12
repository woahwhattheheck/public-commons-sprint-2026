# MIT. The original source receiver followed by the selected maintained STAC operation.
from pathlib import Path
import hashlib,json,os,shutil,subprocess,sys

base=Path(__file__).resolve().parent
selected=json.loads((base/'native-input.json').read_text())
project=Path(selected['projectDirectory'])
delivery=project/'delivery'
project.mkdir(mode=0o700,parents=True,exist_ok=True)
delivery.mkdir(mode=0o700,exist_ok=True)
code=base/'operation-code'
builder=Path(selected['builderDirectory'])
cache=Path(selected['sourceCache']).parent
metadata=code/'source-7169.json'
content=metadata.read_bytes()
source_metadata=json.loads(content)
if hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()!='56da861934c0a161c8ab76b64a17c2a9b421d557':
    raise ValueError('Preserve changed original source metadata')
command=[sys.executable,'-B',str(builder/'git-object-receiving.py'),
    '--metadata',str(metadata),'--commit',selected['sourceCommit'],'--directory',str(cache)]
donors=[
 ('--donor-repository','/workspace/scratch/99d0e4920ad7/scf-applications/source.git'),
 ('--donor-repository','/workspace/scratch/7108267765ab/fiscal-applications-native/source-10f5/cache/repository.git'),
 ('--donor-source','/workspace/scratch/99d0e4920ad7/scf-applications/source'),
 ('--donor-source','/workspace/scratch/84ebf86ab95a/native-merchant-application-84eb/runtime-c287/source'),
 ('--incoming',str(base/'incoming'))
]
for flag,directory in donors:
    if Path(directory).is_dir():command += [flag,directory]
additional=set()
outcome=1
try:
    while True:
        result=subprocess.run(command+[value for name in sorted(additional) for value in ('--additional-path',name)])
        if result.returncode:
            outcome=result.returncode
            break
        result=subprocess.run(['node',str(code/'continue-stac-applications.mjs'),str(base/'native-input.json')])
        outcome=result.returncode
        if not outcome:break
        error=project/'continuation-error.json'
        if not error.is_file():break
        receipt=json.loads(error.read_text())
        if receipt.get('stage')!='SOURCE' or not receipt.get('missingObjects'):break
        missing={item for item in receipt['missingObjects'] if isinstance(item,str)}
        needed={row['path'] for row in source_metadata['tree']['tree'] if row.get('type')=='blob' and row.get('sha') in missing}
        if not needed-additional:break
        additional.update(needed)
finally:
    for name in ['source-receiving.json','missing-objects.json']:
        path=cache/name
        if path.is_file():shutil.copy2(path,delivery/name)
    for name in ['native-input.json','receive-and-continue.py','launch-native.py']:
        path=base/name
        if path.is_file():shutil.copy2(path,delivery/name)
    if not (project/'source-release.json').is_file() and cache.is_dir():
        shutil.copytree(cache,delivery/'source-cache',dirs_exist_ok=True)
    (delivery/'native-continuation-exit.json').write_text(json.dumps({
        'operationId':selected['operationId'],'sourceCommit':selected['sourceCommit'],
        'exitCode':outcome,'additionalOriginalSourcePaths':sorted(additional)
    },indent=2)+'\n')
    (delivery/'native-continuation-exit.json').chmod(0o600)
raise SystemExit(outcome)
