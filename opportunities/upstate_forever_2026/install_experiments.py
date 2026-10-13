#!/usr/bin/env python3
"""Compose the experiment source bundle with the current Upper Savannah app."""
from __future__ import annotations
import argparse
import ast
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

OPERATION = "ES-EXP-2319"
KNOWN_PRIOR = {"model/experiments.py":["e391a8d01e873ef1dc1d83391ab51807d2d1f1d2389e962cb8930507580d9d5b","cb626fb6216db80052ccaf4f4c91f1f81e7052d44280d2dc9cc072cd9fcf7a5f","e16d9f0ae747640d31b3716697ca83b943132b3ed49495d444fd3f8285a9a37b","feb8e13c6ac00a8d9987d51f0cb1cdedd25d0e733613f7071b92c6f735b1127d"],"model/experiment_cli.py":["0da884c7f3e0fca47390e6ca2d13bdf4616b831168a0213b65a7a98b7038cae9"],"operator/experiment_operator.py":["c02476827809d17025db050fb553ed944def0aade6c70d350c2f342d74676257"],"operator/web/experiments.mjs":["5a1b52d75c6b86c33cac38e415c09dafccbdaacd918e07ae096460b1f3c6c99f"],"operator/web/experiments.css":["24a01272447fe6eef2c4f160ee4b1bd45ed656d5c09a156b4af40012d935dca5"],"operator/EXPERIMENTS.md":["ac49038e6268b8280fa4643afb477e84e5ffaa403bc7a26af3b6686859a73f85"],"source/experiment-methods-20261012.json":["f685b9f417e3dbb8277ba1dee5be48f598ea564e59942d8c48755c1629dddb19"]}
LEAVES = (
    "model/experiments.py", "model/experiment_cli.py",
    "operator/experiment_operator.py", "operator/web/experiments.mjs",
    "operator/web/experiments.css", "operator/EXPERIMENTS.md",
    "source/experiment-methods-20261012.json",
)
JOINED = ("operator/server.py", "operator/web/app.mjs",
          "operator/web/index.html", "model/portable.py")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def replace_once(text, before, after, marker):
    if marker in text:
        return text
    if text.count(before) != 1:
        raise ValueError("Current application changed at integration anchor: " + marker)
    return text.replace(before, after, 1)


def after_line(text, pattern, addition, marker):
    if marker in text:
        return text
    matches = list(re.finditer(pattern, text, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError("Current application changed at integration anchor: " + marker)
    end = matches[0].end()
    return text[:end] + "\n" + addition.rstrip("\n") + text[end:]


def wrap_task_return(text):
    marker = "self.experiments.decorate_task("
    if marker in text:
        return text
    tree = ast.parse(text)
    operator = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Operator")
    method = next(node for node in operator.body if isinstance(node, ast.FunctionDef) and node.name == "task_view")
    tail = method.body[-1]
    if not isinstance(tail, ast.Return) or tail.value is None:
        raise ValueError("Current task_view needs composition at its final returned task.")
    expression = ast.get_source_segment(text, tail.value)
    lines = text.splitlines(keepends=True)
    before = sum(map(len, lines[:tail.lineno - 1])) + tail.col_offset
    after = sum(map(len, lines[:tail.end_lineno - 1])) + tail.end_col_offset
    return text[:before] + "return self.experiments.decorate_task(" + expression + ")" + text[after:]


def server_join(text):
    text = after_line(text, r"^from customer_reviews import .+$",
        "from experiment_operator import ExperimentOperator, ACTIONS as EXPERIMENT_ACTIONS, READS as EXPERIMENT_READS",
        "from experiment_operator import ExperimentOperator")
    text = replace_once(text, "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)",
        "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\nACTIONS.update(EXPERIMENT_ACTIONS)",
        "ACTIONS.update(EXPERIMENT_ACTIONS)")
    text = after_line(text, r"^        self\.customer_reviews = CustomerReviews\(.+\)$",
        "        self.experiments = ExperimentOperator(self, Fault)",
        "self.experiments = ExperimentOperator")
    text = replace_once(text, '        action = task["action"]\n',
        '        action = task["action"]\n'
        '        if action in EXPERIMENT_ACTIONS:\n'
        '            return self.experiments.invoke(task)\n',
        "if action in EXPERIMENT_ACTIONS:")
    text = replace_once(text, "        state = ws.overview()\n",
        "        state = ws.overview()\n"
        "        state[\"experiments\"] = self.experiments.catalog(workspace)\n",
        'state["experiments"] = self.experiments.catalog(workspace)')
    text = wrap_task_return(text)
    text = replace_once(text, '                workspace = one("workspace", self.app.primary)\n',
        '                workspace = one("workspace", self.app.primary)\n'
        '                experiment_reads = {"/api/experiments/" + name: name for name in EXPERIMENT_READS}\n'
        '                if url.path in experiment_reads:\n'
        '                    return self.send_json(200, self.app.experiments.read(workspace, experiment_reads[url.path],\n'
        '                        {name: one(name) for name in ("experiment_id", "offset", "limit")}))\n',
        'experiment_reads = {"/api/experiments/"')
    text = replace_once(text, '            value = self.body()\n',
        '            value = self.body()\n'
        '            if url.path == "/api/experiments/preview":\n'
        '                return self.send_json(200, self.app.experiments.preview(value))\n',
        'url.path == "/api/experiments/preview"')
    matches = list(re.finditer(r"if selected not in (\(?)(\{[^}\n]+\})([^:\n]*):", text))
    if len(matches) != 1:
        raise ValueError("Current operator needs one compatible static asset registry.")
    match = matches[0]
    assets = ast.literal_eval(match.group(2))
    if not isinstance(assets, set) or not all(isinstance(item, str) for item in assets):
        raise ValueError("Current operator static assets must be literal file names.")
    assets.update(("experiments.mjs", "experiments.css"))
    literal = "{" + ", ".join(json.dumps(item) for item in sorted(assets)) + "}"
    text = (text[:match.start()] + "if selected not in " + match.group(1) +
            literal + match.group(3) + ":" + text[match.end():])
    return text


def app_join(text):
    text = after_line(text, r"^import \{attachCustomerReviews\} from .+;$",
        "import {attachExperiments} from './experiments.mjs';",
        "import {attachExperiments}")
    text = replace_once(text, "const viewLabels={",
        "const viewLabels={experiments:'Scenario experiments',",
        "experiments:'Scenario experiments'")
    text = replace_once(text, "const actionLabels={",
        "const actionLabels={'experiment.save':'Save experiment design','experiment.run':'Run scenario experiment',"
        "'experiment.summarize':'Build experiment report',",
        "'experiment.save':'Save experiment design'")
    text = after_line(text, r"^const customerReviews=attachCustomerReviews\(.+\);$",
        "const experiments=attachExperiments({navigate,closeDetail:()=>{detailDialog.close();detailContext=null;},getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,toast,openItem,showTask});",
        "const experiments=attachExperiments(")
    text = replace_once(text, "const experiments=attachExperiments({",
        "const experiments=attachExperiments({navigate,closeDetail:()=>{detailDialog.close();detailContext=null;},",
        "const experiments=attachExperiments({navigate,closeDetail:")
    text = replace_once(text, "customerReviews.taskActions(row)",
        "customerReviews.taskActions(row)+experiments.taskActions(row)",
        "experiments.taskActions(row)")
    text = after_line(text, r"^  for\(const node of \$\$\('\[data-view\]'\)\)node\.setAttribute\(.+;$",
        "  if(view==='experiments'){if(typeof programmes!=='undefined')programmes.detach();if(typeof extensions!=='undefined')extensions.detach();spatialWorkspace.suspend();community.detach();customerReviews.detach();experiments.mount($('#content'),state);return;}\n"
        "  experiments.detach();",
        "if(view==='experiments'){")
    text = replace_once(text, "workspace=id;state=null;",
        "experiments.detach();workspace=id;state=null;",
        "experiments.detach();workspace=id;state=null;")
    text = replace_once(text, " const action=button.dataset.action,id=button.dataset.id;\n",
        " const action=button.dataset.action,id=button.dataset.id;\n"
        " if(action?.startsWith('experiment-'))return experiments.dispatch(button);\n",
        "if(action?.startsWith('experiment-'))")
    return text


def index_join(text):
    text = replace_once(text, "</head>",
        '<link rel="stylesheet" href="/web/experiments.css">\n</head>',
        'href="/web/experiments.css"')
    text = replace_once(text, '    <button data-view="comparisons">',
        '    <button data-view="experiments">Scenario experiments</button>\n'
        '    <button data-view="comparisons">',
        'data-view="experiments"')
    return text


def portable_join(text):
    text = replace_once(text,
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n',
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n'
        '            for path in sorted((root / "experiments").glob("*/.experiment.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n',
        '(root / "experiments").glob("*/.experiment.lock")')
    return text


def install(application, source):
    application = Path(application).resolve(strict=True)
    source = Path(source).resolve(strict=True)
    if not (application / "model/workspace.py").is_file():
        raise ValueError("Choose the existing Upper Savannah application directory.")
    ledger = application / ".experiment-source.json"
    previous = json.loads(ledger.read_text(encoding="utf-8")) if ledger.exists() else {}
    originals, desired = {}, {}
    for relative in LEAVES:
        original = source / relative
        if not original.is_file():
            raise ValueError("The complete experiment source bundle is missing " + relative)
        body = original.read_bytes()
        target = application / relative
        current = target.read_bytes() if target.exists() else None
        if current is not None and current != body:
            expected = previous.get("files", {}).get(relative)
            prior = set(KNOWN_PRIOR.get(relative, ()))
            if expected:
                prior.add(expected)
            prior.add(digest(body))
            normalized = current.decode("utf-8").replace("\u00a0", " ").encode("utf-8")
            if digest(current) not in prior and digest(normalized) not in prior:
                raise ValueError("Preserve and compose the concurrent source revision in " + relative)
        originals[relative], desired[relative] = current, body
    for relative, join in zip(JOINED, (server_join, app_join, index_join, portable_join)):
        target = application / relative
        body = target.read_bytes()
        originals[relative] = body
        desired[relative] = join(body.decode("utf-8")).encode("utf-8")
    for relative, body in desired.items():
        if relative.endswith(".py"):
            compile(body.decode("utf-8"), str(application / relative), "exec")
        elif relative.endswith(".json"):
            json.loads(body)
    changed = [relative for relative in desired if desired[relative] != originals[relative]]
    temporary = {}
    try:
        for relative in changed:
            target = application / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, staging = tempfile.mkstemp(prefix=".write-experiment-", dir=target.parent)
            with os.fdopen(fd, "wb") as output:
                output.write(desired[relative])
                output.flush()
                os.fsync(output.fileno())
            temporary[relative] = staging
        for relative in changed:
            target = application / relative
            current = target.read_bytes() if target.exists() else None
            if current != originals[relative]:
                raise ValueError("Application source changed during composition: " + relative)
        for relative in changed:
            target = application / relative
            current = target.read_bytes() if target.exists() else None
            if current != originals[relative]:
                raise ValueError("Application source changed before installation: " + relative)
            os.replace(temporary.pop(relative), target)
        record = {"operation_id": OPERATION,
                  "files": {relative: digest(desired[relative]) for relative in LEAVES}}
        fd, staging = tempfile.mkstemp(prefix=".write-experiment-ledger-", dir=application)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(record, output, sort_keys=True)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(staging, ledger)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(staging)
    finally:
        for staging in temporary.values():
            with contextlib.suppress(FileNotFoundError):
                os.unlink(staging)
    return {"operation_id": OPERATION, "state": "installed", "application": str(application),
            "changed_files": changed,
            "entrypoint": "python -B " + str(application / "operator/server.py") + " --workspace <retained-study>",
            "guide": str(application / "operator/EXPERIMENTS.md")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", help="Current Upper Savannah application directory")
    parser.add_argument("--source", default=Path(__file__).resolve().parent,
                        help="Extracted experiment source bundle root")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.application, args.source), indent=2))
    except Exception as error:
        parser.exit(1, "Experiment installation failed: " + str(error) + "\n")


if __name__ == "__main__":
    main()
