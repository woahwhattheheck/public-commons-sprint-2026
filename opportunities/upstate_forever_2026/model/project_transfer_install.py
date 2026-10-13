#!/usr/bin/env python3
"""Join additive transfer actions to the current original operator, preserving peers.

Run AFTER extracting the source modules into the original application. The
installer reads the current server instead of replacing it with an old postimage.
"""
from __future__ import annotations
import argparse,ast,hashlib,os,tempfile
from pathlib import Path


def patch(source: str) -> str:
    ast.parse(source)
    marker="# PROJECT-TRANSFER12 integration"
    if marker in source: return source
    tree=ast.parse(source);cls=next((x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=="Operator"),None)
    if cls is None: raise ValueError("Select the original operator/server.py containing Operator")
    methods={x.name:x for x in cls.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef))}
    if not {"__init__","_invoke"}<=set(methods): raise ValueError("Current operator is missing its original task interface")
    lines=source.splitlines(keepends=True);offsets=[0]
    for line in lines: offsets.append(offsets[-1]+len(line))
    edits=[]
    def source_offset(lineno, byte_column):
        # AST columns count UTF-8 bytes; Python string offsets count characters.
        return offsets[lineno-1] + len(lines[lineno-1].encode("utf-8")[:byte_column].decode("utf-8"))
    def insert_before(node,text): edits.append((offsets[node.lineno-1],offsets[node.lineno-1],text))
    anchor="ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)"
    if source.count(anchor)!=1: raise ValueError("Locate the current original ACTIONS registration before joining")
    where=source.index(anchor)+len(anchor)
    edits.append((where,where,"\n"+marker+"\nfrom project_transfer import ProjectTransfers, ACTIONS as PROJECT_TRANSFER_ACTIONS\nACTIONS.update(PROJECT_TRANSFER_ACTIONS)"))
    init=methods['__init__']; first=init.body[0]
    if isinstance(first,ast.Expr) and isinstance(first.value,ast.Constant) and isinstance(first.value.value,str): first=init.body[1]
    insert_before(first,"        self.project_transfers = ProjectTransfers(self, Fault)\n")
    invoke=methods['_invoke'];first=invoke.body[0]
    if isinstance(first,ast.Expr) and isinstance(first.value,ast.Constant) and isinstance(first.value.value,str): first=invoke.body[1]
    insert_before(first,"        if task[\"action\"] in PROJECT_TRANSFER_ACTIONS:\n            return self.project_transfers.invoke(task)\n")
    decorations=0
    for node in ast.walk(tree):
        if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Attribute) or node.func.attr!='decorate_task': continue
        receiver=node.func.value
        if not isinstance(receiver,ast.Attribute) or receiver.attr!='customer_reviews': continue
        start=source_offset(node.lineno,node.col_offset);end=source_offset(node.end_lineno,node.end_col_offset)
        original=source[start:end];owner=ast.get_source_segment(source,receiver.value)
        edits.append((start,end,f"{owner}.project_transfers.decorate_task({original})"));decorations+=1
    if not decorations: raise ValueError("Current original task-decoration hook was not found; preserve the server and join decorate_task explicitly")
    for start,end,text in sorted(edits,reverse=True):source=source[:start]+text+source[end:]
    ast.parse(source)
    return source


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('application',type=Path);p.add_argument('--dry-run',action='store_true');args=p.parse_args()
    root=args.application.resolve();path=root/'operator/server.py'
    for name in ('operator/project_transfer.py','model/project_transfer.py','model/project_transfer_workspace.py'):
        if not (root/name).is_file():raise SystemExit('Extract the complete transfer source before integration: '+name)
    source=path.read_text();updated=patch(source)
    if source==updated:print('Original operator already has the additive transfer integration.');return
    if args.dry_run:
        import difflib
        print(''.join(difflib.unified_diff(source.splitlines(True),updated.splitlines(True),fromfile=str(path),tofile=str(path))));return
    old_sha=hashlib.sha256(source.encode()).hexdigest()
    backups=root.parent/(root.name+'-integration-backups');backups.mkdir(exist_ok=True)
    backup=backups/(old_sha+'.server.py')
    if not backup.exists():
        with backup.open('x') as f:f.write(source);f.flush();os.fsync(f.fileno())
    fd,name=tempfile.mkstemp(prefix='.transfer-server-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:f.write(updated);f.flush();os.fsync(f.fileno())
        # Preserve an actual concurrent peer edit, rather than overwriting it.
        if path.read_text()!=source:raise RuntimeError('The operator changed during integration; rerun against its latest source')
        os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)
    print('Joined 9 transfer actions and original download tickets; prior source: '+str(backup))

if __name__=='__main__':main()
