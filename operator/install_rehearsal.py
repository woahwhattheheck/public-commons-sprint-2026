#!/usr/bin/env python3
"""Join complete rehearsal source to the current Upper Savannah application.

Copyright 2026 TokenJunkieLabs. Reuses the maintained guarded operator installer
pattern. Preserves the current scientific, spatial, community and programme code.
"""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import uuid

OWNED = frozenset({
    "model/rehearsal.py", "operator/rehearsal.py", "operator/rehearsal_cli.py",
    "operator/web/rehearsal.mjs", "operator/web/rehearsal.css",
    "operator/install_rehearsal.py", "operator/REHEARSAL.md",
    "operator/rehearsal_receiving.py", "operator/rehearsal_browser.mjs",
    "operator/rehearsal.example.json",
})
SCHEMA = "upstate.rehearsal-addon/v1"

def sha(body):
    return hashlib.sha256(body).hexdigest()


def once(text, before, after, label, *, marker=None):
    if marker and marker in text:
        return text
    count = text.count(before)
    if count != 1:
        raise ValueError(f"{label}: expected one existing anchor, found {count}. "
                         "The complete source is preserved; compose this registration "
                         "with the current operator implementation.")
    return text.replace(before, after, 1)


def python_method_return(text, class_name, method_name, decorator):
    if decorator + "(" in text:
        return text
    tree = ast.parse(text)
    cls = next((x for x in tree.body if isinstance(x, ast.ClassDef)
                and x.name == class_name), None)
    if cls is None:
        raise ValueError(f"Missing original class {class_name}")
    method = next((x for x in cls.body if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and x.name == method_name), None)
    if method is None or not method.body or not isinstance(method.body[-1], ast.Return):
        raise ValueError(f"Expected final return in {class_name}.{method_name}")
    target = method.body[-1]
    expression = ast.get_source_segment(text, target.value)
    lines = text.splitlines(keepends=True)
    first = sum(len(x) for x in lines[:target.lineno - 1]) + target.col_offset
    last = sum(len(x) for x in lines[:target.end_lineno - 1]) + target.end_col_offset
    return text[:first] + f"return {decorator}({expression})" + text[last:]



def patch_server(text):
    text = once(text, "from model import portable\n",
                "from model import portable\n"
                "sys.path.insert(0, str(Path(__file__).resolve().parent))\n"
                "from rehearsal import Rehearsals, ACTIONS as REHEARSAL_ACTIONS, READS as REHEARSAL_READS\n",
                "Rehearsal backend import", marker="from rehearsal import Rehearsals,")
    if "ACTIONS.update(REHEARSAL_ACTIONS)" not in text:
        tree = ast.parse(text)
        assignment = next((n for n in tree.body if isinstance(n, ast.Assign)
                           and any(isinstance(t, ast.Name) and t.id == "ACTIONS" for t in n.targets)), None)
        if assignment is None:
            raise ValueError("Missing original operator ACTIONS declaration")
        lines = text.splitlines(keepends=True)
        lines.insert(assignment.end_lineno, "ACTIONS.update(REHEARSAL_ACTIONS)\n")
        text = "".join(lines)
    text = once(text, "        self.downloads = {}\n",
                "        self.downloads = {}\n        self.rehearsals = Rehearsals(self, Fault)\n",
                "Rehearsal adapter", marker="self.rehearsals = Rehearsals(self, Fault)")
    text = once(text, '        action = task["action"]\n',
                '        action = task["action"]\n'
                '        if action in REHEARSAL_ACTIONS:\n'
                '            return self.rehearsals.invoke(task)\n',
                "Original task execution", marker="return self.rehearsals.invoke(task)")
    text = python_method_return(text, "Operator", "task_view", "self.rehearsals.decorate_task")
    text = once(text, '                workspace = one("workspace", self.app.primary)\n',
                '                workspace = one("workspace", self.app.primary)\n'
                '                rehearsal_reads = {"/api/rehearsals/" + name: name for name in REHEARSAL_READS}\n'
                '                if url.path in rehearsal_reads:\n'
                '                    return self.send_json(200, self.app.rehearsals.read(workspace,\n'
                '                        rehearsal_reads[url.path], {name: one(name) for name in ("id", "revision")}))\n',
                "Rehearsal read routes", marker='rehearsal_reads = {"/api/rehearsals/"')
    if '"rehearsal.mjs"' not in text:
        tree = ast.parse(text)
        handler = next((node for node in tree.body if isinstance(node, ast.ClassDef)
                        and node.name == "Handler"), None)
        method = next((node for node in handler.body if isinstance(node, ast.FunctionDef)
                       and node.name == "do_GET"), None) if handler else None
        matches = [node for node in ast.walk(method) if isinstance(node, ast.Compare)
                   and isinstance(node.left, ast.Name) and node.left.id == "selected"
                   and len(node.ops) == 1 and isinstance(node.ops[0], ast.NotIn)
                   and any(isinstance(part, ast.Constant) and part.value == "index.html"
                           for part in ast.walk(node.comparators[0]))] if method else []
        if len(matches) != 1:
            raise ValueError("Expected one original explicit operator static-file allowlist")
        # Preserve an already-installed extension registry's set union and all
        # earlier scientific/transfer web assets in this same expression.
        target = matches[0].comparators[0]
        expression = ast.get_source_segment(text, target)
        lines = text.splitlines(keepends=True)
        first = sum(len(line) for line in lines[:target.lineno-1]) + target.col_offset
        last = sum(len(line) for line in lines[:target.end_lineno-1]) + target.end_col_offset
        text = text[:first] + "(" + expression + ' | {"rehearsal.mjs", "rehearsal.css"})' + text[last:]
    ast.parse(text)
    return text


def patch_app(text):
    text = text.replace("for(const node of $('[data-view]'))",
                        "for(const node of $$('[data-view]'))")
    if "import {attachRehearsal}" not in text:
        text = "import {attachRehearsal} from './rehearsal.mjs';\n" + text
    text = once(text, "const viewLabels={",
                "const viewLabels={rehearsal:'Operator rehearsal',",
                "Rehearsal view", marker="rehearsal:'Operator rehearsal'")
    text = once(text, "const actionLabels={",
                "const actionLabels={'rehearsal.save':'Save operator rehearsal',"
                "'rehearsal.begin':'Begin walkthrough step','rehearsal.record':'Record actual step outcome',"
                "'rehearsal.export':'Export walkthrough and media',",
                "Rehearsal task labels", marker="'rehearsal.save':")
    if "const rehearsal=attachRehearsal(" not in text:
        matches = list(re.finditer(r"(?m)^const endpoint = [^\n]+\n", text))
        if len(matches) != 1:
            raise ValueError("Expected the original endpoint helper")
        i = matches[0].end()
        text = text[:i] + (
            "async function rehearsalOpenControl(control){\n"
            " if(control.type==='view')return navigate(control.view);\n"
            " if(control.type==='item')return openItem(control.kind,control.id);\n"
            " const actions=new Set(['source-open','profile-new','grid-new','scenario-new',"
            "'run-prepare','run-compare','delivery-new','backup','restore']);\n"
            " if(control.type!=='action'||!actions.has(control.action))throw Error('Choose an original operator control.');\n"
            " const button=document.createElement('button');button.dataset.action=control.action;\n"
            " for(const key of ['id','kind','collection'])if(control[key])button.dataset[key]=control[key];\n"
            " return dispatch(button);\n"
            "}\n"
            "const rehearsal=attachRehearsal({getState:()=>state,api,endpoint,openItem,showTask,fileList,toast,"
            "refreshState:()=>refresh({force:true}),navigate,openControl:rehearsalOpenControl});\n"
        ) + text[i:]
    branch = (
        "function render(){\n  if(!state)return;\n"
        "  if(view==='rehearsal'){\n"
        "    for(const node of $$('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');\n"
        "    if(typeof spatialWorkspace!=='undefined')spatialWorkspace.suspend();\n"
        "    if(typeof community!=='undefined')community.detach();\n"
        "    if(typeof customerReviews!=='undefined')customerReviews.detach();\n"
        "    if(typeof conservation!=='undefined')conservation.detach();\n"
        "    if(typeof programmes!=='undefined')programmes.detach();\n"
        "    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();\n"
        "    if(typeof experiments!=='undefined')experiments.detach();\n"
        "    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();\n"
        "    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n"
        "    if(typeof extensions!=='undefined')extensions.detach();\n"
        "    rehearsal.mount($('#content'));return;\n"
        "  }\n  rehearsal.detach();\n"
    )
    text = once(text, "function render(){\n  if(!state)return;\n", branch,
                "Rehearsal mounted view", marker="rehearsal.mount($('#content'))")
    if "rehearsal_tasks:" not in text:
        pattern = r'(?m)^(\s*const fingerprint=JSON\.stringify\(\{)(.*?)(\}\);)$'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected the original state fingerprint")
        match = matches[0]
        extra = "rehearsal_tasks:view==='rehearsal'?(data.tasks||[]).filter(t=>String(t.action||'').startsWith('rehearsal.')).map(t=>[t.id,t.state]):undefined,"
        text = text[:match.start()] + match.group(1) + extra + match.group(2) + match.group(3) + text[match.end():]
    guard = " if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');\n"
    text = once(text, guard, guard+" rehearsal.detach();\n",
                "Rehearsal workspace transition", marker=guard+" rehearsal.detach();")
    return text


def patch_index(text):
    if not re.search(r'\bdata-view=["\']rehearsal["\']', text):
        pattern = r'(?m)^([ \t]*)<button\b[^\n>]*\bdata-view=(["\'])comparisons\2[^\n>]*>[^\n]*?</button>'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected one current Run comparisons navigation button")
        match = matches[0]
        addition = '\n' + match.group(1) + '<button type="button" data-view="rehearsal">Operator rehearsal</button>'
        text = text[:match.end()] + addition + text[match.end():]
    if 'href="/web/rehearsal.css"' not in text:
        text = once(text, "</head>", '<link rel="stylesheet" href="/web/rehearsal.css">\n</head>',
                    "Rehearsal stylesheet")
    return text


def atomic(path, data, *, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".rehearsal-source-", dir=path.parent)
    pending = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        if exclusive:
            os.link(pending, path)
        else:
            os.replace(pending, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        pending.unlink(missing_ok=True)


def read_packet(path):
    if path is None:
        bundle = Path(__file__).resolve().parent.parent
        files = {name: (bundle / name).read_text(encoding="utf-8")
                 for name in sorted(OWNED)}
        value = {
            "schema": SCHEMA, "operation_id": "UPSTATE-REHEARSAL-HANDOVER-A5F3-20261013",
            "edition": "complete-directory", "files": files,
            "file_metadata": {name: {"sha256": sha(body.encode("utf-8")),
                                     "bytes": len(body.encode("utf-8"))}
                              for name, body in files.items()},
        }
    else:
        value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != SCHEMA or set(value.get("files", {})) != OWNED:
        raise ValueError("Select the complete ten-file rehearsal source packet")
    for name, body in value["files"].items():
        if not isinstance(body, str):
            raise ValueError("A complete source body is required: " + name)
        expected = value.get("file_metadata", {}).get(name, {})
        encoded = body.encode("utf-8")
        if expected.get("sha256") != sha(encoded) or expected.get("bytes") != len(encoded):
            raise ValueError("The full source body differs from its declared identity: " + name)
        if name.endswith(".py"):
            ast.parse(body, filename=name)
    return value


def install(application, source=None):
    application = Path(application).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah application")
    if not (application / "model" / "model_selection.py").is_file():
        raise ValueError("Receive the current original selected-model application before this rehearsal edition; "
                         "its maintained model/model_selection.py defines native completion and output scope.")
    packet = read_packet(Path(source) if source else None)
    marker = sha(json.dumps(packet, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    bank = application.parent / ".upstate-rehearsal-install" / application.name
    bank.mkdir(parents=True, exist_ok=True)
    with (bank / "source.lock").open("a+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        updates, original = {}, {}
        for name, body in packet["files"].items():
            path = application / name
            if not path.parent.resolve().is_relative_to(application) or path.is_symlink():
                raise ValueError("Source path leaves the selected original application: " + name)
            incoming = body.encode("utf-8")
            current = path.read_bytes() if path.exists() else None
            if current is not None and current != incoming:
                predecessor = packet.get("predecessors", {}).get(name)
                if not predecessor or sha(current) != predecessor:
                    raise ValueError("The owned source has another current edition: " + name +
                                     ". Compose that full edition before this installation.")
            if current != incoming:
                updates[name], original[name] = incoming, current
        for name, patch in (("operator/server.py", patch_server),
                            ("operator/web/app.mjs", patch_app),
                            ("operator/web/index.html", patch_index)):
            path = application / name
            if not path.parent.resolve().is_relative_to(application) or path.is_symlink():
                raise ValueError("Shared source leaves its selected application: " + name)
            current = path.read_bytes()
            incoming = patch(current.decode("utf-8")).encode("utf-8")
            if incoming != current:
                updates[name], original[name] = incoming, current
        receipt_dir = bank / marker / uuid.uuid4().hex
        receipt_dir.mkdir(parents=True)
        record = {
            "schema": "upstate.rehearsal-install/v1", "operation_id": packet["operation_id"],
            "source_sha256": marker, "application": str(application), "files": {}, "state": "prepared",
        }
        for name, body in updates.items():
            before = original[name]
            if before is not None:
                atomic(receipt_dir / "before" / name, before, exclusive=True)
            atomic(receipt_dir / "after" / name, body, exclusive=True)
            record["files"][name] = {"before": sha(before) if before is not None else None,
                                    "after": sha(body), "bytes": len(body)}
        atomic(receipt_dir / "install.json", (json.dumps(record, indent=2, sort_keys=True)+"\n").encode())
        written = []
        try:
            for name, body in updates.items():
                path = application / name
                current = path.read_bytes() if path.exists() else None
                if current != original[name]:
                    raise ValueError("Concurrent source update detected: " + name)
                atomic(path, body, exclusive=current is None)
                written.append(name)
        except BaseException:
            for name in reversed(written):
                path = application / name
                if path.is_file() and path.read_bytes() == updates[name]:
                    if original[name] is None:
                        path.unlink()
                    else:
                        atomic(path, original[name])
            record["state"] = "rolled_back"
            atomic(receipt_dir / "install.json", (json.dumps(record, indent=2, sort_keys=True)+"\n").encode())
            raise
        record["state"] = "installed" if updates else "already_installed"
        atomic(receipt_dir / "install.json", (json.dumps(record, indent=2, sort_keys=True)+"\n").encode())
        return {**record, "record": str(receipt_dir / "install.json"),
                "opening_route": "Open the existing authenticated operator and choose Operator rehearsal.",
                "runtime": "Source installation only. Reopen the maintained operator when its current work has stopped."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source", type=Path, help="Complete source packet; defaults to the ten original addon files beside this installer")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
