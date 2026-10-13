#!/usr/bin/env python3
"""Run or recover a private semantic interoperability workspace."""
from __future__ import annotations
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
from semantic_operator.security import private_read, unpack_files, decrypt_recovery, digest, canonical
from semantic_operator.portable import receive_workspace

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    start=sub.add_parser("serve",help="Open the local operator")
    start.add_argument("--workspace",required=True)
    start.add_argument("--port",type=int,default=0)
    start.add_argument("--ready-file")
    start.add_argument("--parent-pid",type=int)
    restore=sub.add_parser("restore",help="Recover a complete original workspace without its former application")
    restore.add_argument("--archive",required=True)
    restore.add_argument("--destination",required=True)
    restore.add_argument("--passphrase-stdin",action="store_true")
    restore.add_argument("--operation-id")
    args=parser.parse_args()
    os.umask(0o077)
    if args.command=="serve":
        if args.parent_pid is not None:
            import signal
            if os.getppid()!=args.parent_pid:
                raise InterruptedError("The original workspace opener has closed.")
            if sys.platform.startswith("linux"):
                import ctypes
                if ctypes.CDLL(None).prctl(1,signal.SIGTERM,0,0,0)!=0 or os.getppid()!=args.parent_pid:
                    raise InterruptedError("Cannot retain the original workspace opener.")
        from semantic_operator.host import serve
        serve(args.workspace,port=args.port,ready_file=args.ready_file)
        return
    body=private_read(args.archive,maximum=512*1024*1024+256)
    passphrase=sys.stdin.readline().rstrip("\r\n") if args.passphrase_stdin else getpass.getpass("Recovery passphrase: ")
    files,manifest=unpack_files(decrypt_recovery(body,passphrase))
    destination=str(Path(args.destination).expanduser().absolute())
    op=args.operation_id or "restore-"+digest(canonical({"archive":digest(body),"destination":destination}))[:32]
    result=receive_workspace(files,manifest,destination,archive_sha256=digest(body),operation_id=op)
    print(json.dumps({"operation_id":op,"destination":destination,"result":result},indent=2))

if __name__=="__main__":
    main()
