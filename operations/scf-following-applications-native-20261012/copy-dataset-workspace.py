# MIT. Copy the completed original NDJSON workspace into its receiving operation.
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import stat
import sys
import zipfile

archive, directory, expected = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
if not directory.is_absolute() or directory == Path('/'):
    raise ValueError('Use the original absolute private receiving directory')
payload = archive.read_bytes()
if hashlib.sha256(payload).hexdigest() != expected:
    raise ValueError('The original completed NDJSON archive changed')
directory.mkdir(parents=True, mode=0o700, exist_ok=True)
if directory.is_symlink() or directory.resolve() != directory or directory.stat().st_mode & 0o077:
    raise ValueError('The receiving copy must be a real private directory')
record = directory / 'copy-receipt.json'
if record.exists():
    previous = json.loads(record.read_text())
    if previous.get('archiveSha256') != expected or previous.get('directory') != str(directory):
        raise ValueError('The original receiving archive selection changed')
    if not (directory / 'native-outcome.json').is_file() or not (directory / 'source-workspace').is_dir():
        raise ValueError('The original receiving workspace is missing')
    print(json.dumps({'state': 'REOPENED', **previous}))
    raise SystemExit(0)

members = []
seen = set()
with zipfile.ZipFile(archive) as source:
    for item in source.infolist():
        name = item.filename
        relative = PurePosixPath(name)
        if (relative.is_absolute() or '\\' in name or
                any(part in ('', '.', '..') for part in name.rstrip('/').split('/')) or
                name in seen or stat.S_ISLNK(item.external_attr >> 16)):
            raise ValueError('Invalid original ZIP member: ' + name)
        seen.add(name)
        target = directory.joinpath(*relative.parts)
        if item.is_dir():
            target.mkdir(parents=True, mode=0o700, exist_ok=True)
            continue
        data = source.read(item)
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        if target.exists():
            if target.is_symlink() or target.read_bytes() != data:
                raise ValueError('Interrupted original copy differs: ' + name)
        else:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
        members.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
if len(members) != 178 or not (directory / 'source-workspace').is_dir():
    raise ValueError('The completed original NDJSON workspace is incomplete')
outcome = json.loads((directory / 'native-outcome.json').read_text())
if (outcome.get('schema') != 'stellar-forge.ndjson-release-native-operation.v1' or
        len(outcome.get('preparation', [])) != 2 or len(outcome.get('receiving', [])) != 2):
    raise ValueError('Use the completed original two-edition dataset operation')
receipt = {'schema': 'starforge.ndjson-workspace-copy.v1', 'directory': str(directory),
           'archive': str(archive), 'archiveSha256': expected, 'files': len(members),
           'bytes': sum(item['bytes'] for item in members), 'members': members}
with record.open('x') as output:
    json.dump(receipt, output, indent=2)
    output.write('\n')
os.chmod(record, 0o600)
print(json.dumps({key: value for key, value in receipt.items() if key != 'members'}))
