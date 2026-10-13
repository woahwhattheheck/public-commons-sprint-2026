#!/usr/bin/env python3
"""Join additive transfer actions to the current original operator, preserving peers.

Run AFTER extracting the source modules into the original application. The
installer uses the maintained descriptor's single provider when that host is
installed, and retains the original direct integration for a standalone older
host. It reads the current server and preserves all surrounding peer edits.
"""
from __future__ import annotations
import argparse,ast,hashlib,json,os,tempfile
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


def registry_registration(root: Path, source: str) -> bool:
    """Choose the installed descriptor's original provider on a maintained host."""
    tree = ast.parse(source)
    hosted = any(
        isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "self" and target.attr == "extensions"
                for target in node.targets)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Attribute)
        and node.value.func.attr == "load"
        and isinstance(node.value.func.value, ast.Call)
        and isinstance(node.value.func.value.func, ast.Name)
        and node.value.func.value.func.id == "ExtensionRegistry"
        for node in ast.walk(tree)
    )
    descriptor = root / "operator" / "extensions" / "project-transfer.json"
    if not hosted or not descriptor.is_file():
        return False
    manifest = json.loads(descriptor.read_text(encoding="utf-8"))
    backend = manifest.get("backend", {})
    factory = backend.get("factory", {})
    if (manifest.get("schema") != "upstate.operator-extension/v1"
            or manifest.get("id") != "project-transfer"
            or backend.get("module") != "project_transfer"
            or factory.get("handler") != "ProjectTransfers"
            or factory.get("args") != ["operator", "fault"]):
        raise ValueError("Compose the actual maintained project-transfer descriptor before source integration.")
    declared = backend.get("actions", [])
    if (not isinstance(declared, list) or not declared
            or any(not isinstance(name, str) or not name for name in declared)
            or len(set(declared)) != len(declared)):
        raise ValueError("The maintained transport descriptor needs its complete unique action names.")
    provider_tree = ast.parse((root / "operator" / "project_transfer.py").read_text(encoding="utf-8"))
    action_nodes = [
        node.value for node in provider_tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "ACTIONS" for target in node.targets)
    ]
    if (len(action_nodes) != 1 or not isinstance(action_nodes[0], ast.Call)
            or not isinstance(action_nodes[0].func, ast.Name)
            or action_nodes[0].func.id != "frozenset" or len(action_nodes[0].args) != 1):
        raise ValueError("Read the original provider's actual action declaration before joining it.")
    original_actions = set(ast.literal_eval(action_nodes[0].args[0]))
    if set(declared) != original_actions:
        raise ValueError("Install the matching complete transport descriptor and original provider.")
    providers = [node for node in provider_tree.body
                 if isinstance(node, ast.ClassDef) and node.name == "ProjectTransfers"]
    initializers = [node for provider in providers for node in provider.body
                    if isinstance(node, ast.FunctionDef) and node.name == "__init__"]
    aliased = any(
        isinstance(node, ast.Assign) and isinstance(node.value, ast.Name)
        and node.value.id == "self"
        and any(isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "operator" and target.attr == "project_transfers"
                for target in node.targets)
        for initializer in initializers for node in ast.walk(initializer)
    )
    if not aliased:
        raise ValueError("Install the complete current transport provider with its shared operator alias.")
    return True


def registry_patch(source: str) -> str:
    """Remove only the exact legacy joins when the descriptor owns dispatch."""
    ast.parse(source)
    marker = "# PROJECT-TRANSFER12 integration"
    if marker not in source:
        return source
    replacements = (
        ("\n# PROJECT-TRANSFER12 integration\n"
         "from project_transfer import ProjectTransfers, ACTIONS as PROJECT_TRANSFER_ACTIONS\n"
         "ACTIONS.update(PROJECT_TRANSFER_ACTIONS)", ""),
        ("        self.project_transfers = ProjectTransfers(self, Fault)\n", ""),
        ("        if task[\"action\"] in PROJECT_TRANSFER_ACTIONS:\n"
         "            return self.project_transfers.invoke(task)\n", ""),
        ("self.project_transfers.decorate_task(self.customer_reviews.decorate_task(task))",
         "self.customer_reviews.decorate_task(task)"),
    )
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError("The legacy transport join changed; compose its current source without replacing peer edits.")
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('application',type=Path);p.add_argument('--dry-run',action='store_true');args=p.parse_args()
    root=args.application.resolve();path=root/'operator/server.py'
    for name in ('operator/project_transfer.py','model/project_transfer.py','model/project_transfer_workspace.py'):
        if not (root/name).is_file():raise SystemExit('Extract the complete transfer source before integration: '+name)
    source=path.read_text()
    registered=registry_registration(root,source)
    updated=registry_patch(source) if registered else patch(source)
    if source==updated:
        print('Original operator uses its maintained transport descriptor and shared provider.' if registered else 'Original operator already has the additive transfer integration.')
        return
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
    print(('Joined the maintained transport descriptor and its original download tickets; prior source: ' if registered else 'Joined original transfer actions and download tickets; prior source: ')+str(backup))

if __name__=='__main__':main()
