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
KNOWN_PRIOR = {
  "model/experiments.py": [
    "cb626fb6216db80052ccaf4f4c91f1f81e7052d44280d2dc9cc072cd9fcf7a5f",
    "e16d9f0ae747640d31b3716697ca83b943132b3ed49495d444fd3f8285a9a37b",
    "feb8e13c6ac00a8d9987d51f0cb1cdedd25d0e733613f7071b92c6f735b1127d",
    "e391a8d01e873ef1dc1d83391ab51807d2d1f1d2389e962cb8930507580d9d5b",
    "1116c5eeefb495dd7391d7018b6542f4f882d1f992c9a47ec74eb39d30712f61",
    "fe09d098dfe2b3d14b8d40541802e3b893abfcaf719ecf878f92e0776084a38a",
    "ea6a49b365f297ae3cb3891136875abce07f9ec2a0478440123d6162243ad558",
    "03e0c194040ded574d1e739e99ef03e1408c22995c9659714e5fd114e402f72f",
    "80598e10bbbf76b49bee60a6b505aaac31b627675d7e1c347040a46ff8743b77"
  ],
  "model/experiment_cli.py": [
    "0da884c7f3e0fca47390e6ca2d13bdf4616b831168a0213b65a7a98b7038cae9",
    "a1ceef94b5dc5c6cbe78f6cb3a3509d0e8af3e4be9661d3bd9a8e4b1bc179404",
    "67bd485e78da7bc2541f26e361c8cab6cdcf723fa484dba9f82b1acbf9f0d94e"
  ],
  "operator/experiment_operator.py": [
    "c02476827809d17025db050fb553ed944def0aade6c70d350c2f342d74676257",
    "b23afe5b52c269753b5ba8723a1848df17fd41136358d546ca2f9aaa3611dc30",
    "9628308bd9af5295aa668ab5959ee4081c4c20bb8c05c0131338df633d28cab2",
    "f4d491ee4dce0ce8c54b75f45aa556970be426c73ccc7f3632672ffcffd99286",
    "b87a8b6f7239e4b4729f3070d18c09d21689d3a4e69b1b4409fc36ec52f2f898"
  ],
  "operator/web/experiments.mjs": [
    "5a1b52d75c6b86c33cac38e415c09dafccbdaacd918e07ae096460b1f3c6c99f",
    "944e4bfaa7e5ca8bd21735219b5d7d7b6885802eebc77bf91458bd075399ba4a",
    "04bade7104d2abe1955826729408fbd78c02057e94ed60341e7882465c46b701",
    "cd7f5cac6ea00857744b31b11ae96d99dcdeb224195b756a5c45134e9fb3023a"
  ],
  "operator/web/experiments.css": [
    "24a01272447fe6eef2c4f160ee4b1bd45ed656d5c09a156b4af40012d935dca5",
    "8fa0acfe7b03f4cd06a2b0f781a90891fb3e7a13e137af92d5815b6edaa016e4",
    "0f69752453cab8f32fc1f9a5571191bd28aed2524a164aeea2c33ec732033b45"
  ],
  "operator/EXPERIMENTS.md": [
    "ac49038e6268b8280fa4643afb477e84e5ffaa403bc7a26af3b6686859a73f85",
    "ebd6469d79795bc15999c477af88c783e0ef2cd18f463edcd3c922a1e87928b6",
    "cfcd3ca0111d71130206c7f161cb2d4d6b6a49b39e25f0c0f6b493ca6a3e00d7",
    "fa85aa73f6c8047a4de01bbe709e3d92ea05766afe037dbab14d0636fc0f2a13",
    "59c2d0f5344f8ad398ef2bbf47edb695daf7875d749f13d3f2c6420491227f1d"
  ],
  "source/experiment-methods-20261012.json": [
    "f685b9f417e3dbb8277ba1dee5be48f598ea564e59942d8c48755c1629dddb19"
  ],
  "model/EXPERIMENT_MODEL_SELECTION.md": [
    "58696c48c59deb6a3c2d529dc3a5a6d5dbfe680070353c8319d736213a0efa3b",
    "2950ac64a25ff42e49d266d362b40043f877b343eda004c1f48defbfdd71fa25"
  ],
  "install_experiments.py": [
    "b385281038af1d8501df5c15bc6d9b0dec5f59320113c7e5a6839850921c5442",
    "9b318ac5ed09a7c5f3e731685dd232b5416ecf8344d6ce226b026bfd9eb90791",
    "e63e45591b52603ac7f4074710c3937b910a0a1f77650c60a65809bd3c337e01",
    "159db071f2da1a9b661daf1c169355ffb9515fa61c514590bf3037a29a9e4bd2"
  ],
  "model/programme_experiments.py": [
    "f5ba6fc94f46102065aa084f5314a5ac660d31a3eff927549e99f71b831a17cc",
    "ecba938e891af641a245e1c453c22a9a6d257e7b85d70c3b5d495999fead972d"
  ],
  "model/compute_programme_cli.py": [
    "2021af6d59f3a9f94849da50cbcd58eac987f9cbae52964582d1d090c461ff96",
    "268ea8468e60e13b81b6f2236df7cdcf8dae35a3767751e5168bd94e5dee3518",
    "a49c784ccfb96497780444f8259db5743b446c4568c5c143e010b200d1f5b7ea",
    "29437b34d83c871f652b7d5300f50c0aa46a144671013aabc877366068f93551"
  ]
}

LEAVES = (
    "model/experiments.py", "model/experiment_cli.py",
    "model/EXPERIMENT_MODEL_SELECTION.md",
    "model/programme_experiments.py", "model/compute_programme_cli.py",
    "model/EXPERIMENT_PROGRAMME_CONTINUATION.md",
    "operator/experiment_operator.py", "operator/web/experiments.mjs",
    "operator/web/experiments.css", "operator/EXPERIMENTS.md",
    "integration/experiment_native_source_report_composition.json",
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
        'state["experiments"] = self.experiments.catalog(workspace')
    text = wrap_task_return(text)
    text = replace_once(text, '                workspace = one("workspace", self.app.primary)\n',
        '                workspace = one("workspace", self.app.primary)\n'
        '                experiment_reads = {"/api/experiments/" + name: name for name in EXPERIMENT_READS}\n'
        '                if url.path in experiment_reads:\n'
        '                    return self.send_json(200, self.app.experiments.read(workspace, experiment_reads[url.path],\n'
        '                        {name: one(name) for name in ("experiment_id", "offset", "limit", "case_ids")}))\n',
        'experiment_reads = {"/api/experiments/"')
    text = replace_once(text, '("experiment_id", "offset", "limit")',
        '("experiment_id", "offset", "limit", "case_ids")',
        '("experiment_id", "offset", "limit", "case_ids")')
    text = replace_once(text, '            value = self.body()\n',
        '            value = self.body()\n'
        '            if url.path == "/api/experiments/preview":\n'
        '                return self.send_json(200, self.app.experiments.preview(value))\n',
        'url.path == "/api/experiments/preview"')
    tree = ast.parse(text)
    handlers = [node for node in tree.body
                if isinstance(node, ast.ClassDef) and node.name == "Handler"]
    readers = [node for handler in handlers for node in handler.body
               if isinstance(node, ast.FunctionDef) and node.name == "do_GET"]
    matches = [node for reader in readers for node in ast.walk(reader)
               if isinstance(node, ast.Compare) and len(node.ops) == 1
               and isinstance(node.ops[0], ast.NotIn)
               and isinstance(node.left, ast.Name) and node.left.id == "selected"]
    if len(handlers) != 1 or len(readers) != 1 or len(matches) != 1:
        raise ValueError("Current operator needs one compatible static asset registry.")
    # The current native Handler preserves several nested union operands.
    # Change only its original leftmost literal, not parentheses or extension
    # asset sets. Unknown computed registries remain an explicit composition.
    literal_node = matches[0].comparators[0]
    while isinstance(literal_node, ast.BinOp) and isinstance(literal_node.op, ast.BitOr):
        literal_node = literal_node.left
    if not isinstance(literal_node, ast.Set):
        raise ValueError("Current operator static assets must be literal file names.")
    assets = ast.literal_eval(literal_node)
    if not isinstance(assets, set) or not all(isinstance(item, str) for item in assets):
        raise ValueError("Current operator static assets must be literal file names.")
    if {"experiments.mjs", "experiments.css"}.issubset(assets):
        return text
    assets.update(("experiments.mjs", "experiments.css"))
    literal = "{" + ", ".join(json.dumps(item) for item in sorted(assets)) + "}"
    lines = text.splitlines(keepends=True)
    def offset(line, column):
        # AST columns count UTF-8 bytes; source slicing counts characters.
        prefix = lines[line - 1].encode("utf-8")[:column].decode("utf-8")
        return sum(map(len, lines[:line - 1])) + len(prefix)
    first = offset(literal_node.lineno, literal_node.col_offset)
    last = offset(literal_node.end_lineno, literal_node.end_col_offset)
    return text[:first] + literal + text[last:]


def app_join(text):
    text = after_line(text, r"^import \{attachCustomerReviews\} from .+;$",
        "import {attachExperiments} from './experiments.mjs';",
        "import {attachExperiments}")
    text = replace_once(text, "const actionLabels={",
        "const actionLabels={'paired_ensemble.build':'Build paired ensemble','paired_ensemble.resume':'Continue paired ensemble','paired_ensemble.export':'Export paired ensemble','paired_ensemble.receive':'Receive paired ensemble',",
        "'paired_ensemble.build':")
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
