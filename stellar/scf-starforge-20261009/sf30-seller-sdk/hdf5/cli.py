#!/usr/bin/env python3
"""Original CLI and newline-delimited process API for HDF5 workspaces."""
from __future__ import annotations
import argparse, concurrent.futures, signal, sys, threading
from pathlib import Path
from core import encode, parse, InputError, MAX_JSON
from workspace import Workspace

def serve(workspace):
    output=threading.Lock(); pending=set(); slots=threading.BoundedSemaphore(4); ordinary=threading.BoundedSemaphore(3); stopping=threading.Event()
    def emit(value):
        data=encode(value)
        if len(data)>MAX_JSON:data=encode({"id":value.get("id"),"error":{"code":"HDF5_RESPONSE_TOO_LARGE","message":"Request a smaller page","status":413}})
        with output:sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
    def run(request, is_control):
        try:
            if not isinstance(request,dict) or set(request)!={"id","action","payload"} or not isinstance(request["id"],str):raise InputError("Expected id, action and payload")
            emit({"id":request["id"],"result":workspace.dispatch(request["action"],request["payload"])})
        except Exception as exc:emit({"id":request.get("id") if isinstance(request,dict) else None,"error":{"code":getattr(exc,"code","HDF5_ERROR"),"message":str(exc)[:2000],"status":getattr(exc,"status",500)}})
        finally:
            slots.release()
            if not is_control:ordinary.release()
    class StopReading(BaseException):pass
    def stop(signum,frame):
        stopping.set()
        raise StopReading()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    emit({"ready":{"schema":"stellar-forge.hdf5-process.v1","directory":str(workspace.root),"actions":["status","records","source.get","version.get","source.import","inspect","attributes","selection.get","selection.save","selection.extract","edition.get","result.page","artifact","edition.export","edition.receive","operation.get","operation.resume","operation.cancel"]}})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4,thread_name_prefix="hdf5") as executor:
        while not stopping.is_set():
            try:line=sys.stdin.buffer.readline(1024*1024+1)
            except StopReading:
                with workspace.mutex:
                    selected=list(workspace.children)
                for ident in selected:
                    if ident in workspace.operation_locks:
                        try:workspace.cancel(ident)
                        except Exception:pass
                break
            except (ValueError,OSError):break
            if not line:break
            if len(line)>1024*1024 or not line.endswith(b"\n"):
                emit({"id":None,"error":{"code":"HDF5_REQUEST_TOO_LARGE","message":"Request exceeds 1 MiB","status":413}});break
            try:request=parse(line)
            except InputError as exc:emit({"id":None,"error":{"code":exc.code,"message":str(exc),"status":400}});continue
            # Keep one control slot available while original native extraction runs.
            is_control=isinstance(request,dict) and request.get("action") in ("operation.get","operation.cancel","status")
            normal_acquired=is_control or ordinary.acquire(blocking=False)
            if not normal_acquired or not slots.acquire(blocking=False):
                if normal_acquired and not is_control:ordinary.release()
                emit({"id":request.get("id") if isinstance(request,dict) else None,"error":{"code":"HDF5_BUSY","message":"Workspace capacity is in use; the fourth slot is reserved for status or cancellation","status":409}});continue
            executor.submit(run,request,is_control)

def main():
    parser=argparse.ArgumentParser(description="Retain HDF5 files, inspect exact arrays, save selections and deliver reconstructed editions.")
    parser.add_argument("--workspace",required=True,help="Private persistent workspace directory")
    parser.add_argument("--create",action="store_true",help="Create or reopen this exact workspace")
    parser.add_argument("--stdio",action="store_true",help="Run the original JSON-line process API until stdin closes")
    parser.add_argument("action",nargs="?",default="status")
    parser.add_argument("--payload",help="Exact JSON request file; use - to read stdin")
    args=parser.parse_args()
    workspace=Workspace(args.workspace,create=args.create)
    try:
        if args.stdio:serve(workspace)
        else:
            payload=parse(sys.stdin.buffer.read(1024*1024)) if args.payload=="-" else (parse(Path(args.payload).read_bytes()) if args.payload else {})
            sys.stdout.buffer.write(encode(workspace.dispatch(args.action,payload)))
    finally:workspace.close()
if __name__=="__main__":
    try:main()
    except Exception as exc:
        sys.stderr.buffer.write(encode({"error":getattr(exc,"code","HDF5_ERROR"),"message":str(exc),"status":getattr(exc,"status",500)}))
        raise SystemExit(1)
