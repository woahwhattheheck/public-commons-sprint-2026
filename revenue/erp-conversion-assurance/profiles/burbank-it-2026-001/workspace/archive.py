#!/usr/bin/env python3
"""MIT. Extract an authenticated workspace archive into a new private directory."""
import json, os, sys, tarfile
from pathlib import Path, PurePosixPath
def main():
    source,destination=sys.argv[1:3];destination=Path(destination)
    if destination.exists(): raise ValueError('Restore destination must not exist.')
    permitted={'service.json','hmac.key','bundles','jobs','runtime','burbank'};seen=set();members=[];total=0
    with tarfile.open(source,'r:gz') as archive:
        for member in archive:
            path=PurePosixPath(member.name)
            if str(path)=='.':continue
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in permitted:raise ValueError('Unexpected archive path.')
            if str(path) in seen or not(member.isdir() or member.isfile()) or member.issym() or member.islnk():raise ValueError('Repeated or linked archive member.')
            if member.size<0:raise ValueError('Invalid archive length.')
            seen.add(str(path));total+=member.size;members.append((member,path))
            if total>4*1024**3 or len(members)>200000:raise ValueError('The restore exceeds 4 GiB or 200,000 files.')
        if not {'service.json','hmac.key'}.issubset(seen):raise ValueError('The original service configuration or identity key is missing.')
        destination.mkdir(mode=0o700)
        for member,path in members:
            target=destination.joinpath(*path.parts)
            if member.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True);continue
            target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with archive.extractfile(member) as incoming,open(target,'xb') as outgoing:
                os.chmod(target,0o600);copied=0
                while True:
                    chunk=incoming.read(1024*1024)
                    if not chunk:break
                    copied+=len(chunk);outgoing.write(chunk)
                if copied!=member.size:raise ValueError('An archive member ended early.')
                outgoing.flush();os.fsync(outgoing.fileno())
    print(json.dumps({'members':len(members),'bytes':total}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
