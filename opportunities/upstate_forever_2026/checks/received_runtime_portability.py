#!/usr/bin/env python3
"""Focused receiver transport exercise; native scientific identity stays unchanged.

Uses a real local Python venv and real relocation subprocesses. Only the scientific
probe body is substituted in this exercise, because no InVEST model is being run.
Run manually: python checks/received_runtime_portability.py. No CI job is added.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import venv
import zipfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from source_tools import receive_native_runtime as receiver
from source_tools import runtime_platform as rp

PROBE = '''import json,sys;print(json.dumps({'python':sys.executable,'prefix':sys.prefix,'python_version':sys.version.split()[0],'invest_version':'transport-exercise','gdal_version':'transport-exercise','native':{'exercise':'runtime receiving, not science'}}))'''


def rejects(call, phrase=''):
    try:
        call()
    except (ValueError, OSError, RuntimeError) as error:
        if phrase and phrase not in str(error):
            raise AssertionError(f'Wrong failure: {error}') from error
        return
    raise AssertionError('Expected a rejected input')


def run():
    if rp.host_target() != 'linux-x86_64':
        raise SystemExit('This focused transport exercise uses the supplied Linux container.')
    results = []
    with tempfile.TemporaryDirectory(prefix='eco-runtime-') as temporary:
        base = Path(temporary)
        source = base/'source/runtime'
        venv.EnvBuilder(with_pip=False, symlinks=False).create(source)
        (source/'data').mkdir()
        (source/'data/value.txt').write_text('retained runtime bytes\n')
        # A second relocation at the same prefix is an actual error, not silently ignored.
        (source/'bin/conda-unpack').write_text("import pathlib,sys,time\np=pathlib.Path(sys.prefix)/'relocation.txt'\nassert not p.exists(), 'relocated twice'\ntime.sleep(.1)\np.write_text(str(pathlib.Path(sys.prefix).resolve()))\n")
        for format in ('tar.gz','zip'):
            package = base/('Package Ω & spaces '+format)
            package.mkdir()
            application = package/'application'
            (application/'model').mkdir(parents=True)
            (application/'model/native.py').write_text('# Transport exercise marker, not a scientific implementation.\n')
            archive = package/('runtime.'+format)
            if format == 'tar.gz':
                with tarfile.open(archive,'w:gz') as stream:
                    stream.add(source,arcname='runtime')
            else:
                with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as stream:
                    for path in source.rglob('*'):
                        stream.write(path,Path('runtime')/path.relative_to(source))
            spec = {'schema':rp.SCHEMA_V2,'platforms':{'linux-x86_64':{
                'platform':rp.TARGETS['linux-x86_64'], 'archive_root':'runtime',
                'format':format,'python':'bin/python', 'relocation':{'script':'bin/conda-unpack'},
                'archive':{'filename':archive.name,'bytes':archive.stat().st_size,
                           'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}}}}
            description = package/'NATIVE_RUNTIME.json'
            description.write_text(json.dumps(spec))
            storage = base/'Per user cache Ω'
            with patch.object(receiver,'NATIVE_IDENTITY',PROBE):
                first = receiver.receive(application,description,storage=storage)
                assert first['reused'] is False
                prefix = Path(first['prefix'])
                assert (prefix/'relocation.txt').read_text() == str(prefix.resolve())
                # Additions made by the existing exact Node/Excel preparer remain valid.
                (prefix/'.ecosystem-runtime-dependencies.lock').touch()
                (prefix/'added-dependency.txt').write_text('later exact dependency')
                moved = base/('Moved Ω & spaces '+format)
                package.rename(moved)
                again = receiver.receive(moved/'application',moved/'NATIVE_RUNTIME.json',storage=storage)
                assert again['reused'] is True and again['prefix'] == first['prefix']
                assert (prefix/'relocation.txt').read_text() == str(prefix.resolve())
                body = prefix/'data/value.txt'
                before = body.stat()
                body.write_text('retained runtime BYTEs\n')
                os.utime(body,ns=(before.st_atime_ns,before.st_mtime_ns))
                rejects(lambda: receiver.receive(moved/'application',moved/'NATIVE_RUNTIME.json',storage=storage),'changed')
            results.append(format+': actual selected Python relocation, Unicode/spaces, moved-folder reuse, additive dependency, changed original rejection')
        # Actual parent death during relocation: the inherited POSIX lease remains
        # held by the child, then a new opener receives into a fresh final prefix.
        package = base/'Interrupted package';package.mkdir()
        (package/'application/model').mkdir(parents=True)
        (package/'application/model/native.py').write_text('# Transport exercise marker.\n')
        (source/'bin/conda-unpack').write_text("import pathlib,sys,time,os\np=pathlib.Path(sys.prefix)\n(p/'started').write_text(str(os.getpid()))\ntime.sleep(float(os.environ.get('ECO_TEST_RELOCATION_WAIT','.1')))\nassert not (p/'relocation.txt').exists()\n(p/'relocation.txt').write_text(str(p))\n")
        archive=package/'runtime.tar.gz'
        with tarfile.open(archive,'w:gz') as stream:stream.add(source,arcname='runtime')
        entry={**spec['platforms']['linux-x86_64'],'format':'tar.gz',
               'archive':{'filename':archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}}
        description=package/'NATIVE_RUNTIME.json'
        description.write_text(json.dumps({'schema':rp.SCHEMA_V2,'platforms':{'linux-x86_64':entry}}))
        transport_code = "import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from source_tools import receive_native_runtime as r;r.NATIVE_IDENTITY=sys.argv[2];print(json.dumps(r.receive(Path(sys.argv[3]),Path(sys.argv[4]),storage=Path(sys.argv[5]))))"
        command=[sys.executable,'-B','-c',transport_code,str(Path(receiver.__file__).resolve().parents[1]),PROBE,str(package/'application'),str(description),str(base/'Interrupted cache')]
        first = subprocess.Popen(command,env={**os.environ,'ECO_TEST_RELOCATION_WAIT':'3'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        deadline=time.monotonic()+10
        old_prefix=None
        while time.monotonic()<deadline:
            started=list((base/'Interrupted cache').rglob('started'))
            if started:
                old_prefix=started[0].parent;break
            if first.poll() is not None:raise AssertionError(first.communicate())
            time.sleep(.03)
        assert old_prefix is not None
        first.kill();first.wait(timeout=3)
        second=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        time.sleep(.2)
        assert second.poll() is None, 'Relocation custody ended with the parent'
        output,error=second.communicate(timeout=15)
        assert second.returncode==0,error
        received=json.loads(output)
        assert Path(received['prefix'])!=old_prefix and received['reused'] is False
        first.communicate(timeout=3)
        assert (old_prefix/'relocation.txt').is_file()
        assert (Path(received['prefix'])/'relocation.txt').is_file()
        results.append('actual parent termination during relocation: inherited POSIX custody survives; next opener waits and receives into a new permanent prefix')
        # Wrong platform selection and legacy-v1 compatibility are pure selection checks.
        legacy = {**spec['platforms']['linux-x86_64'],'schema':receiver.SCHEMA}
        legacy_path=base/'legacy.json';legacy_path.write_text(json.dumps(legacy))
        assert receiver.load_spec(legacy_path)['target']=='linux-x86_64'
        rejects(lambda:receiver.load_spec(legacy_path,target='windows-x86_64'),'another')
        alias = {'schema':rp.SCHEMA_V2,'targets':{'darwin-arm64':{
            **legacy,'schema':rp.SCHEMA_V2,'platform':rp.TARGETS['macos-arm64']}}}
        alias_path=base/'aliases.json';alias_path.write_text(json.dumps(alias))
        assert receiver.load_spec(alias_path,target='macos-arm64')['target']=='macos-arm64'
        results.append('legacy v1, canonical v2 and darwin/targets input aliases')
        for system in ('Windows','Darwin'):
            specp={'platform':{'system':system}}
            rejects(lambda:rp.check_member_names([('runtime/A/x','file'),('runtime/a/y','file')],specp),'collision')
            rejects(lambda:rp.check_member_names([('runtime/é','file'),('runtime/e\u0301','file')],specp),'collision')
        rejects(lambda:rp.check_member_names([('runtime/CON.txt','file')],{'platform':{'system':'Windows'}}),'Windows')
        rejects(lambda:rp.relative('../outside'),'inside')
        results.append('Windows reserved names, implicit-directory/case/Unicode collisions, traversal')
        # Cross-target header inspection never executes these small format fixtures.
        pe=bytearray(256);pe[:2]=b'MZ';struct.pack_into('<I',pe,60,128);pe[128:132]=b'PE\0\0';struct.pack_into('<H',pe,132,0x8664)
        file=base/'header.exe';file.write_bytes(pe)
        assert rp.binary_target(file)==('Windows',{'x86_64'})
        file.write_bytes(b'\xcf\xfa\xed\xfe'+struct.pack('<I',0x0100000c)+bytes(24))
        assert rp.binary_target(file)==('Darwin',{'arm64'})
        results.append('PE x64 and Mach-O arm64 header dispatch; actual ELF interpreter checked in both receives')
    print(json.dumps({'passed':results},indent=2))

if __name__=='__main__':
    run()
