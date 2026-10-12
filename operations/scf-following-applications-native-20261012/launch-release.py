from pathlib import Path
from types import SimpleNamespace
import json
import os
import sys

ROOT = Path('/workspace/scratch/d1ccf784531e/scf-following-release')
HOST = Path('/workspace/scratch/d1ccf784531e/native-prelaunch-recovery/runtime-joint/host')
sys.path.insert(0, str(HOST))
os.environ['SWARM_NODE24_BIN'] = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin'
import swarm_cloud_job as native
from native_foreground import ForegroundLaunch

intent_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'native-48138940f4e4/release-intent.json'
selected = json.loads(intent_path.read_text())
source_prefix = selected['sourceCommit'][:8]
args = SimpleNamespace(
    operation_id='scf-following-source-release-' + source_prefix + '-d1cc-20261011', peer='d1cc-scf-distribution',
    project=str(ROOT), command=['node', str(ROOT / 'run-release.mjs'),
        str(intent_path)], java=None, node='24',
    artifact=[str(Path(selected['operationRoot']).relative_to(ROOT) / 'installation.json')],
    runtime_path=[selected['builderDirectory'], selected['sourceCache'],
        '/dev/shm/scf-cumulative-release-0c7a-f8db4d8cff51/source.git/objects',
        '/dev/shm/f1cb-scf-following-release/source.git/objects',
        '/dev/shm/f1cb7e3fb7bf-scf/.git/objects'],
    runtime_consumers_root='/workspace/shared/swarm/jobs/runtime-consumers',
    memory_mib=256, memory_reserve_mib=128, memory_reclaim='clean-cache',
    memory_reservations_root='/workspace/shared/swarm/capacity/memory',
    disk_space=[str(ROOT) + '=96'], disk_inodes=[str(ROOT) + '=6144'],
    disk_reserve_mib=64, disk_reserve_inodes=128,
    disk_reservations_root='/workspace/shared/swarm/capacity/disk',
    records_root=str(ROOT / 'records'), worker_root=str(ROOT / 'worker'), temp_root=str(ROOT / 'temporary'))
launch = ForegroundLaunch(native)
try:
    report = native.start(args, launcher=launch)
    print(json.dumps({key: report.get(key) for key in ['operation_id', 'record', 'state',
        'supervisor_alive', 'process_alive', 'reused']}), flush=True)
finally:
    if launch.root is not None:
        code = launch.handoff()
        if code is not None:
            raise SystemExit(code)
