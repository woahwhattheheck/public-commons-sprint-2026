"""Execute one admitted Study source operation from verified, maintained source."""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
def sha(raw):return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--source',required=True);p.add_argument('--out',required=True)
 p.add_argument('--work',required=True);p.add_argument('--inputs',required=True)
 p.add_argument('--node',default=os.environ.get('CODEX_PRIMARY_RUNTIME_NODE'))
 p.add_argument('--node-modules',default=os.environ.get('CODEX_PRIMARY_RUNTIME_NODE_MODULES'))
 args=p.parse_args()
 here=Path(__file__).resolve().parent;source=Path(args.source).resolve(strict=True)
 out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True,mode=0o700)
 work=Path(args.work).absolute()
 if work.exists():raise RuntimeError('Reconcile the existing native operation directory before a continuation.')
 work.mkdir(parents=True,mode=0o700)
 os.chmod(work,0o700);os.umask(0o077)
 index=json.loads((here/'source-index.json').read_text())
 target=work/'source';target.mkdir(mode=0o700)
 retained=[]
 for old in source.rglob('*'):
  if not old.is_file() or '__pycache__' in old.parts or old.suffix=='.pyc':continue
  relative=old.relative_to(source).as_posix()
  expected=index['files'].get(relative)
  if expected is None:raise RuntimeError('Unbound source member: '+relative)
  raw=old.read_bytes()
  if old.is_symlink() or sha(raw)!=expected:raise RuntimeError('Original source identity changed: '+relative)
  new=target/relative;new.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  new.write_bytes(raw);new.chmod(0o600);retained.append({'path':relative,'git_blob':expected,'bytes':len(raw)})
 if not retained:raise RuntimeError('No original source was provided.')
 (out/'materialized-source.json').write_text(json.dumps({'source_commit':index['source_commit'],'files':retained},indent=2))
 for name in ['native-case.py','browser.mjs']:
  shutil.copyfile(here/name,out/name);(out/name).chmod(0o600)
 raw=Path(args.inputs).read_bytes()
 if Path(args.inputs).resolve()!=out/'inputs.json':(out/'inputs.json').write_bytes(raw)
 (out/'inputs.json').chmod(0o600)
 env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(work/'tmp'),
      'CODEX_PRIMARY_RUNTIME_NODE':args.node or 'node',
      'CODEX_PRIMARY_RUNTIME_NODE_MODULES':args.node_modules or ''}
 (work/'tmp').mkdir(mode=0o700)
 result=subprocess.run([sys.executable,str(out/'native-case.py'),str(work),str(target),str(out)],env=env)
 return result.returncode
if __name__=='__main__':raise SystemExit(main())
