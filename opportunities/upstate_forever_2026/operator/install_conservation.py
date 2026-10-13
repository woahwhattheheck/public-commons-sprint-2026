#!/usr/bin/env python3
"""Integrate the conservation workflow into a current local Upper Savannah app.

Copyright 2026 TokenJunkieLabs. Keeps unrelated operator changes and writes a
recoverable before/after record. This command performs source installation only.
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

OWNED = frozenset({
    "model/conservation.py", "model/conservation_cli.py", "model/conservation_scenarios.py",
    "operator/conservation.py", "operator/web/conservation.mjs",
    "operator/web/conservation.css", "operator/CONSERVATION.md",
    "operator/install_conservation.py", "operator/conservation_regional_receiving.py",
    "model/CONSERVATION.md",
})
SCHEMA = "upstate.conservation-addon/v1"


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
                "from conservation import Conservation, ACTIONS as CONSERVATION_ACTIONS, READS as CONSERVATION_READS\n",
                "Conservation backend import", marker="from conservation import Conservation,")
    if "ACTIONS.update(CONSERVATION_ACTIONS)" not in text:
        tree = ast.parse(text)
        assignment = next((n for n in tree.body if isinstance(n, ast.Assign)
                           and any(isinstance(t, ast.Name) and t.id == "ACTIONS" for t in n.targets)), None)
        if assignment is None:
            raise ValueError("Missing original operator ACTIONS declaration")
        lines = text.splitlines(keepends=True)
        lines.insert(assignment.end_lineno, "ACTIONS.update(CONSERVATION_ACTIONS)\n")
        text = "".join(lines)
    text = once(text, "        self.downloads = {}\n",
                "        self.downloads = {}\n        self.conservation = Conservation(self, Fault)\n",
                "Conservation service", marker="self.conservation = Conservation(self, Fault)")
    text = once(text, '        action = task["action"]\n',
                '        action = task["action"]\n'
                '        if action in CONSERVATION_ACTIONS:\n'
                '            return self.conservation.invoke(task)\n',
                "Conservation task execution", marker="return self.conservation.invoke(task)")
    text = python_method_return(text, "Operator", "task_view",
                                "self.conservation.decorate_task")
    text = once(text, '                workspace = one("workspace", self.app.primary)\n',
                '                workspace = one("workspace", self.app.primary)\n'
                '                conservation_reads = {"/api/conservation/" + name: name for name in CONSERVATION_READS}\n'
                '                if url.path in conservation_reads:\n'
                '                    return self.send_json(200, self.app.conservation.read(workspace,\n'
                '                        conservation_reads[url.path], {name: one(name) for name in ("study_id", "plan_id")}))\n',
                "Conservation read routes", marker='conservation_reads = {"/api/conservation/"')
    if '"conservation.mjs"' not in text:
        pattern = r'(?m)^(\s*if selected not in \{[^\n]*"index\.html"[^\n]*)(\}:)$'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected one original operator static-file allowlist")
        m = matches[0]
        text = text[:m.start()] + m.group(1) + ', "conservation.mjs", "conservation.css"' + m.group(2) + text[m.end():]
    ast.parse(text)
    return text


def patch_app(text):
    if "import {attachConservation}" not in text:
        text = "import {attachConservation} from './conservation.mjs';\n" + text
    text = once(text, "const viewLabels={",
                "const viewLabels={conservation:'Conservation plans',",
                "Conservation view", marker="conservation:'Conservation plans'")
    text = once(text, "const actionLabels={",
                "const actionLabels={'conservation.prepare':'Prepare conservation study',"
                "'conservation.build':'Build conservation inventory',"
                "'conservation.plan.save':'Save conservation plan',"
                "'conservation.export':'Export conservation packet','conservation.scenario.create':'Create selected-land scenario',",
                "Conservation operation labels", marker="'conservation.build':")
    if "const conservation=attachConservation(" not in text:
        matches = list(re.finditer(r"(?m)^const endpoint = [^\n]+\n", text))
        if len(matches) != 1:
            raise ValueError("Expected the original endpoint helper")
        i = matches[0].end()
        text = text[:i] + (
            "const conservation=attachConservation({getState:()=>state,api,endpoint,"
            "openForm,submitAction,detail,fileList,showTask,toast,"
            "closeForm:()=>{formDialog.close();formContext=null;}});\n"
        ) + text[i:]
    branch = (
        "function render(){\n  if(!state)return;\n"
        "  if(view==='conservation'){\n"
        "    for(const node of $$('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');\n"
        "    if(typeof spatialWorkspace!=='undefined')spatialWorkspace.suspend();\n"
        "    if(typeof community!=='undefined')community.detach();\n"
        "    if(typeof customerReviews!=='undefined')customerReviews.detach();\n"
        "    $('#content').innerHTML=conservation.render(state);\n"
        "    conservation.mount($('#content'),state);return;\n"
        "  }\n  conservation.detach();\n"
    )
    text = once(text, "function render(){\n  if(!state)return;\n", branch,
                "Conservation mounted view", marker="conservation.mount($('#content'),state)")
    text = once(text, "async function dispatch(button){\n",
                "async function dispatch(button){\n"
                " if(button.dataset.action?.startsWith('conservation-')){\n"
                "  if(['conservation-open-study','conservation-open-plan'].includes(button.dataset.action)){\n"
                "   detailDialog.close(); await navigate('conservation');\n"
                "  }\n"
                "  return conservation.dispatch(button);\n"
                " }\n",
                "Conservation controls", marker="return conservation.dispatch(button)")
    if "conservation_tasks:" not in text:
        pattern = r'(?m)^(\s*const fingerprint=JSON\.stringify\(\{)(.*?)(\}\);)$'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected the original retained-state fingerprint")
        match = matches[0]
        extra = "conservation_tasks:view==='conservation'?(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')).map(t=>[t.id,t.state]):undefined,"
        text = text[:match.start()] + match.group(1) + extra + match.group(2) + match.group(3) + text[match.end():]
    text = once(text, "async function selectWorkspace(id){\n",
                "async function selectWorkspace(id){\n conservation.detach();\n",
                "Conservation workspace transition", marker="async function selectWorkspace(id){\n conservation.detach();")
    if "conservation.taskActions(row)" not in text:
        start = text.find("async function showTask(")
        end = text.find("\nconst input=", start)
        if start < 0 or end < 0:
            raise ValueError("Expected original operation-detail function")
        section = text[start:end]
        section = once(section, "fileList(row._downloads||[])",
                       "conservation.taskActions(row)+fileList(row._downloads||[])",
                       "Conservation operation links")
        text = text[:start] + section + text[end:]
    return text



def patch_index(text):
    if re.search(r'\bdata-view=["\']conservation["\']', text):
        return text
    pattern = r'(?m)^([ \t]*)<button\b[^\n>]*\bdata-view=(["\'])comparisons\2[^\n>]*>[^\n]*?</button>'
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError("Expected one current Run comparisons navigation button")
    match = matches[0]
    addition = '\n' + match.group(1) + '<button type="button" data-view="conservation">Conservation plans</button>'
    return text[:match.end()] + addition + text[match.end():]


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".conservation-write-", dir=path.parent)
    pending = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def read_packet(path):
    if path is None:
        bundle = Path(__file__).resolve().parent.parent
        files = {name: (bundle / name).read_text(encoding="utf-8")
                 for name in sorted(OWNED) if (bundle / name).is_file()}
        value = {
            "schema": SCHEMA, "operation_id": "UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1",
            "edition": "complete-directory",
            "files": files,
            "file_metadata": {name: {"sha256": sha(body.encode("utf-8")),
                                      "bytes": len(body.encode("utf-8"))}
                              for name, body in files.items()},
        }
    else:
        value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != SCHEMA:
        raise ValueError("Select the complete conservation source packet")
    files = value.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Source packet has no complete source bodies")
    forbidden = set(files) - OWNED
    if forbidden:
        raise ValueError("Source packet contains unrelated paths: " + ", ".join(sorted(forbidden)))
    for name, body in files.items():
        if not isinstance(body, str):
            raise ValueError("Source body is not complete UTF-8 text: " + name)
        expected = value.get("file_metadata", {}).get(name, {})
        encoded = body.encode("utf-8")
        if expected.get("sha256") != sha(encoded) or expected.get("bytes") != len(encoded):
            raise ValueError("Source body differs from its retained identity: " + name)
    needed = {"model/conservation.py", "model/conservation_cli.py", "model/conservation_scenarios.py",
              "operator/conservation.py", "operator/web/conservation.mjs",
              "operator/web/conservation.css"}
    if needed - set(files):
        raise ValueError("The complete backend, CLI and operator source must travel together")
    return value


def install(application, source):
    application = application.resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah application directory")
    packet = read_packet(source)
    marker = sha(source.read_bytes() if source is not None else
                 json.dumps(packet, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    bank = application.parent / ".upstate-conservation-install" / application.name
    bank.mkdir(parents=True, exist_ok=True)
    lock = bank / "source.lock"
    with lock.open("a+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        updates, original = {}, {}
        for name, body in packet["files"].items():
            path = application / name
            if not path.parent.resolve().is_relative_to(application):
                raise ValueError("Source directory leaves the selected application: " + name)
            if path.is_symlink():
                raise ValueError("Owned source path is a symlink: " + name)
            incoming = body.encode("utf-8")
            current = path.read_bytes() if path.exists() else None
            if current is not None and current != incoming:
                raise ValueError("A conservation source file has another current edition: " + name +
                                 ". Preserve it and compose the editions before installation.")
            if current != incoming:
                updates[name], original[name] = incoming, current
        for name, patch in (("operator/server.py", patch_server),
                            ("operator/web/app.mjs", patch_app),
                            ("operator/web/index.html", patch_index)):
            path = application / name
            if not path.parent.resolve().is_relative_to(application):
                raise ValueError("Source directory leaves the selected application: " + name)
            if path.is_symlink():
                raise ValueError("Shared operator source is a symlink: " + name)
            current = path.read_bytes()
            incoming = patch(current.decode("utf-8")).encode("utf-8")
            if incoming != current:
                updates[name], original[name] = incoming, current
        receipt_dir = bank / marker
        receipt_dir.mkdir(parents=True, exist_ok=True)
        written = []
        record = {
            "schema": "upstate.conservation-install/v1",
            "operation_id": packet["operation_id"], "source_sha256": marker,
            "application": str(application), "files": {}, "state": "prepared",
        }
        for name, content in updates.items():
            before = original[name]
            if before is not None:
                atomic(receipt_dir / "before" / name, before)
            record["files"][name] = {
                "before": sha(before) if before is not None else None,
                "after": sha(content), "bytes": len(content),
            }
        atomic(receipt_dir / "install.json",
               (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        try:
            for name, content in updates.items():
                path = application / name
                current = path.read_bytes() if path.exists() else None
                if current != original[name]:
                    raise ValueError("Concurrent source update detected: " + name)
                atomic(path, content)
                written.append(name)
        except BaseException:
            # Roll back only our own exact postimages, preserving concurrent edits.
            for name in reversed(written):
                path = application / name
                if path.is_file() and path.read_bytes() == updates[name]:
                    if original[name] is None:
                        path.unlink()
                    else:
                        atomic(path, original[name])
            record["state"] = "rolled_back"
            atomic(receipt_dir / "install.json",
                   (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
            raise
        record["state"] = "installed" if updates else "already_installed"
        atomic(receipt_dir / "install.json",
               (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        return {**record, "record": str(receipt_dir / "install.json"),
                "opening_route": "Use the existing authenticated operator URL, then Conservation plans."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source", type=Path,
                        help="Complete JSON source packet; defaults to the source files beside this installer")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
