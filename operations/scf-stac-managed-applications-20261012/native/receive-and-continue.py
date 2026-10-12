# MIT. The original source receiver followed by the selected maintained STAC operation.
from pathlib import Path
import hashlib,json,os,shutil,stat,subprocess,sys

base=Path(__file__).resolve().parent
selected=json.loads((base/'native-input.json').read_text())
project=Path(selected['projectDirectory'])
delivery=project/'delivery'
project.mkdir(mode=0o700,parents=True,exist_ok=True)
delivery.mkdir(mode=0o700,exist_ok=True)
code=base/'operation-code'
builder=Path(selected['builderDirectory'])
cache=Path(selected['sourceCache']).parent
metadata=code/'source-7169.json'
content=metadata.read_bytes()
source_metadata=json.loads(content)
if hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()!='56da861934c0a161c8ab76b64a17c2a9b421d557':
    raise ValueError('Preserve changed original source metadata')
command=[sys.executable,'-B',str(builder/'git-object-receiving.py'),
    '--metadata',str(metadata),'--commit',selected['sourceCommit'],'--directory',str(cache)]
donors=[
 ('--donor-repository','/workspace/scratch/99d0e4920ad7/scf-applications/source.git'),
 ('--donor-repository','/workspace/scratch/7108267765ab/fiscal-applications-native/source-10f5/cache/repository.git'),
 ('--donor-source','/workspace/scratch/99d0e4920ad7/scf-applications/source'),
 ('--donor-source','/workspace/scratch/84ebf86ab95a/native-merchant-application-84eb/runtime-c287/source'),
 ('--incoming',str(base/'incoming'))
]
for flag,directory in donors:
    if Path(directory).is_dir():command += [flag,directory]

# The added D1CC donor may retain an unavailable original Git alternate.
# Read its actual original metadata before passing this optional donor into the
# receiver. All shared Git configuration and alternate files remain untouched.
optional_git=Path('/workspace/scratch/d1ccf784531e/scf-following-release/source.git')
optional_git_admission={'directory':str(optional_git),'usable':False,'reason':'DIRECTORY_ABSENT'}
if optional_git.is_dir():
    rows={row['path']:row for row in source_metadata['tree']['tree']}
    requested={rows[path]['sha']:rows[path]['size'] for path in source_metadata['requiredPaths']}
    oids=list(requested)
    try:
        if optional_git.resolve(strict=True)!=optional_git:
            raise ValueError('NONCANONICAL_DONOR_DIRECTORY')
        observed=subprocess.run(
            ['git','--no-replace-objects','--no-lazy-fetch','-C',str(optional_git),'cat-file','--batch-check'],
            input=('\n'.join(oids)+'\n').encode('ascii'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            env={**os.environ,'GIT_TERMINAL_PROMPT':'0'},timeout=60)
        optional_git_admission.update(
            exitCode=observed.returncode,checkedObjects=len(oids),stderrBytes=len(observed.stderr),
            stderrSha256=hashlib.sha256(observed.stderr).hexdigest())
        if observed.returncode:
            optional_git_admission['reason']='GIT_METADATA_FAILED'
        else:
            lines=observed.stdout.decode('ascii').splitlines()
            if len(lines)!=len(oids):
                raise ValueError('INCOMPLETE_DONOR_METADATA')
            available=0
            for oid,line in zip(oids,lines):
                fields=line.split(' ')
                if fields==[oid,'missing']:
                    continue
                if fields!=[oid,'blob',str(requested[oid])]:
                    raise ValueError('DIFFERENT_DONOR_METADATA')
                available+=1
            optional_git_admission.update(usable=True,reason='ORIGINAL_METADATA_READ',availableObjects=available)
            command += ['--donor-repository',str(optional_git)]
    except (OSError,ValueError,UnicodeError,subprocess.SubprocessError) as failure:
        optional_git_admission.update(reason='GIT_METADATA_UNAVAILABLE',errorType=type(failure).__name__)

# Use the complete archive already declared by this operation's source owner.
# The original receiver hashes the whole tar.gz and verifies every adopted Git
# blob directly from its stream; it neither extracts nor changes the donor.
declaration_file=code/'source-selection.json'
source_selection=json.loads(declaration_file.read_text())
if (source_selection.get('sourceCommit')!=selected['sourceCommit']
        or source_selection.get('sourceTree')!=selected['sourceTree']):
    raise ValueError('Preserve a different original source selection')
archive_declaration=source_selection.get('publicArchiveDonor')
expected_archive={
    'sourceCommit':'db3d9cb3d64f2aee6c1e968606bf21eb0e6ef00e',
    'filename':'source-db3d9cb3d64f.tgz',
    'bytes':13032106,
    'sha256':'d953328850112533ada23b7a9b4b92a22178c902d635c3c999894ae9d4dc1edb'
}
if archive_declaration!=expected_archive:
    raise ValueError('Preserve the changed original archive donor declaration')
archive_override=os.environ.get('STAC_DECLARED_SOURCE_ARCHIVE')
archive_candidates=([Path(archive_override)] if archive_override is not None else [
    project/'donors'/archive_declaration['filename'],
    Path('/dev/shm/fe85-worldbank-applications-operation')/archive_declaration['filename']
])
archive_input=None
for archive_path in archive_candidates:
    if (not archive_path.is_absolute() or '\0' in str(archive_path)
            or str(archive_path)!=str(archive_path.absolute())):
        raise ValueError('Use an absolute original archive donor path')
    try:
        archive_info=archive_path.lstat()
    except FileNotFoundError:
        if archive_override is not None:
            raise ValueError('Receive the explicitly selected original archive before continuing')
        continue
    if (not stat.S_ISREG(archive_info.st_mode) or archive_path.resolve(strict=True)!=archive_path
            or archive_info.st_size!=archive_declaration['bytes']):
        raise ValueError('The original archive donor path, type or byte count changed')
    command += ['--donor-archive',archive_declaration['sha256'],str(archive_path)]
    archive_input={**archive_declaration,'path':str(archive_path)}
    break

# A second complete source-owned archive can supply residual matching blobs.
# It is selected explicitly; the release and primary declaration stay fixed.
second_archive_declaration={
    'sourceCommit':'d16e851341db5f0abd451a3d09ad52f99afdd162',
    'filename':'tokenjunkielabs-starforge-merchant-0.1.0-source.gd16e851341db.tgz',
    'bytes':13790968,
    'sha256':'f750e8abe0a8a3e61bc628027202063d212990d2327be9c02b5356e542fb6c96'
}
second_archive_override=os.environ.get('STAC_D16E_SOURCE_ARCHIVE')
second_archive_input=None
if second_archive_override is not None:
    second_archive_path=Path(second_archive_override)
    if (not second_archive_path.is_absolute() or '\0' in str(second_archive_path)
            or str(second_archive_path)!=str(second_archive_path.absolute())):
        raise ValueError('Use an absolute selected second archive donor path')
    try:
        second_archive_info=second_archive_path.lstat()
    except FileNotFoundError as failure:
        raise ValueError('Receive the explicitly selected second archive before continuing') from failure
    if (not stat.S_ISREG(second_archive_info.st_mode)
            or second_archive_path.resolve(strict=True)!=second_archive_path
            or second_archive_info.st_size!=second_archive_declaration['bytes']):
        raise ValueError('The selected second archive donor path, type or byte count changed')
    command += ['--donor-archive',second_archive_declaration['sha256'],str(second_archive_path)]
    second_archive_input={**second_archive_declaration,'path':str(second_archive_path)}
additional=set()
outcome=1
try:
    while True:
        result=subprocess.run(command+[value for name in sorted(additional) for value in ('--additional-path',name)])
        if result.returncode:
            outcome=result.returncode
            break
        result=subprocess.run(['node',str(code/'continue-stac-applications.mjs'),str(base/'native-input.json')])
        outcome=result.returncode
        if not outcome:break
        error=project/'continuation-error.json'
        if not error.is_file():break
        receipt=json.loads(error.read_text())
        if receipt.get('stage')!='SOURCE' or not receipt.get('missingObjects'):break
        missing={item for item in receipt['missingObjects'] if isinstance(item,str)}
        needed={row['path'] for row in source_metadata['tree']['tree'] if row.get('type')=='blob' and row.get('sha') in missing}
        if not needed-additional:break
        additional.update(needed)
finally:
    for name in ['source-receiving.json','missing-objects.json']:
        path=cache/name
        if path.is_file():shutil.copy2(path,delivery/name)
    for name in ['native-input.json','receive-and-continue.py','launch-native.py']:
        path=base/name
        if path.is_file():shutil.copy2(path,delivery/name)
    if not (project/'source-release.json').is_file() and cache.is_dir():
        shutil.copytree(cache,delivery/'source-cache',dirs_exist_ok=True)
    (delivery/'native-continuation-exit.json').write_text(json.dumps({
        'operationId':selected['operationId'],'sourceCommit':selected['sourceCommit'],
        'exitCode':outcome,'additionalOriginalSourcePaths':sorted(additional),
        'declaredArchiveDonor':archive_declaration,'selectedArchiveDonor':archive_input,
        'qualifiedSecondArchiveDonor':second_archive_declaration,'selectedSecondArchiveDonor':second_archive_input,
        'optionalGitDonorAdmission':optional_git_admission
    },indent=2)+'\n')
    (delivery/'native-continuation-exit.json').chmod(0o600)
raise SystemExit(outcome)
