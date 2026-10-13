#!/usr/bin/env python3
"""Add the measured-input consumer without changing either original component."""
from pathlib import Path
import argparse,ast,hashlib,json,os,tempfile

def install(application, source=None):
    root=Path(application).resolve(strict=True);source=Path(source or Path(__file__).parent)
    if not (root/'measurement_workspace/__init__.py').is_file():
        raise ValueError('Install ASTRA-OBS12 measurement workspace first')
    if not (root/'model/reach_chemistry/inference.py').is_file():
        raise ValueError('Install the original ASTRA-REACT12 native chemistry component first')
    files={'measurement_workspace/chemistry.py':(source/'measurement_workspace/chemistry.py').read_bytes(),
           'MEASUREMENT_CHEMISTRY.md':(source/'README.md').read_bytes()}
    ast.parse(files['measurement_workspace/chemistry.py'].decode())
    conflicts=[n for n,b in files.items() if (root/n).exists() and (root/n).read_bytes()!=b]
    if conflicts:raise ValueError('Different authored source preserved: '+', '.join(conflicts))
    with tempfile.TemporaryDirectory(prefix='.chemistry-binding-',dir=root) as temporary:
        made=[]
        try:
            for i,(name,body) in enumerate(files.items()):
                target=root/name
                if target.exists():continue
                staged=Path(temporary)/str(i);staged.write_bytes(body)
                os.link(staged,target);made.append(name)
        except BaseException:
            for name in made:
                target=root/name
                if target.is_file() and target.read_bytes()==files[name]:target.unlink()
            raise
    return {'installed':made,'reused':len(files)-len(made),'files':[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in files.items()]}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',required=True)
    print(json.dumps(install(p.parse_args().application),indent=2))
