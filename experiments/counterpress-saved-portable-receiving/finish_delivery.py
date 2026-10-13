#!/usr/bin/env python3
"""Finish the original Counterpress recipient edition and save the same product."""
import argparse,fcntl,hashlib,html,json,os,pathlib,shutil,stat,subprocess,sys,zipfile

BASE=pathlib.Path('/dev/shm/counterpress-lossless-handoff-5403')
OUT=BASE/'output'
APP=BASE/'receiving-application-portable-v1'
RECEIVE=BASE/'recipient'
CAPTURE=BASE/'recording-from-portable-v1'
HISTORICAL_CHECKPOINT='68162016dbeeb03156066a862dd71890f48738813cfbfcf05f3e5e701a1e1070'
HELPERS=pathlib.Path('/workspace/scratch/5403360e55a4/library-helpers-current')
BROWSER_LOCK=pathlib.Path('/workspace/scratch/5403360e55a4/wingard-provider-native-20261012/receiving.lock')
NODE='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
CHROMIUM='/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium'
PLAYWRIGHT='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
ZIP_NAME='Counterpress_Compass_Recorded_Demo_and_Editable_Product.zip'
MP4_NAME='Counterpress_Compass_Running_Demo.mp4'

def emit(value): print(json.dumps(value),flush=True)
def read(path): return json.loads(path.read_text())
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def stable(path,value):
 raw=value if isinstance(value,bytes) else (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():
  if path.read_bytes()!=raw:raise RuntimeError('Retained value differs: '+str(path))
  return
 temporary=path.with_name(path.name+'.writing-'+str(os.getpid()))
 with temporary.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 try:
  try:os.link(temporary,path)
  except FileExistsError:
   if path.read_bytes()!=raw:raise RuntimeError('Concurrent retained value differs: '+str(path))
 finally:temporary.unlink(missing_ok=True)
def safe_relative(value):
 p=pathlib.PurePosixPath(value)
 if p.is_absolute() or '..' in p.parts or not p.parts:raise RuntimeError('Invalid portable member')
 return p.as_posix()

def original_portable():
 initial=read(OUT/'RESULT.json')
 selected=OUT/'original-copy-v0.zip'
 if not selected.exists():selected=OUT/ZIP_NAME
 if (initial['portable']['sha256']!='61c29d3f7654ea868089493373b45bea1acece3f963a0070ad3bba9715b2bd15'
     or selected.stat().st_size!=40333759 or sha(selected)!=initial['portable']['sha256']):
  raise RuntimeError('The original saved 300-member portable is required')
 return selected,initial

def prepare_portable_capture():
 import re
 selected,initial=original_portable()
 proof=read(OUT/'H264_RESULT.json')
 if (proof.get('complete') is not True or proof.get('capturedCheckpointSha256')!=HISTORICAL_CHECKPOINT
     or proof.get('originalCaptureSeconds')!=112.018194305
     or proof.get('originalVideo',{}).get('sha256')!='876ec0e3b9b6e7e162bf9350ee318e5400c06e34331d69c6219f7ab7d23cdcc7'):
  raise RuntimeError('The original movie proof differs')
 movie=OUT/'handover/Recording'/MP4_NAME
 if (movie.stat().st_size!=proof['video']['bytes'] or sha(movie)!=proof['video']['sha256']
     or proof['video']['sha256']!='3733a0e64b32df5be1e6e2c44f2a529862f21e67c63313d115d9be8f36e2c525'):
  raise RuntimeError('The existing complete H.264 movie differs')
 with zipfile.ZipFile(selected) as archive:
  names=archive.namelist()
  if len(names)!=300 or len(set(names))!=300:raise RuntimeError('Original portable membership differs')
  for info in archive.infolist():
   if safe_relative(info.filename)!=info.filename or info.is_dir() or stat.S_ISLNK(info.external_attr>>16):
    raise RuntimeError('Unexpected original portable member')
  manifest=json.loads(archive.read('MANIFEST.json'))
  rows=manifest.get('members',[])
  if (manifest.get('schema')!='counterpress.recorded-handover.v1' or manifest.get('complete') is not True
      or len(rows)!=299 or {r['path'] for r in rows}!={n for n in names if n!='MANIFEST.json'}):
   raise RuntimeError('The original full member manifest differs')
  inventory={}
  for row in rows:
   name=safe_relative(row['path'])
   h=hashlib.sha256();size=0
   with archive.open(name) as stream:
    for block in iter(lambda:stream.read(1024*1024),b''):h.update(block);size+=len(block)
   if h.hexdigest()!=row['sha256'] or size!=row['bytes']:
    raise RuntimeError('Original portable member changed: '+name)
   inventory[name]=row
  frames=json.loads(archive.read('Recording/FRAMES.json'))
  verification=json.loads(archive.read('Recording/VERIFICATION.json'))
  if (frames.get('schema')!='counterpress.original-recorded-frames.v1' or len(frames.get('frames',[]))!=154
      or frames.get('capturedDurationSeconds')!=proof['originalCaptureSeconds']
      or verification.get('allVideoPacketBytesMatchOriginalJpeg') is not True
      or verification.get('video',{}).get('sha256')!=proof['originalVideo']['sha256']
      or verification.get('videoPackets')!=155):
   raise RuntimeError('The original frame/timing/movie binding differs')
  prior=-1
  for frame in frames['frames']:
   row=inventory.get('Recording/'+safe_relative(frame['file']))
   if (not row or row['sha256']!=frame['sha256'] or row['bytes']!=frame['bytes']
       or not isinstance(frame['at'],(int,float)) or frame['at']<prior
       or not 0<=frame['at']<=proof['originalCaptureSeconds']):
    raise RuntimeError('An original frame or timestamp differs')
   prior=frame['at']
  retained=json.loads(archive.read('SOURCE.json'))
  original_rows=retained['captured']['files']
  source={r['path']:r['sha256'] for r in original_rows}
  if len(original_rows)!=58 or len(source)!=58:raise RuntimeError('The full original source map is required')
  for row in original_rows:
   if row.get('bytesAvailable'):
    original=inventory.get('source-captured/'+safe_relative(row['path']))
    if not original or original['sha256']!=row['sha256']:raise RuntimeError('Captured source bytes differ: '+row['path'])
  selected_files={
   'captions.srt':'Recording/captions.srt','captions.vtt':'Recording/captions.vtt',
   'Counterpress_Automatic_Story.json':'Review/Counterpress_Automatic_Story.json',
   'prepared/captured-review-for-recovery.json':'Review/Counterpress_Captured_Coach_Review.json'}
  files={}
  for destination,name in selected_files.items():
   raw=archive.read(name);stable(CAPTURE/destination,raw)
   files[destination]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
  def seconds(value):
   hour,minute,sec,millis=map(int,re.split('[:,]',value))
   return hour*3600+minute*60+sec+millis/1000
  captions=[]
  for block in re.split(r'\r?\n\r?\n',archive.read('Recording/captions.srt').decode('utf-8').strip()):
   lines=block.splitlines()
   if len(lines)<3 or not lines[0].isdigit():raise RuntimeError('Original caption block differs')
   match=re.fullmatch(r'(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})',lines[1])
   if not match:raise RuntimeError('Original caption timing differs')
   captions.append({'start':seconds(match.group(1)),'end':seconds(match.group(2)),'text':'\n'.join(lines[2:])})
  if len(captions)!=11:raise RuntimeError('All eleven original captions are required')
  # Public match and review inputs are restored from the same verified archive.
  for name in ('Review/Harbor_High_Press_Editable_Match.json','Review/Counterpress_Captured_Coach_Review.json'):
   stable(OUT/'handover'/name,archive.read(name))
  descriptor={'schema':'counterpress.portable-capture.v1','mode':'integrated',
   'archive':{'sha256':initial['portable']['sha256'],'bytes':selected.stat().st_size,'members':300},
   'historicalCheckpointSha256':HISTORICAL_CHECKPOINT,'duration':proof['originalCaptureSeconds'],
   'frames':frames['frames'],'captions':captions,'source':source,'files':files}
  stable(CAPTURE/'capture-portable.json',descriptor)
 emit({'stage':'ORIGINAL_PORTABLE_VERIFIED','members':300,'frames':154,
       'sha256':initial['portable']['sha256'],'publicDescriptor':str(CAPTURE/'capture-portable.json')})
 return descriptor

def check_source():
 spec=read(BASE/'RECEIVING_SOURCE.portable-v1.json')
 if spec.get('sourceTree')!='66884f6ad9df2929c8df4fc4eae77749f3f2e502' or len(spec.get('files',[]))!=67:
  raise RuntimeError('The complete selected receiving application is required')
 for item in spec['files']:
  path=APP/safe_relative(item['path']);raw=path.read_bytes()
  blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  if blob!=item['gitBlob'] or len(raw)!=item['bytes'] or hashlib.sha256(raw).hexdigest()!=item['sha256']:
   raise RuntimeError('Receiving source differs: '+item['path'])
 return spec
def checked_receiving():
 manifest=read(RECEIVE/'capture-manifest.json')
 proof=read(OUT/'H264_RESULT.json')
 if manifest.get('schema')!='counterpress.running-demo.v2' or manifest.get('pageErrors')!=[]:
  raise RuntimeError('The whole receiving manifest has not completed cleanly')
 if manifest.get('video',{}).get('sha256')!=proof['video']['sha256'] or manifest.get('closure',{}).get('browserClosed') is not True:
  raise RuntimeError('The selected video/browser closure differs')
 if any(x.get('closed') is not True for x in manifest['closure'].get('servers',[])):
  raise RuntimeError('A recipient server remains open')
 received=manifest.get('journey',{}).get('recipient',{})
 expected=['coachImported','independentCollection','editableCopy','sourceReplay','embeddedMatchDownload',
           'recipientRevisionExported','recipientRevisionReimported','recipientRevisionReloaded','originalSenderPreserved']
 if any(received.get(k) is not True for k in expected):
  raise RuntimeError('The complete edit/export/reopen journey is required')
 descriptor=read(CAPTURE/'capture-portable.json')
 if descriptor['historicalCheckpointSha256']!=proof['capturedCheckpointSha256']:
  raise RuntimeError('The preserved historical checkpoint identity changed')
 if sha(RECEIVE/'Counterpress_Compass_Running_Demo.mp4')!=proof['video']['sha256']:
  raise RuntimeError('The recipient movie differs from the original selected bytes')
 selection=manifest.get('existingVideoReceiving',{})
 if (selection.get('originalCapturePreserved') is not True or selection.get('originalCheckpointSha256')!=proof['capturedCheckpointSha256']
     or selection.get('sourceMode')!='saved-portable' or selection.get('originalPrivateCheckpointAvailable') is not False
     or selection.get('portableArchive')!=descriptor['archive']
     or selection.get('sourceDescriptorSha256')!=sha(CAPTURE/'capture-portable.json')):
  raise RuntimeError('Receiving is not bound to the original recording')
 return manifest,proof

def receive(owner_fd):
 spec=check_source()
 prepare_portable_capture()
 if (RECEIVE/'capture-manifest.json').exists():
  checked_receiving();emit({'stage':'RECIPIENT_ALREADY_COMPLETED'});return
 OUT.mkdir(parents=True,exist_ok=True)
 args=[NODE,str(APP/'demo/capture.mjs'),'--out',str(RECEIVE),'--chromium',CHROMIUM,
       '--playwright',PLAYWRIGHT,'--ffmpeg','/usr/bin/ffmpeg','--ffprobe','/usr/bin/ffprobe',
       '--journey','integrated','--match',str(OUT/'handover/Review/Harbor_High_Press_Editable_Match.json'),
       '--review',str(OUT/'handover/Review/Counterpress_Captured_Coach_Review.json'),
       '--browser-process-mode','multiple','--resume','true',
       '--receive-video',str(OUT/'handover/Recording'/MP4_NAME),'--receive-proof',str(OUT/'H264_RESULT.json'),
       '--captured-output',str(CAPTURE),'--receive-portable','true']
 stable(OUT/'RECIPIENT_REQUEST.portable-v1.json',{'schema':'counterpress.recipient-request.v1','command':args,
       'sourceTree':spec['sourceTree'],'capturedCheckpointSha256':read(OUT/'H264_RESULT.json')['capturedCheckpointSha256']})
 env=os.environ.copy()
 env['FONTCONFIG_FILE']='/workspace/scratch/5403360e55a4/counterpress-capture-runtime/fonts-current.conf'
 env['FONTCONFIG_PATH']='/workspace/scratch/5403360e55a4/counterpress-capture-runtime'
 env['PYTHONDONTWRITEBYTECODE']='1'
 descriptor=os.open(BROWSER_LOCK,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
 with os.fdopen(descriptor,'r+b') as lock:
  emit({'stage':'WAITING_FOR_EXISTING_BROWSER_LOCK','path':str(BROWSER_LOCK)})
  fcntl.flock(lock,fcntl.LOCK_EX)
  opened=os.fstat(lock.fileno());selected=BROWSER_LOCK.stat(follow_symlinks=False)
  if not stat.S_ISREG(opened.st_mode) or (opened.st_dev,opened.st_ino)!=(selected.st_dev,selected.st_ino):
   raise RuntimeError('The shared browser lock changed during acquisition')
  emit({'stage':'SHARED_BROWSER_LOCK_HELD','path':str(BROWSER_LOCK),'device':opened.st_dev,'inode':opened.st_ino})
  emit({'stage':'RECIPIENT_BROWSER_START','application':str(APP),'output':str(RECEIVE)})
  if (RECEIVE/'capture-manifest.json').exists():
   checked_receiving();emit({'stage':'RECIPIENT_COMPLETED_WHILE_WAITING'});return
  child=subprocess.Popen(args,cwd=str(APP),env=env,pass_fds=(lock.fileno(),owner_fd))
  code=child.wait()
  if code:raise SystemExit(code)
  # Closing our copy preserves the same lock in any still-running inherited owner.
 manifest,proof=checked_receiving()
 emit({'stage':'RECIPIENT_COMPLETED','recipient':manifest['journey']['recipient'],'mobile':manifest['journey'].get('mobile')})

def reject_private(value,path=''):
 if isinstance(value,dict):
  for k,v in value.items():
   if ''.join(c for c in k.lower() if c.isalnum()) in {'collectionkey','ownerkey','ownersecret','collectiontoken','writetoken'}:
    raise RuntimeError('Private collection authority is not a public export: '+path+'/'+k)
   reject_private(v,path+'/'+k)
 elif isinstance(value,list):
  for i,v in enumerate(value):reject_private(v,path+'/'+str(i))

def package():
 spec=check_source();manifest,proof=checked_receiving()
 final_result=OUT/'FINAL_PRODUCT.json';target=OUT/ZIP_NAME
 if final_result.exists():
  value=read(final_result)
  if sha(target)!=value['portable']['sha256']:raise RuntimeError('Completed final package changed')
  return value
 initial=read(OUT/'RESULT.json')
 old=OUT/'original-copy-v0.zip'
 if not old.exists():
  if sha(target)!=initial['portable']['sha256']:raise RuntimeError('Initial saved ZIP changed before final assembly')
  os.link(target,old)
 if sha(old)!=initial['portable']['sha256']:raise RuntimeError('Retained initial package differs')
 public_result={
  'schema':'counterpress.recipient-delivery.v1','complete':True,
  'completedAt':manifest['completedAt'],'recording':proof['video'],
  'originalCaptureSeconds':proof['originalCaptureSeconds'],
  'recipient':manifest['journey']['recipient'],'mobile':manifest['journey'].get('mobile'),
  'completeEvents':manifest['journey']['completeEvents'],
  'automaticStory':manifest['journey'].get('automaticStory'),
  'recap':manifest['journey']['recap'],'captions':manifest['journey']['captions'],
  'originalInsightId':manifest['journey']['originalInsightId'],
  'executedToolCount':manifest['journey']['executedToolCount'],
  'providerTurnCount':manifest['journey']['providerTurnCount'],
  'originalSourcePreserved':True,'browserClosed':True,'pageErrors':[],
  'receivingSource':{'head':'04446f0a3924b08d7bb04b42cec9476482678a37',
       'branch':'counterpress/receive-saved-portable-5403',
       'sourceTree':spec['sourceTree'],'files':len(spec['files'])}}
 public_result['recording']={**public_result['recording'],'path':'Recording/'+MP4_NAME}
 public_result['savedPortableReceiving']=manifest['existingVideoReceiving']
 reject_private(public_result)
 stable(OUT/'RECIPIENT_RESULT.json',public_result)
 entries={}
 with zipfile.ZipFile(old) as original:
  names=original.namelist()
  if len(names)!=300 or len(set(names))!=300:raise RuntimeError('Original 300-member handover differs')
  for name in names:
   safe_relative(name)
   if name.startswith('application/') or name in ['MANIFEST.json','READ_ME.html','SOURCE.json']:continue
   entries[name]=('old',name)
  for name in ['MANIFEST.json','READ_ME.html','SOURCE.json']:
   entries['Provenance/Initial_'+name]=('bytes',original.read(name))
  for row in spec['files']:
   entries['application/'+row['path']]=('file',APP/row['path'])
  entries['Recording/'+MP4_NAME]=('file',OUT/'handover/Recording'/MP4_NAME)
  entries['Provenance/H264_RESULT.json']=('file',OUT/'H264_RESULT.json')
  entries['Provenance/Original_Capture_Portable.json']=('file',CAPTURE/'capture-portable.json')
  entries['Provenance/Recipient_Result.json']=('file',OUT/'RECIPIENT_RESULT.json')
  entries['Provenance/Receiving_Source.json']=('file',BASE/'RECEIVING_SOURCE.portable-v1.json')
  for key,name in manifest['journey']['artifacts'].items():
   if key in ['video','guide']:continue
   safe_relative(name)
   source=RECEIVE/name
   if not source.is_file():raise RuntimeError('Recipient public artifact is missing: '+name)
   if source.suffix=='.json':reject_private(read(source))
   entries['Receiving/'+name]=('file',source)
  entries['Receiving/captions.srt']=('file',RECEIVE/'captions.srt')
  entries['Receiving/captions.vtt']=('file',RECEIVE/'captions.vtt')
  source_map={'schema':'counterpress.recorded-and-received-source.v1',
      'captured':json.loads(original.read('SOURCE.json')),
      'initialPortable':initial['portable'],
      'currentReceiving':spec,
      'publication':public_result['receivingSource'],
      'recording':{'originalCheckpointSha256':proof['capturedCheckpointSha256'],
          'originalMovie':proof['originalVideo'],'mp4':public_result['recording'],
          'sourceMode':'saved-portable','originalPrivateCheckpointAvailable':False,
          'sourceDescriptorSha256':sha(CAPTURE/'capture-portable.json')},
      'originalEntrantAndSubmissionCustody':'Retained with the established entrant and operator.'}
  entries['SOURCE.json']=('bytes',(json.dumps(source_map,sort_keys=True,indent=2)+'\n').encode())
  guide='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Counterpress Compass — movie and editable product</title><style>body{margin:0;background:#f2f2f2;color:#222;font:16px/1.55 system-ui}main{max-width:1020px;margin:auto;padding:32px}section{background:#fff;border:1px solid #ccc;padding:24px;margin:20px 0}h1{font-size:34px;line-height:1.2}h2{font-size:22px}a{color:#222}video{width:100%;background:#111}li{margin:10px 0}code{overflow-wrap:anywhere}pre{padding:16px;background:#eee;overflow:auto}@media(max-width:600px){main{padding:16px}section{padding:16px}}.muted{color:#555}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}</style><main><p>COUNTERPRESS / COMPASS</p><h1>From match review to a working broadcast handover</h1><p>The full running-product film, the complete application and a recipient edition that was edited, exported and reopened.</p><section><h2>Watch the complete demonstration</h2><video controls preload="metadata" src="Recording/Counterpress_Compass_Running_Demo.mp4"><track kind="captions" label="English chapters" srclang="en" src="Recording/captions.vtt"></video><p>The 112.019-second H.264 movie preserves all 154 captured browser frames and their original timing. English captions are supplied as a switchable subtitle track and editable SRT/VTT files. The lossless Matroska original remains in Recording/.</p><p><a href="Recording/Counterpress_Compass_Running_Demo.mp4">Download MP4</a> · <a href="Recording/Counterpress_Compass_Running_Demo.mkv">Lossless original</a> · <a href="Recording/captions.vtt">Chapter captions</a></p></section><section><h2>Open the complete review</h2><div class="grid"><div><h3>Recorded sender edition</h3><ul><li><a href="Receiving/Counterpress_Broadcast_Handover.html">Broadcast handover and source-event replay</a></li><li><a href="Receiving/Counterpress_Player_Recap.html">H10 player recap</a></li><li><a href="Receiving/Counterpress_Automatic_Story.json">Automatic five-play story</a></li><li><a href="Receiving/Counterpress_Coach_Review.json">Editable high-press and low-block review</a></li><li><a href="Receiving/Counterpress_Broadcast_Captions.vtt">Timed broadcast captions</a></li></ul></div><div><h3>Recipient's later edition</h3><ul><li><a href="Receiving/Counterpress_Recipient_Revised_Broadcast.html">Revised broadcast handover</a></li><li><a href="Receiving/Counterpress_Recipient_Revised_Coach_Review.json">Revised complete review</a></li><li><a href="Receiving/Counterpress_Recipient_Revised_Match.json">Revised editable match</a></li><li><a href="Receiving/Counterpress_Recipient_Revised_Captions.vtt">Revised captions</a></li></ul><p>The recipient's title and caption changes were saved, reloaded, exported and imported into a separate recipient collection. The original sender edition remained exact.</p></div></div></section><section><h2>Continue in the included application</h2><p>Use Node 22 or later. From this extracted directory, run:</p><pre>node application/src/server.mjs</pre><p>Open <a href="http://127.0.0.1:3167">http://127.0.0.1:3167</a>, choose <strong>Compare saved matches</strong>, and import either complete review JSON from Receiving/. Both full matches become editable in your browser. In <strong>Broadcast handover</strong>, choose the MP4 in Recording/ as the local recording.</p><p>Use the player, saved explanation inspector, bilingual recap, coach comparison and broadcaster editor. Each cue retains the original source event/team/count and its independent video times. The standalone HTML can also export the full editable match and VTT for another recipient.</p><p>The original saved explanation contains one executed get_match_state tool call and two provider turns. Opening the saved review does not make another model request.</p></section><section><h2>What this handover preserves</h2><p>The two original synthetic development matches contain 941 and 948 events. H10 has six regains and involvement in eighteen successful sequences. The same captured movie is used throughout receiving; it was not recorded again.</p><p>The current 67-file application is included in application/. The preserved source-captured/ directory contains the 55 exact original source files that were recoverable, and all 58 original source identities remain recorded in SOURCE.json. Three historical recorder-tool preimages are identified by their original hashes. The original copy's source map, guide and complete member manifest remain in Provenance/. The recipient was restored from the complete saved public package into fresh collection authority; the historical private capture checkpoint was unavailable and was not recreated.</p><p>Original entrant attribution, reward/payment claims and submission custody remain with the established entrant and operator. This handover does not submit the entry.</p><p><a href="application/README.md">Application guide</a> · <a href="application/demo/ENCODING.md">Original CEDAR encoding guide</a> · <a href="application/demo/PORTABLE_RECORDING.md">Saved-package receiving</a> · <a href="SOURCE.json">Source editions</a> · <a href="Provenance/Recipient_Result.json">Completed recipient behavior</a></p></section></main></html>'''
  guard=subprocess.run([sys.executable,'-B',str(BASE/'publication-guard/check_claim_fields.py')],input=json.dumps({'body':guide}),capture_output=True,text=True)
  decision=json.loads(guard.stdout)
  if guard.returncode or decision.get('allowed') is not True:raise RuntimeError('Final guide publication guard rejected: '+guard.stdout)
  entries['READ_ME.html']=('bytes',guide.encode())
  entries['tools/finish_delivery.py']=('file',pathlib.Path(__file__))
  part=target.with_name(target.name+'.finalizing.part')
  if part.exists():part.unlink()
  inventory=[]
  with zipfile.ZipFile(part,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
   for name,(kind,value) in sorted(entries.items()):
    zi=zipfile.ZipInfo(name,date_time=(2026,10,13,0,0,0));zi.external_attr=0o100644<<16
    zi.compress_type=zipfile.ZIP_STORED if pathlib.PurePosixPath(name).suffix.lower() in ['.jpg','.mkv','.mp4'] else zipfile.ZIP_DEFLATED
    h=hashlib.sha256();size=0
    if kind=='old':stream=original.open(value)
    elif kind=='file':stream=value.open('rb')
    else:
     import io
     stream=io.BytesIO(value)
    with stream,z.open(zi,'w') as dest:
     for block in iter(lambda:stream.read(1024*1024),b''):
      dest.write(block);h.update(block);size+=len(block)
    inventory.append({'path':name,'bytes':size,'sha256':h.hexdigest()})
   final_movie=next(row for row in inventory if row['path']=='Recording/'+MP4_NAME)
   if final_movie['bytes']!=proof['video']['bytes'] or final_movie['sha256']!=proof['video']['sha256']:
    raise RuntimeError('Final portable movie must retain the original verified H.264 bytes')
   summary={'schema':'counterpress.completed-product.v1','complete':True,'members':inventory,
      'recording':public_result['recording'],'recipient':public_result['recipient'],
      'source':public_result['receivingSource'],'originalPortableSha256':initial['portable']['sha256'],
      'originalCapturePreserved':True,'privateCollectionAuthorityIncluded':False}
   z.writestr('MANIFEST.json',json.dumps(summary,sort_keys=True,indent=2)+'\n')
  with part.open('rb') as f:os.fsync(f.fileno())
  expected={x['path']:x for x in inventory}
  with zipfile.ZipFile(part) as z:
   if sorted(z.namelist())!=sorted([*expected,'MANIFEST.json']):raise RuntimeError('Final portable member list differs')
   for name,row in expected.items():
    h=hashlib.sha256();size=0
    with z.open(name) as f:
     for block in iter(lambda:f.read(1024*1024),b''):h.update(block);size+=len(block)
    if h.hexdigest()!=row['sha256'] or size!=row['bytes']:raise RuntimeError('Final portable bytes differ: '+name)
  os.replace(part,target)
  result={'schema':'counterpress.final-product-result.v1','complete':True,
      'portable':{'path':str(target),'bytes':target.stat().st_size,'sha256':sha(target),'members':len(inventory)+1},
      'video':proof['video'],'recipient':public_result['recipient'],
      'source':public_result['receivingSource'],'originalPortablePreservedAsVersion':0,
      'initialPortableSha256':initial['portable']['sha256']}
  stable(final_result,result)
  emit({'stage':'FINAL_PORTABLE_VERIFIED',**result})
  return result

def save():
 from library_upload import LibraryUploadWorkflow,HostedAppsClient,LibraryFileMaterializer,SignedUrlUploader
 first=read(OUT/'LIBRARY-SAVE-COPY-PORTABLE.json')
 prior=next(x for x in first['results'] if x['local_path']==str(OUT/ZIP_NAME))
 if prior['status']!='succeeded':raise RuntimeError('Original ZIP Library identity is required')
 request={'uploads':[{'local_path':str(OUT/'handover/Recording'/MP4_NAME),'purpose':'create_library_file','library_artifact_type':'other'},
   {'local_path':str(OUT/ZIP_NAME),'purpose':'replace_library_file','library_file_id':prior['library_file_id'],
    'expected_current_version':prior['current_version_number'],
    'version_reason':'Complete original H.264 movie and actual recipient edit, export and reopen handover'}]}
 result_path=OUT/'LIBRARY-SAVE-FINAL.json'
 if result_path.exists():
  result=read(result_path)
  if len(result.get('results',[]))!=2 or any(r.get('status')!='succeeded' for r in result['results']):
   raise RuntimeError('Reconcile the exact partial final save before another upload')
  emit({'stage':'FINAL_SAVE_ALREADY_COMPLETED','result':result});return
 stable(OUT/'LIBRARY-SAVE-FINAL.request.json',request)
 marker=OUT/'LIBRARY-SAVE-FINAL.invoked.json'
 if marker.exists():raise RuntimeError('The original final save was invoked; reconcile its returned identities before any retry')
 stable(marker,{'schema':'counterpress.final-save-invocation.v1','pid':os.getpid(),'request':'LIBRARY-SAVE-FINAL.request.json'})
 workflow=LibraryUploadWorkflow(apps_client=HostedAppsClient(),materializer=LibraryFileMaterializer(),uploader=SignedUrlUploader(),state_parent=OUT)
 result=workflow.run(request)
 stable(result_path,result)
 if len(result.get('results',[]))!=2 or any(r.get('status')!='succeeded' for r in result['results']):
  raise RuntimeError('The final save did not complete every selected item')
 emit({'stage':'FINAL_SAVED','result':result})

def main():
 sys.path.insert(0,str(HELPERS))
 with (BASE/'.recipient-finish.lock').open('a+b') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  receive(lock.fileno())
  package()
  save()
 return 0
if __name__=='__main__':raise SystemExit(main())
