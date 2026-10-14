#!/usr/bin/env python3
"""Prepare the supplied offline runtime, then enter the original opening command.

The raw conda-pack stays unchanged. A per-user installed prefix remains outside
portable studies, so moving or updating an application does not move InVEST.
No network installation, scientific execution, or replacement queue is involved.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import uuid
import zipfile
import posixpath
import time

try:
    from . import runtime_platform as rp
except ImportError:
    import runtime_platform as rp

SCHEMA = 'upstate.offline-native-runtime/v1'
STATE_SCHEMA = 'upstate.received-native-runtime/v1'
BLOCK = 1024 * 1024
# The original application performs the scientific version/source selection.
NATIVE_IDENTITY = r'''
import json, sys, os, importlib.metadata
from pathlib import Path
# Python extension DLL resolution on Windows does not use PATH alone. Keep
# directory handles alive throughout the original native/GDAL/PROJ imports.
_dll_directories = []
if os.name == 'nt':
    for directory in json.loads(sys.argv[2]):
        if Path(directory).is_dir():
            _dll_directories.append(os.add_dll_directory(directory))
sys.path.insert(0, sys.argv[1])
from model.native import runtime
from osgeo import gdal, osr
_, native = runtime()
reference = osr.SpatialReference()
if reference.ImportFromEPSG(5070) != 0:
    raise RuntimeError('The selected runtime could not load its PROJ database')
print(json.dumps({'python': sys.executable, 'prefix': sys.prefix,
    'python_version': sys.version.split()[0],
    'invest_version': importlib.metadata.version('natcap.invest'),
    'gdal_version': gdal.VersionInfo('RELEASE_NAME'),
    'native': native}, sort_keys=True, allow_nan=False))
'''


def stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def say(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def read_json(path: Path) -> dict:
    with os.fdopen(rp.open_file(path, os.O_RDONLY), 'r', encoding='utf-8') as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError('Expected an object in ' + str(path))
    return value


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        fd = rp.open_file(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        rp.replace(temporary, path)
        rp.sync_directory(path.parent)
    finally:
        rp.native_path(temporary).unlink(missing_ok=True)


def environment(prefix: Path, spec: dict | None = None) -> dict[str, str]:
    # Resolve only prefix-relative runtime settings, never donor absolute paths.
    settings = (spec or {}).get('environment', {})
    system = (spec or {}).get('platform', {}).get('system', platform.system())
    defaults = (['', 'Library/mingw-w64/bin', 'Library/usr/bin', 'Library/bin',
                 'Scripts', 'bin'] if system == 'Windows' else ['bin'])
    directories = [prefix / item for item in settings.get('path', defaults)]
    clean = {key: value for key, value in os.environ.items()
             if not key.upper().startswith(('PYTHON', 'PIP_', 'CONDA_', 'DYLD_'))
             and key.upper() not in ('VIRTUAL_ENV', 'PROJ_LIB', 'PROJ_DATA', 'GDAL_DATA',
                                     'GDAL_DRIVER_PATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'NODE_PATH', 'NODE_OPTIONS')}
    clean.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1',
                 PYTHONUTF8='1', PIP_NO_INDEX='1', PIP_CONFIG_FILE=os.devnull,
                 CONDA_PREFIX=str(prefix))
    # Windows's environment is case-insensitive even when passed as a Python dict.
    old_path = next((v for k, v in clean.items() if k.upper() == 'PATH'), '')
    clean = {k:v for k,v in clean.items() if k.upper() != 'PATH'}
    clean['PATH'] = os.pathsep.join(map(str, directories)) + (os.pathsep + old_path if old_path else '')
    if system == 'Linux' and (prefix / 'bin/node').is_file() and (prefix / 'lib').is_dir():
        inherited = os.environ.get('LD_LIBRARY_PATH','') if (spec or {}).get('schema',SCHEMA) == SCHEMA else ''
        clean['LD_LIBRARY_PATH'] = str(prefix / 'lib') + (os.pathsep+inherited if inherited else '')
    # Mach-O binaries must retain relocatable @rpath/@loader_path references;
    # DYLD overrides would conceal a broken bundle and leak another environment.
    defaults = {'proj_data': 'Library/share/proj' if system == 'Windows' else 'share/proj',
                'gdal_data': 'Library/share/gdal' if system == 'Windows' else 'share/gdal'}
    for key, variable in [('proj_data', 'PROJ_DATA'), ('gdal_data', 'GDAL_DATA')]:
        path = prefix / settings.get(key, defaults[key])
        if path.is_dir():
            clean[variable] = str(path)
    # Preserve Current195's validated relocated CA store and explicit local choice.
    certificates = prefix / settings.get('ssl_cert_file', 'Library/ssl/cert.pem' if system == 'Windows' else 'ssl/cert.pem')
    if 'SSL_CERT_FILE' not in clean and certificates.is_file():
        import ssl
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cafile=str(certificates))
        if not context.cert_store_stats()['x509_ca']:
            raise ValueError('The supplied relocated trust store contains no certificate authorities.')
        clean['SSL_CERT_FILE'] = str(certificates)
    return clean


def native_identity(python: Path, application: Path, spec: dict | None = None) -> dict:
    # Keep a virtual environment's selected path, not its realpath.
    python = Path(os.path.abspath(python.expanduser()))
    if not python.is_file() or (os.name != 'nt' and not os.access(python, os.X_OK)):
        raise ValueError('Select the executable Python supplied with the scientific runtime: ' + str(python))
    guessed = python.parent if python.name.lower().endswith('.exe') else python.parent.parent
    identity_code = 'import json,sys;print(json.dumps({"prefix":sys.prefix}))'
    identity = subprocess.run([str(python), '-I', '-c', identity_code],
                              capture_output=True, text=True, encoding='utf-8', check=False,
                              env=environment(guessed, spec), timeout=120)
    if identity.returncode:
        raise RuntimeError(identity.stderr.strip() or 'The supplied Python could not start.')
    prefix = Path(json.loads(identity.stdout)['prefix']).resolve(strict=True)
    dll_directories = [str(prefix / name) for name in (spec or {}).get('environment',{}).get('path',['','Library/bin','Library/usr/bin','Library/mingw-w64/bin'])]
    result = subprocess.run([str(python), '-B', '-c', NATIVE_IDENTITY, str(application), json.dumps(dll_directories)],
                            capture_output=True, text=True, encoding='utf-8', check=False,
                            env=environment(prefix, spec), timeout=180)
    if result.returncode:
        raise RuntimeError('The selected scientific runtime could not open this application.\n' + result.stderr.strip())
    value = json.loads(result.stdout)
    value['python'] = str(python)
    if spec:
        wanted = spec.get('python_version')
        if wanted and not (value['python_version'] == wanted or value['python_version'].startswith(wanted+'.')):
            raise ValueError('The supplied Python version differs from its runtime manifest.')
        if spec.get('invest_version') and value['invest_version'] != spec['invest_version']:
            raise ValueError('The supplied InVEST version differs from its runtime manifest.')
        if spec.get('node'):
            node = prefix / spec['node']
            checked = subprocess.run([str(node), '--version'], capture_output=True, text=True,
                                     encoding='utf-8', env=environment(prefix, spec), timeout=30, check=False)
            if checked.returncode or not re.fullmatch(r'v\d+\.\d+\.\d+', checked.stdout.strip()):
                raise RuntimeError('The supplied Node runtime could not start: '+checked.stderr.strip())
            value.update(node=str(node), node_version=checked.stdout.strip().lstrip('v'))
            if spec.get('node_version') and value['node_version'] != spec['node_version'].lstrip('v'):
                raise ValueError('The supplied Node version differs from its runtime manifest.')
    return value


def load_spec(path: Path, *, target: str | None = None) -> dict:
    value = read_json(path)
    selected = target or rp.host_target()
    if value.get('schema') == rp.SCHEMA_V2:
        choices = value.get('platforms',value.get('targets'))
        if 'platforms' in value and 'targets' in value and value['platforms'] != value['targets']:
            raise ValueError('The runtime description contains conflicting platform tables.')
        if isinstance(choices,dict):
            normalized = {}
            for name,entry in choices.items():
                canonical = name.replace('darwin-','macos-',1)
                if canonical in normalized and normalized[canonical] != entry:
                    raise ValueError('The runtime description contains conflicting CPU aliases.')
                normalized[canonical] = entry
            choices = normalized
        if not isinstance(choices, dict) or selected not in choices:
            raise ValueError('This package has no supplied runtime for '+selected+'.')
        entry = choices[selected]
        if not isinstance(entry, dict):
            raise ValueError('Runtime platform entries must be objects.')
        value = {**entry, 'schema': rp.SCHEMA_V2}
    elif value.get('schema') != SCHEMA:
        raise ValueError('Use the runtime description supplied with this application.')
    declared = value.get('platform', {})
    if not isinstance(declared, dict) or rp.target_id(declared.get('system',''), declared.get('machine','')) != selected:
        raise ValueError('The runtime description belongs to another operating system or CPU.')
    value['platform'] = rp.TARGETS[selected]
    value['target'] = selected
    archive = value.get('archive', {})
    if not isinstance(archive, dict):
        raise ValueError('The runtime archive description must be an object.')
    archive = dict(archive)
    archive['filename'] = rp.relative(archive.get('filename', ''))
    if not re.fullmatch(r'[0-9a-f]{64}', str(archive.get('sha256', ''))):
        raise ValueError('The runtime description needs the complete archive SHA-256.')
    if type(archive.get('bytes')) is not int or archive['bytes'] <= 0:
        raise ValueError('The runtime description needs its original byte count.')
    value['archive'] = archive
    value['format'] = value.get('format', archive.get('format', 'zip' if archive['filename'].lower().endswith('.zip') else 'tar.gz'))
    if value['format'] not in ('tar.gz', 'tar.xz', 'tar', 'zip'):
        raise ValueError('Use a supplied tar.gz, tar.xz, tar or ZIP runtime.')
    value['archive_root'] = rp.relative(value.get('archive_root','runtime'), empty=True)
    windows = selected == 'windows-x86_64'
    value['python'] = rp.relative(value.get('python', 'python.exe' if windows else 'bin/python'))
    if value.get('node'):
        value['node'] = rp.relative(value['node'])
    relocation = value.get('relocation', {'script': value.get('conda_unpack', 'Scripts/conda-unpack-script.py' if windows else 'bin/conda-unpack')})
    if not isinstance(relocation, dict) or relocation.get('kind','conda-unpack') not in ('conda-unpack', 'none'):
        raise ValueError('Select the supplied conda-unpack script or an explicitly relocation-free runtime.')
    if relocation.get('kind') != 'none':
        relocation = {**relocation, 'script': rp.relative(relocation.get('script',''))}
    if value.get('conda_unpack') and relocation.get('script') != value['conda_unpack']:
        raise ValueError('The runtime description contains conflicting relocation scripts.')
    value['relocation'] = relocation
    settings = value.get('environment', {})
    if not isinstance(settings, dict) or set(settings)-{'path','gdal_data','proj_data','ssl_cert_file'}:
        raise ValueError('Runtime environment settings must describe only bundled PATH/GDAL/PROJ locations.')
    if 'path' in settings:
        if not isinstance(settings['path'], list) or not settings['path']:
            raise ValueError('The runtime PATH must contain prefix-relative directories.')
        settings = {**settings, 'path': [rp.relative(p, empty=True) for p in settings['path']]}
    for key in ('gdal_data','proj_data','ssl_cert_file'):
        if key in settings:
            settings[key] = rp.relative(settings[key])
    value['environment'] = settings
    return value


def validate_host(spec: dict | None = None) -> None:
    actual = rp.host_target()
    if spec and actual != spec['target']:
        raise ValueError('Use the native opening package for this computer: '+actual+'.')
    if not hasattr(tarfile, 'data_filter'):
        raise ValueError('Use the supplied Python 3.12 or later to receive this runtime.')
    if spec:
        rp.minimum_os(spec)
        if spec.get('minimum_glibc_version'):
            name, version = platform.libc_ver()
            minimum = spec['minimum_glibc_version']
            if name != 'glibc' or tuple(map(int,version.split('.'))) < tuple(map(int,minimum.split('.'))):
                raise ValueError('This runtime requires glibc '+minimum+' or later.')


def private_directory(path: Path) -> Path:
    if rp.linked(path):
        raise ValueError('Select a real directory for the installed scientific tools: '+str(path))
    rp.native_path(path).mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'nt':
        # The normal per-user AppData location inherits its user's ACL. Win32
        # validates the actual directory/reparse state; chmod is not an ACL API.
        rp.sync_directory(path)
    elif path.stat().st_uid != os.getuid():
        raise ValueError('Select runtime storage owned by the current user.')
    else:
        path.chmod(0o700)
    resolved = path.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError('Runtime storage is not a directory.')
    return resolved


@contextlib.contextmanager
def installation_lock(directory: Path):
    if os.name == 'nt':
        waiting = False
        while True:
            try:
                fd = rp.windows_custody_file(directory / 'install.lock')
                break
            except BlockingIOError:
                if not waiting:
                    say('These scientific tools are already being prepared. This opening will reuse that installation.')
                    waiting = True
                time.sleep(0.2)
        try:
            yield fd
        finally:
            os.close(fd)
        return
    locks = rp.file_locks()
    fd = rp.open_file(directory / 'install.lock', os.O_RDWR | os.O_CREAT)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('Runtime installation lock is not a regular file.')
        try:
            locks.flock(fd, locks.LOCK_EX | locks.LOCK_NB)
        except BlockingIOError:
            say('These scientific tools are already being prepared. This opening will reuse that installation.')
            locks.flock(fd, locks.LOCK_EX)
        yield fd
    finally:
        os.close(fd)


def archive_stream(path: Path, expected: dict):
    if rp.linked(path):
        raise ValueError('Select the original downloaded runtime archive, not a linked file.')
    stream = os.fdopen(rp.open_file(path, os.O_RDONLY), 'rb')
    try:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected['bytes']:
            raise ValueError('The scientific runtime download is incomplete or belongs to another edition.')
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(BLOCK), b''):
            digest.update(block)
        after = os.fstat(stream.fileno())
        if rp.stamp_file(before) != rp.stamp_file(after):
            raise ValueError('The runtime download changed while it was being read.')
        if digest.hexdigest() != expected['sha256']:
            raise ValueError('The runtime download differs from the supplied original. Receive the complete original archive again.')
        stream.seek(0)
        return stream
    except BaseException:
        stream.close()
        raise


def extract_received_pack(stream, destination: Path, spec: dict | None = None) -> None:
    spec = spec or {'platform': rp.TARGETS['linux-x86_64'], 'archive_root': 'runtime',
                    'format': 'tar.gz', 'python': 'bin/python', 'relocation': {'script': 'bin/conda-unpack'}}
    root = spec['archive_root']
    extraction = destination if root else destination / 'runtime'
    rp.native_path(extraction).mkdir(parents=True, exist_ok=True)
    required = {posixpath.join(root, spec['python'])}
    if spec.get('node'):
        required.add(posixpath.join(root, spec['node']))
    if spec['relocation'].get('kind') != 'none':
        required.add(posixpath.join(root, spec['relocation']['script']))
    def check(entries, size):
        rp.check_member_names(entries, spec)
        names = {name.rstrip('/') for name, _ in entries}
        if root and any(name != root and not name.startswith(root+'/') for name in names):
            raise ValueError('The runtime archive has a member outside its declared root.')
        if not required <= names:
            raise ValueError('The complete supplied executables and relocation script are required: '+', '.join(sorted(required-names)))
        if shutil.disk_usage(destination).free < size:
            raise OSError('There is not enough disk space to unpack the scientific tools.')
    if spec['format'] == 'zip':
        with zipfile.ZipFile(stream) as archive:
            members = archive.infolist()
            entries = []
            for member in members:
                mode = member.external_attr >> 16
                kind = 'directory' if member.is_dir() else 'file'
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)) or member.flag_bits & 1:
                    raise ValueError('Supply an unencrypted ZIP of original regular runtime files and directories.')
                entries.append((member.filename, kind))
            check(entries, sum(member.file_size for member in members))
            for member in members:
                target = rp.native_path(extraction / member.filename)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, os.fdopen(rp.open_file(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as output:
                    shutil.copyfileobj(source, output, BLOCK)
                if os.name != 'nt':
                    target.chmod((member.external_attr >> 16) & 0o777 or 0o600)
    else:
        with tarfile.open(fileobj=stream, mode='r:*') as archive:
            members = archive.getmembers()
            entries = []
            for member in members:
                if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise ValueError('The runtime archive contains an unsupported special file.')
                if spec['platform']['system'] == 'Windows' and member.issym():
                    raise ValueError('The Windows runtime must contain regular files rather than require symlink privileges.')
                if member.issym() or member.islnk():
                    if member.linkname.startswith('/') or '\\' in member.linkname or ':' in member.linkname:
                        raise ValueError('Runtime links must remain inside their supplied prefix.')
                    target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname) if member.issym() else member.linkname)
                    if target.startswith('../') or target == '..' or (root and target != root and not target.startswith(root+'/')):
                        raise ValueError('Runtime link points outside its supplied prefix.')
                entries.append((member.name, 'directory' if member.isdir() else 'file'))
            check(entries, sum(member.size for member in members))
            archive.extractall(rp.native_path(extraction), members=members, filter='data')


def relocate(prefix: Path, log: Path, lease_fd: int, spec: dict | None = None) -> None:
    spec = spec or {'python': 'bin/python', 'relocation': {'script': 'bin/conda-unpack'}}
    if spec['relocation'].get('kind') == 'none':
        return
    command = [str(prefix / spec['python']), '-B', str(prefix / spec['relocation']['script'])]
    with log.open('ab') as output:
        options = {'stdout': output, 'stderr': subprocess.STDOUT, 'env': environment(prefix,spec)}
        if os.name == 'nt':
            import msvcrt
            # Inherit this one duplicate, never all handles in the opening process.
            # Each attempt has its own permanent prefix even after parent death.
            duplicate = os.dup(lease_fd)
            handle = msvcrt.get_osfhandle(duplicate)
            try:
                os.set_handle_inheritable(handle, True)
                startup = subprocess.STARTUPINFO()
                startup.lpAttributeList = {'handle_list': [handle]}
                child = subprocess.Popen(command, **options, startupinfo=startup,
                    close_fds=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            finally:
                os.close(duplicate)
        else:
            child = subprocess.Popen(command, **options, pass_fds=(lease_fd,), start_new_session=True)
        try:
            code = child.wait()
        except BaseException:
            if child.poll() is None:
                if os.name == 'nt':
                    child.terminate()  # Popen's owned process handle, not a recycled PID.
                else:
                    os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        child.kill()
                    else:
                        os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise
        if code:
            raise RuntimeError('The supplied relocation command exited '+str(code)+'. Details: '+str(log))



def validate_payload(prefix: Path, spec: dict) -> None:
    for key in ('python','node'):
        if not spec.get(key):
            continue
        path = prefix / spec[key]
        if not path.resolve(strict=True).is_relative_to(prefix.resolve(strict=True)):
            raise ValueError('The runtime executable points outside its supplied prefix.')
        if os.name != 'nt' and not os.access(path,os.X_OK):
            raise ValueError('The supplied executable lost its executable permissions: '+spec[key])
        system, machines = rp.binary_target(path)
        if system != spec['platform']['system'] or spec['platform']['machine'] not in machines:
            raise ValueError('The supplied '+key+' executable belongs to a different OS or CPU.')
    for name,key in [('GDAL tables','gdal_data'),('PROJ database','proj_data')]:
        value = spec.get('environment',{}).get(key)
        if value:
            path = prefix / value
            if not path.is_dir() or not path.resolve().is_relative_to(prefix.resolve()):
                raise ValueError('The supplied '+name+' directory is missing or outside the runtime.')
            if key == 'proj_data' and not (path/'proj.db').is_file():
                raise ValueError('The supplied PROJ database is missing.')


def inspect_inventory(prefix: Path, saved: dict | None = None) -> dict:
    """Bind original bytes after relocation; permit later exact offline additions."""
    previous = saved.get('files',{}) if saved else {}
    files = {}
    for directory, dirs, names in os.walk(rp.native_path(prefix),followlinks=False):
        for name in dirs + names:
            path = Path(directory) / name
            key = path.relative_to(rp.native_path(prefix)).as_posix()
            if saved and key not in previous:
                # The existing offline Node/Excel preparer owns additive files
                # and validates their payloads; do not freeze its destination.
                continue
            value = path.lstat()
            if rp.linked(path):
                if not stat.S_ISLNK(value.st_mode) or not path.resolve(strict=True).is_relative_to(rp.native_path(prefix).resolve()):
                    raise ValueError('The installed runtime contains an external link or reparse point: '+key)
                entry = {'kind':'link','target':os.readlink(path)}
            elif stat.S_ISDIR(value.st_mode):
                continue
            elif stat.S_ISREG(value.st_mode):
                old = previous.get(key,{})
                signature = rp.stamp_file(value)
                if old.get('kind') == 'file' and old.get('stat') == signature:
                    entry = old
                else:
                    digest, signature = rp.file_hash(path)
                    entry = {'kind':'file','sha256':digest,'stat':signature}
            else:
                raise ValueError('The installed runtime contains a special file: '+key)
            if saved:
                old = previous.get(key)
                if not old or {k:v for k,v in entry.items() if k != 'stat'} != {k:v for k,v in old.items() if k != 'stat'}:
                    raise ValueError('An installed runtime member changed: '+key)
            files[key] = entry
    if saved and files.keys() != previous.keys():
        raise ValueError('An installed runtime member is missing.')
    return {'schema':'upstate.received-native-files/v1','files':files}

def receive(application: Path, spec_path: Path, *, archive: Path | None = None,
            storage: Path | None = None, python: Path | None = None) -> dict:
    application = application.expanduser().resolve(strict=True)
    if not (application / 'model/native.py').is_file():
        raise ValueError('Select the complete application containing model/native.py.')
    if python is not None:
        result = native_identity(python, application)
        return {'schema': STATE_SCHEMA, 'state': 'ready', 'reused': True,
                'external': True, **result}
    spec_path = spec_path.expanduser().resolve(strict=True)
    spec = load_spec(spec_path)
    validate_host(spec)
    target = spec['archive']
    base = (storage or rp.default_storage()).expanduser().absolute()
    if base.resolve().is_relative_to(application) or base.resolve().is_relative_to(spec_path.parent):
        raise ValueError('Keep installed scientific tools outside the portable application folder.')
    # Legacy keys remain usable; v2 separates platform, bytes and relocation recipe.
    identity = hashlib.sha256(json.dumps(spec,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    location = base / target['sha256'] if spec['schema'] == SCHEMA else base / spec['target'] / target['sha256'] / identity[:16]
    cache = private_directory(location)
    record = cache / 'installation.json'
    with installation_lock(cache) as lease_fd:
        previous = read_json(record) if record.exists() else {}
        if previous.get('state') == 'ready':
            if previous.get('schema') != STATE_SCHEMA or previous.get('archive') != target:
                raise ValueError('The saved runtime installation belongs to another edition.')
            if previous.get('spec_sha256') and previous['spec_sha256'] != identity:
                raise ValueError('The saved runtime layout differs from its current description.')
            prefix = Path(previous['prefix'])
            root = spec['archive_root'] or 'runtime'
            relative = prefix.relative_to(cache) if prefix.is_absolute() else Path('invalid')
            if (len(relative.parts) != len(PurePosixPath(root).parts)+1
                    or not relative.parts[0].startswith('attempt-')
                    or '/'.join(relative.parts[1:]) != root
                    or not prefix.resolve(strict=True).is_relative_to(cache)
                    or any(rp.linked(cache / Path(*relative.parts[:i])) for i in range(1,len(relative.parts)+1))):
                raise ValueError('The retained installed runtime location has changed.')
            inventory_path = prefix.parent / 'runtime-files.json'
            if previous.get('inventory_sha256'):
                if rp.file_hash(inventory_path)[0] != previous['inventory_sha256']:
                    raise ValueError('The retained runtime inventory changed.')
                inspect_inventory(prefix, read_json(inventory_path))
            validate_payload(prefix,spec)
            result = native_identity(prefix / spec['python'], application, spec)
            if Path(result['prefix']).resolve() != prefix.resolve():
                raise ValueError('The supplied interpreter selected a different runtime prefix.')
            return {**previous, **result, 'reused': True, 'platform': spec['platform'], 'runtime_spec': spec}
        selected_archive = (archive or spec_path.parent / target['filename']).expanduser().absolute()
        if not selected_archive.is_file():
            raise FileNotFoundError('Put '+target['filename']+' beside the application opening files, then open again.')
        say('Preparing the supplied scientific tools for '+spec['target']+'. This happens once per runtime edition.')
        attempt = private_directory(cache / ('attempt-'+uuid.uuid4().hex))
        prefix = attempt / (spec['archive_root'] or 'runtime')
        state = {'schema': STATE_SCHEMA, 'archive': target, 'platform': spec['platform'],
                 'spec_sha256': identity, 'runtime_spec': spec, 'state': 'receiving',
                 'prefix': str(prefix), 'started_at': stamp()}
        atomic_json(record,state)
        try:
            with archive_stream(selected_archive,target) as stream:
                verified_state = rp.stamp_file(os.fstat(stream.fileno()))
                extract_received_pack(stream,attempt,spec)
                if rp.stamp_file(os.fstat(stream.fileno())) != verified_state:
                    raise ValueError('The runtime archive changed during extraction.')
            validate_payload(prefix,spec)
            state['state'] = 'relocating'
            atomic_json(record,state)
            relocate(prefix,attempt / 'relocation.log',lease_fd,spec)
            state['state'] = 'loading'
            atomic_json(record,state)
            actual = native_identity(prefix / spec['python'], application, spec)
            if Path(actual['prefix']).resolve() != prefix.resolve():
                raise ValueError('The supplied interpreter selected a different runtime prefix.')
            inventory = inspect_inventory(prefix)
            inventory_path = prefix.parent / 'runtime-files.json'
            atomic_json(inventory_path,inventory)
            state.update(actual,state='ready',completed_at=stamp(), inventory_sha256=rp.file_hash(inventory_path)[0])
            atomic_json(record,state)
            say('Scientific tools are ready. Opening your existing workbench.')
            return {**state,'reused':False}
        except BaseException as error:
            state.update(state='interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else 'failed',
                         error={'type':type(error).__name__,'message':str(error)},finished_at=stamp())
            atomic_json(record,state)
            # A retry receives into a NEW permanent prefix. Never relocate a
            # possibly half-patched prefix twice or move a completed prefix.
            raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', type=Path, required=True)
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--archive', type=Path, default=os.environ.get('ECOSYSTEMS_RUNTIME_ARCHIVE'))
    parser.add_argument('--storage', type=Path, default=os.environ.get('ECOSYSTEMS_RUNTIME_STORAGE'))
    parser.add_argument('--python', type=Path, default=os.environ.get('ECOSYSTEMS_PYTHON'))
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--open-script', type=Path,
                        help='The existing package opening script; its arguments and controller stay unchanged.')
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        result = receive(args.application, args.spec, archive=args.archive,
                         storage=args.storage, python=args.python)
        if args.prepare_only:
            print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
            return 0
        if args.open_script is None:
            parser.error('Choose the existing package opening script, or use --prepare-only.')
        script = args.open_script.expanduser().resolve(strict=True)
        if not script.is_file():
            raise ValueError('Select the existing package opening script.')
        env = environment(Path(result['prefix']),result.get('runtime_spec'))
        env['ECOSYSTEMS_PYTHON'] = result['python']
        if result.get('node'):
            env['ECOSYSTEMS_NODE'] = result['node']
        forwarded = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
        if script.suffix == '.py':
            command = [result['python'],'-B',str(script),*forwarded]
        elif script.suffix in ('.sh','.command') and os.name != 'nt':
            shell = shutil.which('sh')
            if not shell:
                raise FileNotFoundError('The existing opening script needs a POSIX shell.')
            command = [shell,str(script),*forwarded]
        else:
            raise ValueError('Use the existing Python collection opener, or its POSIX shell opener.')
        if os.name == 'nt':
            # _exec on Windows exits the original process; keep the root console
            # attached until the original collection opener drains and closes.
            child = subprocess.Popen(command,env=env)
            while True:
                try:
                    return child.wait()
                except KeyboardInterrupt:
                    # Same console delivers Ctrl+C to the collection opener too.
                    say('Closing the workbench. Waiting for its original shutdown to finish.')
        os.execve(command[0],command,env)
    except KeyboardInterrupt:
        say('Opening was interrupted. Open the same package again to continue.')
        return 130
    except (OSError, ValueError, RuntimeError, KeyError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        say(str(error))
        return 2
    return 0


if __name__ == '__main__':
    def terminate(_signum, _frame):
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminate)
    raise SystemExit(main())
