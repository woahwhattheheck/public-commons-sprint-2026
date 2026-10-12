"""Keep the original util-linux controlling terminal inside one native job."""
from pathlib import Path
import os, json, subprocess, shlex, stat, shutil
BASE = Path(os.environ.get('NWS_JOURNEY_DIRECTORY', '/workspace/scratch/b3909ae247f2/nws-site-weather'))
PRIVATE = BASE / 'private'
FIFO = PRIVATE / 'operator-input.fifo'
NODE = Path(os.environ.get('NWS_NODE_EXECUTABLE', shutil.which('node') or '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'))
SCRIPT = Path(__file__).resolve().with_name('native-journey.mjs')
os.umask(0o077)
PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
temp = PRIVATE / 'native-tmp'
temp.mkdir(exist_ok=True, mode=0o700)
terminal = shutil.which('script')
if not terminal:
    raise RuntimeError('Original util-linux terminal launcher is unavailable')
if FIFO.exists():
    raise RuntimeError('Retained original input endpoint must be reconciled before another terminal')
os.mkfifo(FIFO, 0o600)
identity = FIFO.stat()
descriptor = os.open(FIFO, os.O_RDWR | os.O_NOFOLLOW)
environment = dict(os.environ)
environment['TMPDIR'] = str(temp)
environment['NODE_OPTIONS'] = '--max-old-space-size=384'
environment['NODE_EXTRA_CA_CERTS'] = os.environ.get('NWS_CA_FILE', str(Path(os.environ.get('NWS_ORIGINAL_OPERATOR_ROOT', '/workspace/scratch/39daa82f3fbd/routescan_native_39da')) / 'tls' / 'extra-ca.pem'))
print(json.dumps({'phase':'ORIGINAL_TERMINAL_READY', 'input':str(FIFO),
                  'script':str(SCRIPT), 'pid':os.getpid()}), flush=True)
try:
    result = subprocess.run(
        [terminal, '-qefc', shlex.join([str(NODE), '--use-system-ca', str(SCRIPT)]), '/dev/null'],
        env=environment, stdin=descriptor, cwd=str(BASE), close_fds=True)
finally:
    os.close(descriptor)
    try:
        current = FIFO.lstat()
        if stat.S_ISFIFO(current.st_mode) and (current.st_dev,current.st_ino) == (identity.st_dev,identity.st_ino):
            FIFO.unlink()
    except FileNotFoundError:
        pass
raise SystemExit(result.returncode)
