# MIT. Run the original D1CC/A5F3 following edition in one retained foreground.
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import os
import sys

ROOT = Path('/workspace/scratch/d1ccf784531e/scf-following-release')
INPUT = ROOT / 'native-4c3e572ce539'
HOST = Path('/workspace/scratch/dbc61db6310c/native-runtime-maintained-903bec05/host')
PROJECT = Path('/dev/scf-following-4c3e572ce539')
EXPECTED_NATIVE = 'dbf3605fdd032a53d3b96c411e9ad72fac0df9136bafa61080b4f112f16061ff'
EXPECTED = {
    'continue-applications.mjs': 'a40ff1b769fa9b5241e72fadc4e46f26983735ca',
    'copy-dataset-workspace.py': '53475d6e48779a4defc3cc829694f74f1fbf0267',
    'continuation-input.json': '0159163791ae23204e48555ac8b931e07373a0d1',
}
for name, wanted in EXPECTED.items():
    content = (INPUT / name).read_bytes()
    observed = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    if observed != wanted:
        raise ValueError('The original continuation helper changed: ' + name)
receipt = json.loads((HOST.parent / 'COMPLETE_RUNTIME.json').read_text())
if receipt['native_runtime']['sha256'] != EXPECTED_NATIVE:
    raise ValueError('The original maintained foreground runtime changed')
for name, wanted in receipt['native_runtime']['files'].items():
    if hashlib.sha256((HOST / name).read_bytes()).hexdigest() != wanted:
        raise ValueError('The original native runtime member changed: ' + name)
selected = json.loads((INPUT / 'continuation-input.json').read_text())
if selected['projectDirectory'] != str(PROJECT):
    raise ValueError('The original private placement changed')
PROJECT.mkdir(mode=0o700, parents=True, exist_ok=True)
(PROJECT / 'delivery').mkdir(mode=0o700, exist_ok=True)
sys.path.insert(0, str(HOST))
os.environ['SWARM_NODE24_BIN'] = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin'
os.environ['NODE_OPTIONS'] = '--max-old-space-size=160'
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
import swarm_cloud_job as native
from native_foreground import ForegroundLaunch

args = SimpleNamespace(
    operation_id=selected['operationId'], peer='a5f3-scf-distribution',
    project=str(PROJECT),
    command=['node', str(INPUT / 'continue-applications.mjs'), str(INPUT / 'continuation-input.json')],
    java=None, node='24',
    artifact=['delivery'], artifact_on_success=[], artifact_on_failure=[], retain_artifacts=True,
    runtime_path=[
        str(HOST), str(INPUT), str(ROOT / 'selected-builder-4c3e572ce539'),
        str(ROOT / 'run-release.mjs'), str(ROOT / 'source.git'),
        selected['previousRuntime'],
        '/workspace/scratch/3ad791503e87/artifacts/SCF_NDJSON_Complete_Receiving_Workspace_20261012.zip',
        '/dev/shm/scf-cumulative-release-0c7a-f8db4d8cff51/source.git/objects',
        '/dev/shm/f1cb-scf-following-release/source.git/objects',
        '/dev/shm/f1cb7e3fb7bf-scf/.git/objects',
    ],
    runtime_consumers_root='/workspace/shared/swarm/jobs/runtime-consumers',
    memory_mib=768, memory_reserve_mib=128, memory_reclaim='clean-cache',
    memory_reservations_root='/workspace/shared/swarm/capacity/memory',
    disk_space=[str(PROJECT) + '=384', str(ROOT / 'records') + '=32'],
    disk_inodes=[str(PROJECT) + '=20000', str(ROOT / 'records') + '=2048'],
    disk_reserve_mib=8, disk_reserve_inodes=128,
    disk_reservations_root='/workspace/shared/swarm/capacity/disk',
    records_root=str(ROOT / 'records'),
    worker_root=str(PROJECT / 'workers'), temp_root=str(PROJECT / 'temporary'),
)
if '--resume' in sys.argv:
    from native_foreground import resume_foreground
    report = resume_foreground(native, selected['operationId'], str(ROOT / 'records'),
                               action='resume-capacity', recover_failure=None, report_format='summary')
    print(json.dumps(native.report_value(report, 'summary')), flush=True)
    raise SystemExit(native.exit_status(report))
launch = ForegroundLaunch(native)
try:
    report = native.start(args, launcher=launch)
    print(json.dumps({key: report.get(key) for key in
                      ['operation_id', 'record', 'state', 'supervisor_alive', 'process_alive', 'reused']}),
          flush=True)
finally:
    if launch.root is not None:
        result = launch.handoff()
        if result is not None:
            raise SystemExit(result)
