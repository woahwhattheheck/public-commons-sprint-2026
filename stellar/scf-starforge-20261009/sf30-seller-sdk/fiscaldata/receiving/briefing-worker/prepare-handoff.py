#!/usr/bin/env python3
"""Bind one exact retained checkpoint to the original E2B native handoff."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--checkpoint",required=True,help="The original retained workspace.fiscal.gz")
parser.add_argument("--output",required=True,help="A new private handoff JSON file")
args=parser.parse_args()
selection=json.loads((Path(__file__).resolve().parent/"source-inputs.json").read_text())
checkpoint=Path(args.checkpoint).absolute()
fd=os.open(checkpoint,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,"rb") as stream:
    before=os.fstat(stream.fileno())
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Select the original regular checkpoint file")
    digest=hashlib.sha256()
    while True:
        block=stream.read(1024*1024)
        if not block:
            break
        digest.update(block)
    after=os.fstat(stream.fileno())
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
        raise ValueError("The selected checkpoint changed during preparation")
expected=selection["retainedInput"]
if before.st_size!=expected["bytes"] or digest.hexdigest()!=expected["sha256"]:
    raise ValueError("Use the exact original accepted Fiscal checkpoint")
request={**selection["handoff"],"files":[*selection["publicFiles"],{
    "name":expected["name"],"bytes":expected["bytes"],"sha256":expected["sha256"],"source":str(checkpoint)
}]}
output=Path(args.output).absolute()
output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
parent=output.parent.lstat()
if not stat.S_ISDIR(parent.st_mode) or parent.st_mode&0o077 or parent.st_uid!=os.getuid():
    raise ValueError("Use an owned private output directory")
content=(json.dumps(request,sort_keys=True,indent=2)+"\n").encode()
with (output.parent/".briefing-handoff.lock").open("a+b") as held:
    os.chmod(output.parent/".briefing-handoff.lock",0o600)
    fcntl.flock(held,fcntl.LOCK_EX)
    if output.exists() or output.is_symlink():
        fd=os.open(output,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,"rb") as existing:
            info=os.fstat(existing.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size!=len(content) or existing.read()!=content:
                raise ValueError("Preserve the existing handoff; its immutable inputs differ")
    else:
        fd,temporary=tempfile.mkstemp(prefix="."+output.name+".",dir=output.parent)
        with os.fdopen(fd,"wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.rename(temporary,output)
    directory_fd=os.open(output.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
print(json.dumps({"state":"PREPARED","path":str(output),"bytes":len(content),"sha256":hashlib.sha256(content).hexdigest(),"operation_id":request["native_operation_id"],"inputs":len(request["files"])}))
