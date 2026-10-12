# MIT. Use the existing complete native foreground and its original artifact collector.
from pathlib import Path
from types import SimpleNamespace
import hashlib,json,os,sys

base=Path(__file__).resolve().parent
host=Path('/workspace/scratch/dbc61db6310c/native-runtime-maintained-903bec05/host')
native_sha='dbf3605fdd032a53d3b96c411e9ad72fac0df9136bafa61080b4f112f16061ff'
receipt=json.loads((host.parent/'COMPLETE_RUNTIME.json').read_text())
if receipt['native_runtime']['sha256']!=native_sha:
    raise ValueError('Preserve the changed maintained native runtime')
for name,wanted in receipt['native_runtime']['files'].items():
    if hashlib.sha256((host/name).read_bytes()).hexdigest()!=wanted:
        raise ValueError('The original native member changed: '+name)
selected=json.loads((base/'native-input.json').read_text())
project=Path(selected['projectDirectory'])
project.mkdir(mode=0o700,parents=True,exist_ok=True)
(project/'delivery').mkdir(mode=0o700,exist_ok=True)
sys.path.insert(0,str(host))
os.environ['SWARM_NODE24_BIN']='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin'
os.environ['NODE_OPTIONS']='--max-old-space-size=160'
os.environ['PYTHONDONTWRITEBYTECODE']='1'
import swarm_cloud_job as native
from native_foreground import ForegroundLaunch
records=base/'native-records'
paths=[str(host),str(base),selected['builderDirectory'],selected['previousRuntime'],
       selected['sourceWorkspace'],selected['sourceProcessingWorkspace'],
       '/workspace/scratch/99d0e4920ad7/scf-applications/source.git',
       '/workspace/scratch/99d0e4920ad7/scf-applications/source',
       '/workspace/scratch/7108267765ab/fiscal-applications-native/source-10f5/cache/repository.git',
       '/workspace/scratch/84ebf86ab95a/native-merchant-application-84eb/runtime-c287/source']
args=SimpleNamespace(
    operation_id=selected['operationId'],peer='b710-stac-applications',
    project=str(project),command=[sys.executable,'-B',str(base/'receive-and-continue.py')],
    java=None,node='24',
    artifact=['delivery'],artifact_on_success=[],artifact_on_failure=[],retain_artifacts=True,
    runtime_path=[path for path in paths if path and Path(path).exists()],
    runtime_consumers_root='/workspace/shared/swarm/jobs/runtime-consumers',
    memory_mib=512,memory_reserve_mib=128,memory_reclaim='clean-cache',
    memory_reservations_root='/workspace/shared/swarm/capacity/memory',
    disk_space=[str(project)+'=512',str(records)+'=48'],
    disk_inodes=[str(project)+'=26000',str(records)+'=4096'],
    disk_reserve_mib=8,disk_reserve_inodes=128,
    disk_reservations_root='/workspace/shared/swarm/capacity/disk',
    records_root=str(records),worker_root=str(project/'workers'),temp_root=str(project/'temporary'))
if '--resume' in sys.argv:
    from native_foreground import resume_foreground
    report=resume_foreground(native,selected['operationId'],str(records),
        action='resume-capacity',recover_failure=None,report_format='summary')
    print(json.dumps(native.report_value(report,'summary')),flush=True)
    raise SystemExit(native.exit_status(report))
launch=ForegroundLaunch(native)
try:
    report=native.start(args,launcher=launch)
    print(json.dumps({key:report.get(key) for key in
        ['operation_id','record','state','supervisor_alive','process_alive','reused']}),flush=True)
finally:
    if launch.root is not None:
        result=launch.handoff()
        if result is not None:raise SystemExit(result)
