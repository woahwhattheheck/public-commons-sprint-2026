#!/usr/bin/env python3
"""Select the original SF30/SF82 import closure from its retained source carrier."""
import argparse,hashlib,json,os,posixpath,re,tarfile
from pathlib import Path,PurePosixPath
def digest(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def file_hash(path):
 with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--selection',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 selected=json.loads(Path(a.selection).read_text());archive=Path(selected['path']);root=Path(a.out);root.mkdir(parents=True,exist_ok=True)
 if archive.stat().st_size!=selected['bytes'] or file_hash(archive)!=selected['sha256']:raise RuntimeError('The retained native source carrier differs')
 modules=Path(selected['node_modules'])
 if not modules.is_dir():raise RuntimeError('The selected existing dependency root is absent')
 link=root/'node_modules'
 if not link.exists():os.symlink(modules,link,target_is_directory=True)
 elif link.resolve()!=modules.resolve():raise RuntimeError('The selected dependency root differs')
 records=[];texts={}
 with tarfile.open(archive,'r:gz') as tf:
  members={item.name:item for item in tf.getmembers() if item.isfile()}
  candidates=[name for name in members if name.endswith('/sf82-seller-pilot/release-dataset.mjs')]
  release=None
  for name in candidates:
   data=tf.extractfile(members[name]).read()
   if digest(data)==selected['release_reader_git_blob']:release=name;break
  if release is None:raise RuntimeError('The selected carrier has no exact original release-dataset source')
  loader=posixpath.normpath(posixpath.join(posixpath.dirname(release),'../sf30-seller-sdk/dataset-handler.mjs'))
  queue=[release,loader];seen=set()
  while queue:
   name=queue.pop(0)
   if name in seen:continue
   seen.add(name)
   path=PurePosixPath(name)
   if path.is_absolute() or '..' in path.parts or name not in members:raise RuntimeError('Missing original relative import: '+name)
   data=tf.extractfile(members[name]).read();target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
   records.append({'path':name,'bytes':len(data),'git_blob':digest(data),'sha256':hashlib.sha256(data).hexdigest()})
   if name.endswith(('.mjs','.js','.cjs')):
    text=data.decode('utf-8')
    for match in re.finditer(r"(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['\"](\.[^'\"]+)['\"]",text):
     relative=posixpath.normpath(posixpath.join(posixpath.dirname(name),match.group(1)))
     if relative not in members:raise RuntimeError('Original import source is missing: '+relative)
     queue.append(relative)
 result={'schema':'starforge.wherobots.native-consumer-source.v1','carrier':selected,'release':str(root/release),'loader':str(root/loader),'files':records,'dependency_root':str(modules)}
 (root/'consumer-source.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'manifest':str(root/'consumer-source.json'),'release':result['release'],'loader':result['loader'],'files':len(records),'bytes':sum(x['bytes'] for x in records)}))
if __name__=='__main__':main()
