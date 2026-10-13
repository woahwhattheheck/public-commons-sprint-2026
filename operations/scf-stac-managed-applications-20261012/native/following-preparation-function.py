
def following_preparation(files,selection):
 if selection is None:return files,None
 if not isinstance(selection,dict) or set(selection)!={'schema','operationId','attemptLabel','sourceEnvelopeSha256','reason','sourceRoots','changes','guide'}:
  raise ValueError('Use the complete explicit following preparation')
 if (selection['schema']!='commons.stac-following-preparation.v1'
     or selection['operationId']!='SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012'
     or selection['attemptLabel']!=attempt_label
     or selection['sourceEnvelopeSha256']!='f153feb61d1f6adaa9549b9d63c5ce0972ab9ec4d910e380af5938d1cd5c0350'
     or not isinstance(selection['reason'],str) or not selection['reason'].strip()):
  raise ValueError('Preserve the original operation and declare the following input')
 def exact_path(value,directory=False):
  if not isinstance(value,str) or '\0' in value:raise ValueError('Use an absolute selected source path')
  path=pathlib.Path(value)
  if not path.is_absolute() or path==pathlib.Path('/') or path.resolve(strict=True)!=path or path.is_symlink():
   raise ValueError('Preserve a noncanonical selected source path')
  info=path.lstat()
  if directory and not stat.S_ISDIR(info.st_mode):raise ValueError('Use the selected source directory')
  if not directory and not stat.S_ISREG(info.st_mode):raise ValueError('Use the selected regular source file')
  return path
 def artifact(record):
  if not isinstance(record,dict) or set(record)!={'path','bytes','sha256'}:raise ValueError('Use the complete selected file identity')
  if not isinstance(record['bytes'],int) or record['bytes']<1 or not isinstance(record['sha256'],str) or len(record['sha256'])!=64:
   raise ValueError('Use the original selected file extent and digest')
  path=exact_path(record['path']);body=path.read_bytes()
  if len(body)!=record['bytes'] or hashlib.sha256(body).hexdigest()!=record['sha256']:
   raise ValueError('Selected source file changed: '+str(path))
  return body
 source_roots=selection['sourceRoots']
 if not isinstance(source_roots,dict) or set(source_roots)!={'libraryHelpers','sourceInput','operationCode','builder'}:
  raise ValueError('Select the complete original source roots')
 for key,environment in [
  ('libraryHelpers','STAC_LIBRARY_HELPER_DIRECTORY'),('sourceInput','STAC_SOURCE_INPUT_FILE'),
  ('operationCode','STAC_OPERATION_CODE_DIRECTORY'),('builder','STAC_BUILDER_SOURCE_DIRECTORY')]:
  source=exact_path(source_roots[key],directory=key!='sourceInput')
  os.environ[environment]=str(source)
 if pathlib.Path(source_roots['sourceInput']).read_bytes()!=raw:
  raise ValueError('The selected original source envelope changed')
 native=[item for item in files if item['path']=='operation-base/native-input.json']
 shared=[item for item in files if item['path']=='operation-base/original-shared-input.json']
 if len(native)!=1 or len(shared)!=1:raise ValueError('Preserve both original complete input records')
 original=native[0]['text'].encode()
 if hashlib.sha256(original).hexdigest()!=native[0]['sha256']:
  raise ValueError('Original native input changed')
 before=json.loads(original)
 source_files=[]
 def source_file(directory,name,expected_blob=None,expected_sha=None,expected_bytes=None):
  path=exact_path(str(pathlib.Path(source_roots[directory])/name));body=path.read_bytes()
  observed_sha=hashlib.sha256(body).hexdigest()
  observed_blob=hashlib.sha1(b'blob '+str(len(body)).encode()+bytes([0])+body).hexdigest()
  if ((expected_blob is not None and observed_blob!=expected_blob)
      or (expected_sha is not None and observed_sha!=expected_sha)
      or (expected_bytes is not None and len(body)!=expected_bytes)):
   raise ValueError('Selected complete source changed: '+str(path))
  record={'directory':directory,'name':name,'path':str(path),'bytes':len(body),'sha256':observed_sha,'blob':observed_blob}
  source_files.append(record)
  return body
 for name,digest in {
  'library_upload.py':'b11e4929596e321366c2f7291890fbb6d6bf8b413ae6d24593e9548f9bf50f23',
  'library_file_transfer.py':'5c81478cd94a59d721a1677d0bd36f7cec23c18a21b48740b1c9ff94d27fb26f',
  'library_hosted_apps.py':'b7961301f7ca6f76b2f2f30e4e5673a303532680a790e545c3207a2bf5e63de4'
 }.items():source_file('libraryHelpers',name,expected_sha=digest)
 source_file('operationCode','source-7169.json',expected_blob='56da861934c0a161c8ab76b64a17c2a9b421d557')
 source_file('operationCode','source-selection.json',expected_blob='c293c2d0915ffe402f1a1bb718cbfffae334af80')
 source_file('operationCode','continue-stac-applications.mjs',expected_blob='d13d1e46dc32efdd5566e3af073ba01a2496def6')
 source_file('operationCode','original-continue-stac-applications.mjs',expected_blob='d411c0783d85371b89afca1be78ead55902b8abb')
 for item in before['builderFiles']:
  if not isinstance(item.get('name'),str) or '/' in item['name'] or chr(92) in item['name']:
   raise ValueError('Use an original builder member name')
  source_file('builder',item['name'],expected_blob=item['blob'],expected_bytes=item['bytes'])
 changes=selection['changes']
 allowed={'previousRuntime','previousInputs','selection','runtimeDirectory','sourceWorkspace','sourceProcessingWorkspace','closedInput'}
 if not isinstance(changes,dict) or set(changes)!=allowed:
  raise ValueError('Select only the documented runtime profile and closed receiving input')
 expected_profile={'native':False,'features':[],'operator':True,'pins':{}}
 if changes['previousRuntime'] is not None or changes['previousInputs']!={} or changes['selection']!=expected_profile:
  raise ValueError('Use the explicitly selected original lightweight new installation')
 if changes['runtimeDirectory']!=str(root/'runtime'):
  raise ValueError('Use the original operation owned runtime directory')
 restored=root/'restored-inputs'
 if changes['sourceWorkspace']!=str(restored/'scenes') or changes['sourceProcessingWorkspace']!=str(restored/'processing'):
  raise ValueError('Use the original receiving directories within this operation')
 closed=changes['closedInput']
 closed_keys={'schema','archive','member','manifestDigest','importOperationId','editionId','receivingDirectory','handoverDirectory'}
 if not isinstance(closed,dict) or set(closed)!=closed_keys:
  raise ValueError('Select the complete original closed processing handover')
 if (closed['schema']!='commons.stac-closed-processing-input.v1'
     or closed['archive'].get('bytes')!=157152
     or closed['archive'].get('sha256')!='9da8e853c00077f6f1914a97e098ac0739f91a7c64a8d8255539f49f5e2e6ece'
     or closed['member']!={'name':'cirrus-native.processing.json.gz','bytes':148607,'sha256':'453026898def5ff1ef7de0fbb0546ecb4c95af6b3b040f5f16c5c08cac0eeed0'}
     or closed['manifestDigest']!='ed713aead2977e107f10a700262714213786053a3634c9c7e3698003b22f8f31'
     or closed['importOperationId']!='f6b78f39f6bc265571dc8eeb6d866d49'
     or closed['editionId']!='processing-edition-3da24759c3314821afe17256'
     or closed['receivingDirectory']!=str(restored/'received-inputs')
     or closed['handoverDirectory']!=str(restored/'exports')):
  raise ValueError('Preserve the exact saved Cirrus case and original receiving action')
 artifact(closed['archive'])
 selected={**before,**changes}
 if (selected.get('operationId')!=selection['operationId'] or selected.get('projectDirectory')!=str(root)
     or selected.get('sourceCommit')!='7169c10e37a1800d22133efaf37cfaac5d96e343'
     or selected.get('sourceTree')!='eda6ec9050eeedb4bd401c66b7bfba0b604a8fca'):
  raise ValueError('Preserve the fixed original operation source')
 selected_bytes=(json.dumps(selected,indent=2)+'\n').encode()
 guide=artifact(selection['guide'])
 guide.decode('utf-8')
 request_bytes=(json.dumps(selection,sort_keys=True,indent=2)+'\n').encode()
 receipt={
  'schema':'commons.stac-following-preparation-receipt.v1',
  'operationId':selection['operationId'],'attemptLabel':attempt_label,
  'sourceEnvelopeSha256':selection['sourceEnvelopeSha256'],
  'reason':selection['reason'],'sourceRoots':source_roots,'sourceFiles':source_files,
  'requestSha256':hashlib.sha256(request_bytes).hexdigest(),
  'originalInput':{'path':'operation-base/native-input.json','bytes':len(original),'sha256':hashlib.sha256(original).hexdigest()},
  'selectedInput':{'path':'operation-base/following-native-input.json','bytes':len(selected_bytes),'sha256':hashlib.sha256(selected_bytes).hexdigest()},
  'changes':[{'field':key,'beforePresent':key in before,'before':before.get(key),'after':changes[key]} for key in sorted(changes)],
  'guide':selection['guide'],
  'historicalGuide':{'path':'/dev/shm/b710-stac-source-archive-receiving/STAC_Complete_Archive_Receiving.md','bytes':19044,'sha256':'ec7b2abde2dedcec6f743bd41307858cd18a5d933d66a2606efecc7818a3296c'}
 }
 receipt_bytes=(json.dumps(receipt,indent=2)+'\n').encode()
 additions=[
  ('operation-base/following-native-input.json',selected_bytes),
  ('operation-base/following-preparation.json',receipt_bytes),
  ('delivery/original-input/following-preparation-request.json',request_bytes),
  ('delivery/original-input/following-preparation.json',receipt_bytes),
  ('delivery/original-input/original-native-input.json',original),
  ('delivery/original-input/complete-source-input.json',raw),
  ('delivery/original-input/original-shared-input.json',shared[0]['text'].encode()),
  ('delivery/original-input/following-native-input.json',selected_bytes),
  ('delivery/COMPLETE_ARCHIVE_RECEIVING.md',guide)
 ]
 paths={item['path'] for item in files}
 for name,body in additions:
  if name in paths:raise ValueError('Preserve an existing original receiving member: '+name)
  paths.add(name)
  files.append({'path':name,'text':body.decode('utf-8'),'sha256':hashlib.sha256(body).hexdigest()})
 return files,receipt
