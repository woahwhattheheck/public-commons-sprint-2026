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

SCHEMA = 'upstate.offline-native-runtime/v1'
STATE_SCHEMA = 'upstate.received-native-runtime/v1'
BLOCK = 1024 * 1024
# The original application performs the scientific version/source selection.
NATIVE_IDENTITY = r'''
import json, sys, importlib.metadata
from pathlib import Path
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
    with path.open(encoding='utf-8') as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError('Expected an object in ' + str(path))
    return value


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def environment(prefix: Path) -> dict[str, str]:
    # Use the chosen runtime's GIS tables even when the calling shell has another
    # conda environment or a system PROJ installation activated.
    clean = {key: value for key, value in os.environ.items()
             if not key.startswith(('PYTHON', 'PIP_', 'CONDA_'))
             and key not in ('VIRTUAL_ENV', 'PROJ_LIB', 'PROJ_DATA', 'GDAL_DATA')}
    clean.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1',
                 PIP_NO_INDEX='1', PIP_CONFIG_FILE=os.devnull,
                 CONDA_PREFIX=str(prefix))
    clean['PATH'] = str(prefix / 'bin') + os.pathsep + clean.get('PATH', '')
    # The packaged native Node uses this selected runtime's C++ libraries.
    if (prefix / 'bin/node').is_file() and (prefix / 'lib').is_dir():
        inherited = clean.get('LD_LIBRARY_PATH', '')
        clean['LD_LIBRARY_PATH'] = str(prefix / 'lib') + (os.pathsep + inherited if inherited else '')
    if (prefix / 'share/proj/proj.db').is_file():
        clean['PROJ_DATA'] = str(prefix / 'share/proj')
    if (prefix / 'share/gdal').is_dir():
        clean['GDAL_DATA'] = str(prefix / 'share/gdal')
    # The original raw pack may retain an absent donor OpenSSL default path.
    # Preserve an explicit receiving-machine selection; otherwise validate the
    # supplied relocated trust store without weakening TLS verification.
    certificates = prefix / 'ssl/cert.pem'
    if 'SSL_CERT_FILE' not in clean and certificates.is_file():
        import ssl
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cafile=str(certificates))
        if not context.cert_store_stats()['x509_ca']:
            raise ValueError('The supplied relocated trust store contains no certificate authorities.')
        clean['SSL_CERT_FILE'] = str(certificates)
    return clean


def native_identity(python: Path, application: Path) -> dict:
    # Keep a virtual environment's selected executable path, not its realpath.
    python = Path(os.path.abspath(python.expanduser()))
    if not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError('Select the executable Python supplied with the scientific runtime: ' + str(python))
    identity_code = 'import json,sys;print(json.dumps({"prefix":sys.prefix}))'
    identity = subprocess.run([str(python), '-I', '-c', identity_code],
                              capture_output=True, text=True, check=False,
                              env=environment(python.parent.parent))
    if identity.returncode:
        raise RuntimeError(identity.stderr.strip() or 'The supplied Python could not start.')
    prefix = Path(json.loads(identity.stdout)['prefix']).resolve(strict=True)
    result = subprocess.run([str(python), '-B', '-c', NATIVE_IDENTITY, str(application)],
                            capture_output=True, text=True, check=False, env=environment(prefix))
    if result.returncode:
        raise RuntimeError('The selected scientific runtime could not open this application.\n' + result.stderr.strip())
    value = json.loads(result.stdout)
    value['python'] = str(python)
    return value


def load_spec(path: Path) -> dict:
    value = read_json(path)
    if value.get('schema') != SCHEMA:
        raise ValueError('Use the runtime description supplied with this application.')
    archive = value.get('archive', {})
    name = archive.get('filename', '')
    if not name or Path(name).name != name or '\\' in name:
        raise ValueError('The runtime archive name must be a single filename.')
    if not re.fullmatch(r'[0-9a-f]{64}', archive.get('sha256', '')):
        raise ValueError('The runtime description needs the complete archive SHA-256.')
    if type(archive.get('bytes')) is not int or archive['bytes'] <= 0:
        raise ValueError('The runtime description needs its original byte count.')
    if value.get('platform') != {'system': 'Linux', 'machine': 'x86_64'}:
        raise ValueError('This opening helper requires a Linux x86-64 runtime description.')
    if value.get('archive_root') != 'runtime':
        raise ValueError('This raw-pack adapter requires the supplied runtime/ archive layout.')
    return value


def validate_host() -> None:
    if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('Use the native opening package for this computer. This runtime is for Linux x86-64.')
    if not hasattr(tarfile, 'data_filter'):
        raise ValueError('Use Python 3.12 or later to receive the runtime, or open with the supplied runtime Python.')


def private_directory(path: Path) -> Path:
    if path.is_symlink():
        raise ValueError('Select a real directory for the installed scientific tools: ' + str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    resolved = path.resolve(strict=True)
    if not resolved.is_dir():
        raise ValueError('Runtime storage is not a directory.')
    if resolved.stat().st_uid != os.getuid():
        raise ValueError('Select runtime storage owned by the current user.')
    resolved.chmod(0o700)
    return resolved


@contextlib.contextmanager
def installation_lock(directory: Path):
    import fcntl
    fd = os.open(directory / 'install.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('Runtime installation lock is not a regular file.')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            say('The same scientific tools are being prepared by another opening. Reusing that installation when it finishes.')
            fcntl.flock(fd, fcntl.LOCK_EX)
        yield fd
    finally:
        os.close(fd)


def archive_stream(path: Path, expected: dict):
    if path.is_symlink():
        raise ValueError('Select the original downloaded runtime archive, not a symbolic link.')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    stream = os.fdopen(fd, 'rb')
    try:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected['bytes']:
            raise ValueError('The scientific runtime download is incomplete or belongs to another edition.')
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(BLOCK), b''):
            digest.update(block)
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('The runtime download changed while it was being read.')
        if digest.hexdigest() != expected['sha256']:
            raise ValueError('The runtime download differs from the supplied original. Download the complete original archive again.')
        stream.seek(0)
        return stream
    except BaseException:
        stream.close()
        raise


def extract_received_pack(stream, destination: Path) -> None:
    # The existing delivered file is a raw conda-pack, not a sealed capsule. Keep
    # its wrapper and execute its own conda-unpack; do not implement relocation.
    with tarfile.open(fileobj=stream, mode='r:gz') as archive:
        members = archive.getmembers()
        names = set()
        for member in members:
            name = PurePosixPath(member.name)
            if (name.is_absolute() or not name.parts or name.parts[0] != 'runtime'
                    or '..' in name.parts or '\\' in member.name or member.name in names):
                raise ValueError('The runtime archive has an unexpected member: ' + member.name)
            names.add(member.name)
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('The runtime archive contains an unsupported special file.')
        if not {'runtime/bin/python', 'runtime/bin/conda-unpack'} <= names:
            raise ValueError('The complete Python and conda-unpack files are required.')
        expanded = sum(member.size for member in members)
        if shutil.disk_usage(destination).free < expanded:
            raise OSError('There is not enough disk space to unpack the scientific tools.')
        archive.extractall(destination, members=members, filter='data')


def relocate(prefix: Path, log: Path, lease_fd: int) -> None:
    command = [str(prefix / 'bin/python'), '-B', str(prefix / 'bin/conda-unpack')]
    with log.open('ab') as output:
        child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                                 env=environment(prefix), pass_fds=(lease_fd,), start_new_session=True)
        try:
            code = child.wait()
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise
        if code:
            raise RuntimeError('The supplied relocation command exited ' + str(code) + '. Details: ' + str(log))


def receive(application: Path, spec_path: Path, *, archive: Path | None = None,
            storage: Path | None = None, python: Path | None = None) -> dict:
    application = application.expanduser().resolve(strict=True)
    if not (application / 'model/native.py').is_file():
        raise ValueError('Select the complete application containing model/native.py.')
    if python is not None:
        result = native_identity(python, application)
        return {'schema': STATE_SCHEMA, 'state': 'ready', 'reused': True,
                'external': True, **result}
    validate_host()
    spec_path = spec_path.expanduser().resolve(strict=True)
    spec = load_spec(spec_path)
    target = spec['archive']
    base = (storage or Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
            / 'ecosystem-workbench/runtimes').expanduser().absolute()
    # A moved application must never move its already-relocated runtime prefix.
    if base.resolve().is_relative_to(application) or base.resolve().is_relative_to(spec_path.parent):
        raise ValueError('Keep installed scientific tools outside the portable application folder.')
    cache = private_directory(base / target['sha256'])
    record = cache / 'installation.json'
    with installation_lock(cache) as lease_fd:
        previous = read_json(record) if record.exists() else {}
        if previous.get('state') == 'ready':
            if previous.get('schema') != STATE_SCHEMA or previous.get('archive') != target:
                raise ValueError('The saved runtime installation belongs to another edition.')
            prefix = Path(previous['prefix'])
            if (not prefix.is_absolute() or not prefix.resolve(strict=True).is_relative_to(cache)
                    or prefix.name != 'runtime' or prefix.is_symlink()
                    or prefix.parent.is_symlink()):
                raise ValueError('The retained installed runtime location has changed.')
            result = native_identity(prefix / 'bin/python', application)
            return {**previous, **result, 'reused': True}
        selected_archive = (archive or spec_path.parent / target['filename']).expanduser().absolute()
        if not selected_archive.is_file():
            raise FileNotFoundError('Put ' + target['filename'] + ' beside the application opening files, then open again.')
        say('Preparing the supplied scientific tools for this computer. This happens once per runtime edition.')
        attempt = private_directory(cache / ('attempt-' + uuid.uuid4().hex))
        prefix = attempt / 'runtime'
        state = {'schema': STATE_SCHEMA, 'archive': target, 'state': 'receiving',
                 'prefix': str(prefix), 'started_at': stamp()}
        atomic_json(record, state)
        try:
            with archive_stream(selected_archive, target) as stream:
                extract_received_pack(stream, attempt)
            state['state'] = 'relocating'
            atomic_json(record, state)
            relocate(prefix, attempt / 'relocation.log', lease_fd)
            state['state'] = 'loading'
            atomic_json(record, state)
            actual = native_identity(prefix / 'bin/python', application)
            state.update(actual, state='ready', completed_at=stamp())
            atomic_json(record, state)
            say('Scientific tools are ready. Opening your existing workbench.')
            return {**state, 'reused': False}
        except BaseException as error:
            state.update(state='interrupted' if isinstance(error, (KeyboardInterrupt, SystemExit)) else 'failed',
                         error={'type': type(error).__name__, 'message': str(error)}, finished_at=stamp())
            atomic_json(record, state)
            # A retry creates a new final prefix. A possibly half-relocated
            # prefix is kept with its log, never run through conda-unpack again.
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
        if script.suffix != '.sh' or not script.is_file():
            raise ValueError('Select the existing shell opening script from this package.')
        shell = shutil.which('sh')
        if not shell:
            raise FileNotFoundError('The existing opening script needs a POSIX shell.')
        env = environment(Path(result['prefix']))
        env['ECOSYSTEMS_PYTHON'] = result['python']
        forwarded = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
        os.execve(shell, [shell, str(script), *forwarded], env)
    except KeyboardInterrupt:
        say('Opening was interrupted. Open the same package again to continue.')
        return 130
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        say(str(error))
        return 2
    return 0


if __name__ == '__main__':
    def terminate(_signum, _frame):
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminate)
    raise SystemExit(main())
