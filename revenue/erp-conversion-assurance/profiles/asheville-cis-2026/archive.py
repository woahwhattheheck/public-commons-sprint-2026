#!/usr/bin/env python3
"""MIT. Extract only ordinary authenticated workspace files into a new private directory."""
import json,os,sys,tarfile
from pathlib import Path,PurePosixPath
def main():
    source,destination=sys.argv[1:3];destination=Path(destination)
    if destination.exists():raise ValueError('Restore into a new directory.')
    allowed={'service.json','hmac.key','bundles','jobs','runtime','utility'};members=[];seen=set();total=0
    with tarfile.open(source,'r:gz') as archive:
        for item in archive:
            path=PurePosixPath(item.name)
            if str(path)=='.':continue
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in allowed:raise ValueError('Unexpected archive path.')
            if str(path) in seen or not(item.isdir() or item.isfile()) or item.issym() or item.islnk():raise ValueError('Repeated, linked or unsupported archive member.')
            seen.add(str(path));total+=item.size;members.append((item,path))
            if item.size<0 or total>4*1024**3 or len(members)>200000:raise ValueError('Restore exceeds 4 GiB or 200,000 files.')
        if not {'service.json','hmac.key','utility/workspace.sqlite'}.issubset(seen):raise ValueError('The original workspace identity or database is missing.')
        destination.mkdir(mode=0o700)
        for item,path in members:
            target=destination.joinpath(*path.parts)
            if item.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True);continue
            target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with archive.extractfile(item) as incoming,open(target,'xb') as outgoing:
                os.chmod(target,0o600);copied=0
                while chunk:=incoming.read(1024*1024):outgoing.write(chunk);copied+=len(chunk)
                if copied!=item.size:raise ValueError('An archive member ended early.')
                outgoing.flush();os.fsync(outgoing.fileno())
    print(json.dumps({'members':len(members),'bytes':total}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
