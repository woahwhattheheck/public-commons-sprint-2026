"""Install calibration into the retained Upper Savannah operator without replacing its source.

The extension files are copied from this source cohort. Existing shared modules
receive only named registration additions; original native engines and sibling
operator capabilities remain intact.
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
import sys
import tempfile

FILES = ("model/calibration.py", "model/CALIBRATION.md", "operator/calibration.py",
         "operator/web/calibration.mjs", "operator/web/calibration.css",
         "operator/CALIBRATION.md", "operator/install_calibration.py")
SHARED = ("operator/server.py", "operator/web/app.mjs", "operator/web/index.html")
VERSION = "upstate.calibration-registration/v1"


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".calibration-install-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _replace(text, before, after, label):
    if after in text:
        return text
    if text.count(before) != 1:
        raise ValueError(label + ": expected one existing registration location; compose this current source before installing")
    return text.replace(before, after, 1)


def _insert_line(text, expression, addition, label):
    if addition.strip() in text:
        return text
    matches = list(re.finditer(expression, text, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(label + ": expected one original registration line")
    match = matches[0]
    return text[:match.end()] + "\n" + addition + text[match.end():]


def _server(text):
    text = _replace(text, "from model.spatial_exports import SpatialExports",
                    "from model.spatial_exports import SpatialExports\n"
                    "from calibration import CalibrationOperations, ACTIONS as CALIBRATION_ACTIONS, READS as CALIBRATION_READS",
                    "Calibration backend import")
    text = _replace(text, "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)",
                    "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\nACTIONS.update(CALIBRATION_ACTIONS)",
                    "Calibration action registration")
    text = _replace(text, "        self.customer_reviews = CustomerReviews(self, Fault)",
                    "        self.customer_reviews = CustomerReviews(self, Fault)\n"
                    "        self.calibration = CalibrationOperations(self, Fault)",
                    "Calibration operator instance")
    text = _replace(text, "        if action in CUSTOMER_REVIEW_ACTIONS:",
                    "        if action in CALIBRATION_ACTIONS:\n"
                    "            return self.calibration.invoke(task)\n"
                    "        if action in CUSTOMER_REVIEW_ACTIONS:", "Calibration queued operations")
    state_anchor = "    def state(self, workspace):\n        ws = self.ws(workspace)\n        state = ws.overview()"
    text = _replace(text, state_anchor, state_anchor + "\n        state.update(self.calibration.state(workspace))",
                    "Calibration workspace state")
    text = _replace(text, "self.customer_reviews.decorate_task(task)",
                    "self.customer_reviews.decorate_task(self.calibration.decorate_task(task))",
                    "Calibration task downloads")
    get_anchor = '                if url.path == "/api/state":\n                    return self.send_json(200, self.app.state(workspace))'
    text = _replace(text, get_anchor, get_anchor + '\n'
                    '                calibration_reads = {"/api/calibration/" + name: name for name in CALIBRATION_READS}\n'
                    '                if url.path in calibration_reads:\n'
                    '                    return self.send_json(200, self.app.calibration.read(\n'
                    '                        workspace, calibration_reads[url.path], {"id": one("id")}))',
                    "Calibration read routes")
    post_anchor = '            if url.path == "/api/actions":'
    text = _replace(text, post_anchor,
                    '            if url.path == "/api/calibration/preview":\n'
                    '                return self.send_json(200, self.app.calibration.preview(\n'
                    '                    value.get("workspace", self.app.primary), required(value, "selection")))\n'
                    + post_anchor, "Calibration original-source preview")
    if '"calibration.mjs"' not in text or '"calibration.css"' not in text:
        matches = list(re.finditer(r"(?m)^(\s*if selected not in )(\{[^\n]*\})(:)$", text))
        if len(matches) != 1:
            raise ValueError("Static module registration: expected the original selected-file set")
        match = matches[0]
        original = match.group(2)
        names = ast.literal_eval(original)
        if not isinstance(names, set) or any(not isinstance(name, str) for name in names):
            raise ValueError("Static module registration differs from the original string set")
        additions = [name for name in ("calibration.mjs", "calibration.css") if name not in names]
        updated = original[:-1].rstrip().rstrip(",") + ", " + ", ".join(json.dumps(name) for name in additions) + "}"
        text = text[:match.start(2)] + updated + text[match.end(2):]
    return text


def _app(text):
    text = _replace(text, "import {attachCustomerReviews} from './reviews.mjs';",
                    "import {attachCustomerReviews} from './reviews.mjs';\n"
                    "import {attachCalibration} from './calibration.mjs';", "Calibration browser import")
    if "calibration:'Calibration and validation'" not in text:
        text = _replace(text, "const viewLabels={",
                        "const viewLabels={calibration:'Calibration and validation',", "Calibration view title")
    if "'calibration.prepare':'Save calibration selection'" not in text:
        text = _replace(text, "const actionLabels={",
                        "const actionLabels={'calibration.prepare':'Save calibration selection',"
                        "'calibration.analyze':'Analyze original annual loads',"
                        "'calibration.export':'Export calibration results',", "Calibration task labels")
    text = _insert_line(text, r"^const customerReviews=attachCustomerReviews\([^\n]*\);$",
                        "const calibration=attachCalibration({getState:()=>state,api,endpoint,openForm,submitAction,"
                        "detail,fileList,openItem,showTask,toast});", "Calibration browser attachment")
    text = _replace(text, "if(view==='spatial'){",
                    "if(view==='spatial'){calibration.detach();", "Spatial view lifecycle")
    text = _replace(text, "  if(view==='customer-reviews')html=customerReviews.render();",
                    "  if(view==='customer-reviews')html=customerReviews.render();\n"
                    "  if(view==='calibration')html=calibration.render();", "Calibration view rendering")
    text = _replace(text, "  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();",
                    "  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();\n"
                    "  if(view==='calibration')calibration.mount($('#content'));else calibration.detach();",
                    "Calibration view lifecycle")
    text = _replace(text, "customerReviews.taskActions(row)",
                    "customerReviews.taskActions(row)+calibration.taskActions(row)", "Calibration task links")
    text = _replace(text, "workspace=id;state=null;",
                    "calibration.detach();workspace=id;state=null;", "Calibration workspace change")
    text = _replace(text, " if(action?.startsWith('review-'))return customerReviews.dispatch(button);",
                    " if(action?.startsWith('review-'))return customerReviews.dispatch(button);\n"
                    " if(action?.startsWith('calibration-'))return calibration.dispatch(button);",
                    "Calibration browser actions")
    return text


def _html(text):
    text = _replace(text, '<link rel="stylesheet" href="/web/reviews.css">',
                    '<link rel="stylesheet" href="/web/reviews.css">\n'
                    '<link rel="stylesheet" href="/web/calibration.css">', "Calibration stylesheet")
    text = _replace(text, '    <button data-view="observations">Observed water quality</button>',
                    '    <button data-view="observations">Observed water quality</button>\n'
                    '    <button data-view="calibration">Calibration and validation</button>',
                    "Calibration navigation")
    return text


def install(application, source, *, preview=False):
    application, source = Path(application).resolve(strict=True), Path(source).resolve(strict=True)
    for path in ("model/workspace.py", "model/observations.py", *SHARED):
        if not (application / path).is_file():
            raise ValueError("Select the complete retained scientific application; missing " + path)
    lock_path = application / "operator" / ".calibration-registration.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest_path = application / "operator" / "calibration-install.json"
        previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        originals, changes, kinds = {}, {}, {}
        for name in FILES:
            incoming = source / name
            if not incoming.is_file():
                raise ValueError("The calibration source cohort is incomplete: " + name)
            data = incoming.read_bytes()
            target = application / name
            before = target.read_bytes() if target.exists() else None
            if before is not None and before != data:
                expected = previous.get("installed", {}).get(name)
                if expected != _hash(before):
                    raise ValueError("Existing extension has independent changes: " + name
                                     + " (current " + _hash(before) + ", incoming " + _hash(data) + ")")
            originals[name], changes[name], kinds[name] = before, data, "extension"
        for name, patcher in zip(SHARED, (_server, _app, _html)):
            path = application / name
            before = path.read_bytes()
            after = patcher(before.decode("utf-8")).encode("utf-8")
            originals[name], changes[name], kinds[name] = before, after, "registration"
        for name, data in changes.items():
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
        plan = [{"path": name, "kind": kinds[name], "before_sha256": _hash(originals[name]) if originals[name] is not None else None,
                 "after_sha256": _hash(data), "changed": data != originals[name]}
                for name, data in changes.items()]
        receipt = {"schema": VERSION, "application": str(application), "files": plan,
                   "changed_files": sum(row["changed"] for row in plan)}
        if preview:
            return {**receipt, "state": "prepared"}
        operation_id = _hash(json.dumps(plan, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        history = application / ".calibration-install-history" / operation_id
        for name, before in originals.items():
            path = application / name
            current = path.read_bytes() if path.exists() else None
            if current != before:
                raise ValueError("Original source changed during calibration preparation: " + name)
        for name, data in changes.items():
            before = originals[name]
            if before == data:
                continue
            path = application / name
            current = path.read_bytes() if path.exists() else None
            if current != before:
                raise ValueError("Concurrent source changed before registration: " + name)
            if before is not None:
                _atomic(history / name, before)
            _atomic(path, data)
        installed = {name: _hash(data) for name, data in changes.items()}
        _atomic(manifest_path, (json.dumps({"schema": VERSION, "operation_id": operation_id,
                                           "installed": installed}, sort_keys=True, indent=2) + "\n").encode("utf-8"))
        return {**receipt, "state": "installed", "operation_id": operation_id}
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True,
                        help="The existing complete Upper Savannah scientific application")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1],
                        help="This calibration source cohort, with model/ and operator/")
    parser.add_argument("--preview", action="store_true", help="Show exact composed paths before applying")
    args = parser.parse_args(argv)
    try:
        result = install(args.application, args.source, preview=args.preview)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (ValueError, OSError, SyntaxError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
