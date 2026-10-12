#!/usr/bin/env python3
"""Prepare the selected MCC source edition and its one retained native operation."""
import argparse,ast,fcntl,hashlib,json,os,subprocess,sys,tempfile,zipfile
from pathlib import Path,PurePosixPath
from delivery import read_delivery

OP='LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012'
REF='2e666ad2e63db286c97d7f1a33e16249c043dfa0'
BASELINE_REF='8505a3ec99d584261754a2edcfca4113766dcc5b'
DOSSIER='8458167af2e1fb03420042b095d03f10c326185f'
PREFIX='stellar/scf-starforge-20261009/partners/lgndx-opportunity-operations'
BASE={'bytes':233798,'sha256':'ec7b4967fc62ae3c30fb703b01bb1c91fcfffd6ad24c143f8f59854084a13596'}
UPDATE={'bytes':896542,'sha256':'f2156f48c784568a56b1eef853e6a717a3f90d09c65f9695fbaceb44e6034d61'}
HANDOFF={'bytes':5739854,'sha256':'7218fc1adb8e647bb90ce2a92a27ad1e96c42195b18020cf8347d0e4db939cfc'}
PORTABLE={'member':'handoff/current-receiving-portable.json','bytes':14822528,
          'sha256':'9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140'}
PROGRAM=('prepare.py','delivery.py','receive.mjs','run_native.py','launch.py','source-overlay.json','README.md')
sha=lambda value:hashlib.sha256(value).hexdigest()
git=lambda value:hashlib.sha1(b'blob '+str(len(value)).encode()+b'\0'+value).hexdigest()

def checked(path,identity):
 if path.is_symlink() or not path.is_file():raise RuntimeError('An ordinary selected input is required: '+path.name)
 body=path.read_bytes()
 if len(body)!=identity['bytes'] or sha(body)!=identity['sha256']:
  raise RuntimeError('The selected original input changed: '+path.name)
 return body

def put(path,body):
 if path.is_symlink():raise RuntimeError('An owned output cannot be a symlink: '+path.name)
 if path.exists():
  if not path.is_file() or path.read_bytes()!=body:
   raise RuntimeError('The retained operation already contains a different selection: '+path.name)
  return
 fd,name=tempfile.mkstemp(prefix='.mcc-selected-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
  os.link(name,path)
  directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  if os.path.exists(name):os.unlink(name)

def safe_relative(value):
 path=PurePosixPath(value)
 if path.is_absolute() or '..' in path.parts or not path.parts or str(path)!=value:
  raise RuntimeError('The selected source member path changed')
 return path

def disjoint(a,b):
 return a!=b and a not in b.parents and b not in a.parents

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 for name in ('operation-root','node','controller-host','private-root'):
  parser.add_argument('--'+name,required=True,type=Path)
 parser.add_argument('--delivery-kit',type=Path,
  help='the exact completed LGNDX customer kit, carrying the source and revision-133 portable together')
 parser.add_argument('--baseline-source',type=Path)
 parser.add_argument('--baseline-handoff',type=Path)
 parser.add_argument('--project-update',type=Path,
  default=Path(__file__).resolve().parent/'inputs'/'project-update.json',
  help='the fixed issued-source input; defaults to the complete packet shipped with this programme')
 for name in ('memory-reservations-root','disk-reservations-root','worker-root'):
  parser.add_argument('--'+name,type=Path)
 parser.add_argument('--launch',action='store_true',help='start/reopen this exact native record after selection')
 args=parser.parse_args()
 os.umask(0o077)
 own=Path(__file__).resolve().parent
 root=args.operation_root.resolve();private=args.private_root.resolve()
 update=args.project_update.resolve()
 if args.delivery_kit is not None:
  if args.baseline_source is not None or args.baseline_handoff is not None:
   raise RuntimeError('Select either the completed delivery or the original source/handoff pair')
  handoff=args.delivery_kit.resolve();base=None;baseline_inputs=(handoff,)
 else:
  if args.baseline_source is None or args.baseline_handoff is None:
   raise RuntimeError('Select --delivery-kit or both --baseline-source and --baseline-handoff')
  base=args.baseline_source.resolve();handoff=args.baseline_handoff.resolve();baseline_inputs=(base,handoff)
 node=args.node.resolve();host=args.controller_host.resolve()
 if root==Path('/') or private==Path('/') or not disjoint(root,private) or not disjoint(root,own):
  raise RuntimeError('Source, retained operation and private working directories must be separate')
 for protected in (own,update,node,host)+baseline_inputs:
  if not disjoint(private,protected):
   raise RuntimeError('The private working directory overlaps a selected original input')
 if not node.is_file() or not os.access(node,os.X_OK):raise RuntimeError('The selected Node executable is unavailable')
 if not (host/'native_foreground.py').is_file():raise RuntimeError('The selected original native controller is unavailable')
 checked(update,UPDATE)
 prepared=json.loads(update.read_text())
 if (prepared.get('operation')!=OP or prepared.get('baselineRevision')!=133
     or prepared.get('projectId')!='opp_c414e4b0-302f-0005-bda6-cb8906d7a644'):
  raise RuntimeError('The prepared MCC project or baseline changed')
 delivery=None
 if args.delivery_kit is not None:
  delivery=read_delivery(handoff)
  manifest=delivery['manifest'];files=delivery['files']
  handoff_identity=delivery['handoff'];portable_identity=delivery['portable']
 else:
  checked(base,BASE);checked(handoff,HANDOFF)
  with zipfile.ZipFile(handoff) as archive:
   portable=archive.read(PORTABLE['member'])
  if len(portable)!=PORTABLE['bytes'] or sha(portable)!=PORTABLE['sha256']:
   raise RuntimeError('The original revision-133 portable changed')
  del portable
  files={}
  with zipfile.ZipFile(base) as archive:
   manifest=json.loads(archive.read('SOURCE_MANIFEST.json'))
   for item in manifest['files']:
    path=str(safe_relative(item['path']))
    if path in files:raise RuntimeError('A selected source path is duplicated')
    body=archive.read('source/'+path)
    if len(body)!=item['bytes'] or sha(body)!=item['sha256'] or git(body)!=item['git_blob']:
     raise RuntimeError('The original source identity changed: '+path)
    files[path]=body
  handoff_identity={'path':str(handoff),**HANDOFF};portable_identity=dict(PORTABLE)
 if len(files)!=36:raise RuntimeError('The original source closure is incomplete')
 overlay=json.loads((own/'source-overlay.json').read_text())
 if not isinstance(overlay,dict) or overlay.get('source_ref')!=REF or not isinstance(overlay.get('files'),list):
  raise RuntimeError('The exact current MCC source envelope changed')
 overlays=overlay['files']
 required={PREFIX+'/references/issued-source-review/'+name for name in
           ('README.md','apply_issued_review.mjs','issued-inputs.json','prepare_issued_review.py','review-edits.json')}
 required.add('stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/dossier.mjs')
 if len(overlays)!=6 or {item['path'] for item in overlays}!=required:
  raise RuntimeError('The exact current MCC source selection is incomplete')
 for item in overlays:
  path=str(safe_relative(item['path']));body=item['content'].encode('utf-8')
  if git(body)!=item['git_blob']:raise RuntimeError('A selected source overlay changed: '+path)
  files[path]=body
 if len(files)!=41:raise RuntimeError('The complete current source edition must contain 41 files')
 manifest.update(sourceRef=REF,publishedSourceRef=REF,
                 sourceUrl='https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/'+REF+'/'+PREFIX,
                 sourceFiles=len(files),sourceBytes=sum(map(len,files.values())))
 manifest['files']=[{'path':path,'bytes':len(body),'sha256':sha(body),'git_blob':git(body)}
                    for path,body in sorted(files.items())]
 manifest['issuedSourceEdition']={'operation':OP,'sourceRef':REF,'dossierGitBlob':DOSSIER,
                                 'baselineSourceRef':BASELINE_REF,'baselineArchiveSha256':BASE['sha256']}
 if delivery is not None:
  manifest['issuedSourceEdition']['baselineDelivery']=delivery['source_receipt']
 root.mkdir(mode=0o700,parents=True,exist_ok=True)
 with (root/'preparation.lock').open('a+b') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  program=[]
  for name in PROGRAM:
   body=(own/name).read_bytes()
   if name.endswith('.py'):ast.parse(body.decode('utf-8'),filename=name)
   put(root/name,body)
   program.append({'filename':name,'bytes':len(body),'sha256':sha(body),'git_blob':git(body)})
  fd,name=tempfile.mkstemp(prefix='.mcc-complete-source-',suffix='.zip',dir=root);os.close(fd)
  try:
   with zipfile.ZipFile(name,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    members={'SOURCE_MANIFEST.json':(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()}
    members.update({'source/'+path:body for path,body in files.items()})
    for path,body in sorted(members.items()):
     info=zipfile.ZipInfo(path,date_time=(1980,1,1,0,0,0))
     info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(0o100644<<16)
     archive.writestr(info,body,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
   source=Path(name).read_bytes();put(root/'source.zip',source)
  finally:
   if os.path.exists(name):os.unlink(name)
  driver=next(item for item in program if item['filename']=='receive.mjs')
  selection={'schema':'stellar-forge.mcc-native-selection.v1','operation':OP,'source_ref':REF,
   'source_archive':{'filename':'source.zip','bytes':len(source),'sha256':sha(source)},
   'driver':driver,'program':program,'node':str(node),'controller_host':str(host),'private_root':str(private),
   'project_update':{'path':str(update),**UPDATE},'baseline_handoff':handoff_identity,
   'baseline_portable':portable_identity}
  for field in ('memory_reservations_root','disk_reservations_root','worker_root'):
   value=getattr(args,field)
   if value is not None:selection[field]=str(value.resolve())
  subprocess.run([str(node),'--check',str(root/'receive.mjs')],check=True)
  put(root/'selection.json',(json.dumps(selection,sort_keys=True,indent=2)+'\n').encode())
  print(json.dumps({'stage':'mcc_complete_source_selected','operation':OP,'source_ref':REF,
   'source_files':41,'source_bytes':manifest['sourceBytes'],'source_archive':selection['source_archive'],
   'baseline_revision':133,'prepared_actions':74,'original_api_calls':88,'expected_revision':221,
   'selection_sha256':sha((root/'selection.json').read_bytes()),'driver':driver}),flush=True)
 if args.launch:os.execv(sys.executable,[sys.executable,'-B',str(root/'launch.py')])

if __name__=='__main__':
 try:main()
 except (OSError,ValueError,RuntimeError,zipfile.BadZipFile) as error:
  print(json.dumps({'operation':OP,'error':type(error).__name__,'message':str(error)[:500]}),file=sys.stderr)
  raise SystemExit(1)
