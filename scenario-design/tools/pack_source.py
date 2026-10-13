"""Build the complete deterministic source ZIP and per-file content inventory."""
import argparse,hashlib,json,zipfile
from pathlib import Path

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('output',type=Path);args=ap.parse_args()
    root=Path(__file__).resolve().parents[1]
    if args.output.resolve().is_relative_to(root):ap.error('Place the archive outside the source root')
    files=sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='SOURCE_MANIFEST.json' and p.suffix!='.pyc')
    manifest={str(p.relative_to(root)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
    (root/'SOURCE_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n');files.append(root/'SOURCE_MANIFEST.json')
    with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(files):
            info=zipfile.ZipInfo('scenario-design/'+str(p.relative_to(root)),date_time=(2026,10,12,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(0o755 if p.name=='start.sh' else 0o644)<<16
            z.writestr(info,p.read_bytes())
    print(json.dumps({'archive':args.output.name,'archive_bytes':args.output.stat().st_size,'archive_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'source_files':len(files),'source_bytes':sum(p.stat().st_size for p in files)},indent=2))

if __name__=='__main__':main()
