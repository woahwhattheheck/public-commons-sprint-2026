"""End-to-end transport commissioning, not a hydrological simulation.

Uses complete original archive layout and original Workspace identity schema.
Binary load files are explicitly generated transport payloads, never model output.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model.project_transfer import (TransferStore, TransferError, Cancelled, ARCHIVE_FORMAT,
                                   canonical, sha, receive_directory, verify_directory, block_inventory)
from model.project_transfer_cli import export_report

BLOCK=4*1024**2
ROOT=Path(__file__).resolve().parents[1]


def archive(path, payload_file, *, edition=1, include_app=True):
    project={"schema":"upstate.scientific-workbench/v1","id":"f9ac483c-f882-45d5-b222-0367022f419c",
             "title":"Transfer commissioning — retained source project", "created_at":"2026-10-12T23:00:00+00:00"}
    files={"workspace/workspace.json":canonical(project)+b"\n",
           "workspace/notes/purpose.txt":b"Generated binary transport load. No hydrological results are represented.\n",
           "workspace/notes/field \u2013 \u8bb0\u5f55.txt":f"Independently editable notes, edition {edition}.\n".encode(),
           "workspace/empty.txt":b""}
    if edition==1: files["workspace/notes/retired.txt"]=b"Retained in the first project copy.\n"
    else: files["workspace/notes/new.txt"]=b"Added to the second project copy.\n"
    if include_app:
        for folder in ("model","operator"):
            for p in sorted((ROOT/folder).rglob("*")):
                if p.is_file() and "__pycache__" not in p.parts:
                    files["application/"+p.relative_to(ROOT).as_posix()]=p.read_bytes()
    records={}
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_STORED,allowZip64=True) as z:
        for name,data in files.items():
            z.writestr(name,data);records[name]={"bytes":len(data),"sha256":sha(data)}
        # Duplicate full retained source file deliberately exercises block reuse.
        for name in ("workspace/objects/commissioning-source.bin","workspace/source-copy/commissioning-source.bin"):
            h=hashlib.sha256(); size=0
            with payload_file.open('rb') as src,z.open(name,'w',force_zip64=True) as out:
                for data in iter(lambda:src.read(BLOCK),b''):
                    out.write(data);h.update(data);size+=len(data)
            records[name]={"bytes":size,"sha256":h.hexdigest()}
        manifest={"schema":ARCHIVE_FORMAT,"project":project,"created_at":f"2026-10-12T23:{edition:02d}:00+00:00",
                  "selection":{"include_intermediates":True,"include_deliveries":True},"members":records,
                  "receiving":"python application/model/cli.py restore ARCHIVE NEW_DIRECTORY",
                  "source_views":"Recreated from original content-addressed objects on demand"}
        # Preserve original human formatting as bytes, not just parsed equivalence.
        z.writestr("ARCHIVE.json",json.dumps(manifest,indent=2,ensure_ascii=False).encode()+b'\n')
    return manifest


def cli(store,*args):
    p=subprocess.run([sys.executable,"-m","model.project_transfer_cli","--store",str(store),"--quiet",*map(str,args)],
                     cwd=ROOT,capture_output=True,text=True)
    if p.returncode:raise AssertionError(p.stderr)
    return json.loads(p.stdout)


def main(directory=None,payload_mib=128):
    base=Path(directory or tempfile.mkdtemp(prefix="transfer-journey-"));base.mkdir(parents=True,exist_ok=True)
    started=time.monotonic();payload=base/'commissioning-source.bin'
    with payload.open('wb') as f:
        for i in range(payload_mib//4): f.write(hashlib.shake_256(f"transfer commissioning block {i}".encode()).digest(BLOCK))
    first=base/'original-edition-1.zip';archive(first,payload)
    sender=TransferStore(base/'sender');receiver=TransferStore(base/'receiver')
    s1=sender.capture_archive(first);id1=s1['id'];receiver.accept_snapshot(s1)
    inventory=block_inventory(s1);large=next(k for k,n in inventory.items() if n==BLOCK)
    data=sender.get_block(large,BLOCK);cut=1700101
    prefix=base/'prefix.bin';prefix.write_bytes(data[:cut]);suffix=base/'suffix.bin';suffix.write_bytes(data[cut:])
    r=cli(receiver.root,'receive-range',id1,large,prefix)
    assert r['offset']==cut and not r['complete']
    r=cli(receiver.root,'receive-range',id1,large,suffix,'--offset',cut)
    assert r['complete']
    # A completely new process can see the saved prefix and complete the block.
    request=receiver.needs(id1);assert large not in {b['sha256'] for b in request['missing']}
    parts=sender.write_parts(id1,base/'first-parts',request=request,payload_bytes=16*1024**2)
    for part in reversed(parts):receiver.receive_pack(part['path'])
    assert receiver.needs(id1)['complete']
    # Replaying every part causes zero new payload acquisition.
    replay=[receiver.receive_pack(p['path']) for p in parts]
    assert sum(r['received_bytes'] for r in replay)==0
    reconstructed=base/'reconstructed-1.zip';receiver.materialize_archive(id1,reconstructed)
    with zipfile.ZipFile(first) as a,zipfile.ZipFile(reconstructed) as b:
        assert set(a.namelist())==set(b.namelist())
        for name in a.namelist():
            ha=hashlib.sha256();hb=hashlib.sha256()
            with a.open(name) as src:
                for block in iter(lambda:src.read(BLOCK),b''):ha.update(block)
            with b.open(name) as src:
                for block in iter(lambda:src.read(BLOCK),b''):hb.update(block)
            assert ha.digest()==hb.digest(),name
    # Interrupt project receiving after complete files, then resume in a new process.
    target1=base/'recipient-1'
    def interrupt(p):
        if p.get('files_done')==3: raise Cancelled('commissioning interruption')
    try:receive_directory(receiver,id1,target1,progress=interrupt)
    except Cancelled:pass
    else:raise AssertionError('Interruption did not occur')
    assert not target1.exists()
    stages=list(base.glob('.transfer-receive-*'));assert len(stages)==1
    retained=next(p for p in stages[0].rglob('*') if p.is_file() and p.name!='ARCHIVE.json')
    relative=retained.relative_to(stages[0]);inode=retained.stat().st_ino
    result=cli(receiver.root,'open-copy',id1,target1);assert result['identity']=='MATCH'
    assert (target1/relative).stat().st_ino==inode
    verify_directory(receiver,id1,target1)
    unchanged_note=(target1/'workspace/notes/field \u2013 \u8bb0\u5f55.txt').read_bytes()
    # Change one physical block in each duplicate file; CAS needs it only once.
    with payload.open('r+b') as f:f.seek(BLOCK+500);f.write(b'changed edition; exact retained bytes')
    second=base/'original-edition-2.zip';archive(second,payload,edition=2)
    s2=sender.capture_archive(second);id2=s2['id'];receiver.accept_snapshot(s2)
    delta=sender.difference(id1,id2);wanted=receiver.needs(id2)
    assert wanted['bytes_remaining']<BLOCK+100_000
    assert delta['new_unique_bytes']==wanted['bytes_remaining']
    delta_parts=sender.write_parts(id2,base/'delta-parts',request=wanted,payload_bytes=8*1024**2)
    for p in delta_parts:receiver.receive_pack(p['path'])
    target2=base/'recipient-2';receive_directory(receiver,id2,target2)
    assert (target1/'workspace/notes/retired.txt').exists()
    assert not (target2/'workspace/notes/retired.txt').exists()
    assert (target1/'workspace/notes/field \u2013 \u8bb0\u5f55.txt').read_bytes()==unchanged_note
    (target2/'workspace/notes/local-edit.txt').write_text('Recipient edit stays independent.')
    assert not (target1/'workspace/notes/local-edit.txt').exists()
    assert receive_directory(receiver,id2,target2)['reused']
    # Pre-existing unrelated directories stay untouched, including empty ones.
    existing=base/'unrelated';existing.mkdir();(existing/'keep.txt').write_text('untouched')
    try:receive_directory(receiver,id1,existing)
    except TransferError:pass
    else:raise AssertionError('Unrelated receiving directory was adopted')
    assert (existing/'keep.txt').read_text()=='untouched'
    # Disk corruption invalidates the cached verification fingerprint.
    key=next(iter(block_inventory(s2)));p=receiver.block_path(key);old=p.read_bytes();p.write_bytes(bytes([old[0]^1])+old[1:])
    bad=receiver.needs(id2);assert key in {b['sha256'] for b in bad['missing']}
    repair=sender.write_pack(id2,base/'repair.zip',request=bad);receiver.receive_pack(repair['path'])
    assert receiver.needs(id2)['complete']
    # Tampered file assembly must not publish any result.
    broken=json.loads(json.dumps(s2));candidate=broken['members']['workspace/objects/commissioning-source.bin'];candidate['blocks'][:2]=candidate['blocks'][:2][::-1]
    broken['id']=sha(canonical({k:v for k,v in broken.items() if k!='id'}));receiver.accept_snapshot(broken)
    output=base/'must-not-exist.zip'
    try:receiver.materialize_archive(broken['id'],output)
    except TransferError:pass
    else:raise AssertionError('Altered block order was published')
    assert not output.exists()
    report_dir=base/'report';export_report(receiver,id2,report_dir)
    result={"status":"PASS","source_files":len(s1['members'])-1,"logical_bytes":sum(v['bytes'] for v in s1['members'].values()),
            "unique_bytes_first":sum(block_inventory(s1).values()),"first_parts":len(parts),
            "resumed_block_prefix_bytes":cut,"replay_received_bytes":sum(r['received_bytes'] for r in replay),
            "incremental_unique_bytes":wanted['bytes_remaining'],"second_unique_bytes":wanted['bytes_total'],
            "incremental_reuse_fraction":1-wanted['bytes_remaining']/wanted['bytes_total'],
            "new_process_receive":"PASS","partial_directory_resume":"PASS","original_manifest_bytes":"MATCH",
            "independent_recipient_edit":"PASS","existing_destination":"PRESERVED","corruption_repair":"PASS",
            "tampered_assembly":"REJECTED","seconds":time.monotonic()-started,
            "baseline_snapshot":id1,"updated_snapshot":id2,"directory":str(base),
            "data_meaning":"Generated binary transport commissioning load, not scientific simulation results."}
    (base/'journey-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));return result

if __name__=='__main__':main(sys.argv[1] if len(sys.argv)>1 else None,int(os.environ.get('TRANSFER_PAYLOAD_MIB','128')))
