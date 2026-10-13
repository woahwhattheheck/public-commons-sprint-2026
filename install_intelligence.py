#!/usr/bin/env python3
"""Install the additive extension without editing original source or UI files."""
from pathlib import Path
import argparse
import shutil

LEGACY='''from app import app
from eco_intelligence import install_intelligence
install_intelligence(app)
'''
CATALOG='''import os
from pathlib import Path
from app import app
from eco_intelligence import install_intelligence
from eco_intelligence.adapters import CatalogRepository, CallbackGateway
install_intelligence(app,
    repository=CatalogRepository(Path(os.environ['ECO_INTELLIGENCE_CATALOG']),Path(os.environ['ECO_DATA_ROOT'])),
    state_path=Path(os.environ['ECO_INTELLIGENCE_STATE']), gateway=CallbackGateway(None))
'''

def install(target: Path, mode: str):
    target=target.resolve()
    if not (target/'app.py').is_file():
        raise SystemExit('Target must contain the original app.py. Standalone use: python -m eco_intelligence --help.')
    if mode=='legacy' and not (target/'settings.py').is_file():
        raise SystemExit('Legacy mode requires the original settings.py. Use catalog mode or mount with original-store callbacks; no files changed.')
    entry_text='# Additive entrypoint; app.py and original web assets remain unchanged.\n'+(LEGACY if mode=='legacy' else CATALOG)
    source=Path(__file__).resolve().parent/'eco_intelligence'
    destination=target/'eco_intelligence'
    files=[p for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    for path in files:
        dest=destination/path.relative_to(source)
        if dest.exists() and dest.read_bytes()!=path.read_bytes():
            raise SystemExit(f'Existing different extension file: {dest}; no source was overwritten.')
    entry=target/'intelligence_app.py'
    if entry.exists() and entry.read_text()!=entry_text:
        raise SystemExit('Existing intelligence_app.py differs; no source was overwritten.')
    for path in files:
        dest=destination/path.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists():shutil.copy2(path,dest)
    entry.write_text(entry_text)
    print(f'Installed {len(files)} extension files; original application and UI preserved.')
    print('Run from original app directory: uvicorn intelligence_app:app --host 127.0.0.1 --port 8000')
    print('Open /intelligence. See INTEGRATION.md for authenticated native-store and job bindings.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_directory',type=Path)
    parser.add_argument('--mode',choices=['legacy','catalog'],default='legacy')
    args=parser.parse_args();install(args.app_directory,args.mode)
