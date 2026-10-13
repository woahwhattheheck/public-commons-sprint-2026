"""Install native supervision into a current cumulative Upper Savannah source copy."""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

MARKER = "ES-SUPERVISION-20261012"
MEMBERS = ("model/native_execution.py", "model/native_worker.py",
           "operator/native_jobs.py", "operator/programme_jobs.py",
           "operator/parameter_study_jobs.py", "operator/parameter_study_api.py",
           "model/parameter_case_status.py", "model/parameter_result_query.py",
           "model/parameter_views.py",
           "model/record_catalog.py", "model/delivery_catalogue.py",
           "operator/web/parameter_case_console.mjs", "operator/web/parameter_studies.mjs",
           "operator/web/parameter_studies.css", "docs/PARAMETER_CASE_CONSOLE.md",
           "docs/PARAMETER_RESULT_QUERIES.md", "docs/PARAMETER_STUDY_PROCESS_RECOVERY.md",
           "docs/PARAMETER_CASE_BROWSING.md",
           "operator/web/jobs.mjs", "operator/web/jobs.css", "operator/NATIVE_JOBS.md",
           "install_native_supervision.py")
PREVIOUS = {
    "model/native_worker.py": [
        "9f9db4a2a90e05a2ac10adc330234c6e0d15d9a1ff68421c95994c5060e162bd",
        "9f9db4a2a90e05a2ac10adc330234c6e0d15d9a1ff68421c95994c5060e162bd"
    ],
    "operator/native_jobs.py": [
        "0354dede58377c16365d57e14b30c05cb708397d5a5ff54aff1088a5ffe302e2",
        "1cb382f7dead82d235ad990f8f367e101012468b62bcf9aa6d8e96e5655cb4ef",
        "8f6540415880ff5d32a332b3705470be0c934b94918e9a6375180725ac6fc124",
        "f8f0b481ce4230f1695e0e441ddc9d69c46be629f37139444b76371031a2200e"
    ],
    "operator/web/jobs.mjs": [
        "6ca348832532240d0419b803be15058cea53f879cb6d71320fc34609d5ce1e55",
        "860c7187d6e9ac5a7c8fb8ecb109a70a32d96a613209ab7bf8ccb57b16470a8b",
        "2d319c934b3433e30dcaca07179396ca9c10315b953ff847aa5904ede92bae24"
    ],
    "operator/web/jobs.css": [
        "3ae4db4b034aa76dedc90082f8f8d8d8419da20e93de3bac2594480d0e314654",
        "3ae4db4b034aa76dedc90082f8f8d8d8419da20e93de3bac2594480d0e314654"
    ],
    "install_native_supervision.py": [
        "28c2f3865c877cad45a5d33fe1c20f95a7b63780b18a188df49d1f3a1bf4582b",
        "1384be68704372c5a68e85defeb16fe9d15e393c7b6cca3bf2a24426b85281a8",
        "c28f73394b3f90573ac670d95d45eeca18d14552e5775589f6256a5a89900a0f",
        "fcbb50e445dfac018fbc01d054f8b6c9afc3714a848fd01f413640959a4020f1",
        "9d78b60a83066f4ba6b03120011453477123aefeb4420d958a0b2be4c1aa326c"
    ],
    "operator/NATIVE_JOBS.md": [
        "2b34253190fa9986b69f6576795a264b8a6830f1e8ce15187db8adcfe5f2c10b",
        "bf738bea875b58b15a14fac187b652d20d174c8db1c60e4b942ec2d139ab7a4f",
        "8f52ff27c0fb047a72b911c9ba0d8915fcca4afe2c79e7322c5b962a87fc07ad",
        "035b9877c26d78bd388dccb579f37db4f6661c5e0d3a12889b57a9ad26c35976",
        "6b0d383098e8e49fb25def068ec4d86b40ffc565389e48cc4a504bbf1ceca9fe"
    ]
}
# Exact reviewed r6 source; preserve authored predecessors during current-main integration.
PREVIOUS["operator/native_jobs.py"].append("c302f586cc963486fa426a0ad2b092dfc25506fd41f5f18aefa619e118731414")
PREVIOUS["operator/web/jobs.mjs"].append("623428c34687a8a6ae3585ba3edcb39ca2f2f128a7228edbea0cd74c69463798")
PREVIOUS["install_native_supervision.py"].append("f7f8eeb14775db385193054cc40de8288e4133fa8bcd451fc1a6f70f9db33ce8")
PREVIOUS["operator/NATIVE_JOBS.md"].append("76ee80b7b1944ba2d46d5b285d295d0b91e66ec9f5bb1a03d0d94114b6d8bf51")

# D406 revision2 is an accepted predecessor of route-registry integration.
PREVIOUS["install_native_supervision.py"].append("81f28bb3ac6c0cd8d0328432a6e68e63c48cf90741501fedffcf8ca708d84e75")

# First complete current-main bank, retained for a safe repeated upgrade.
PREVIOUS["install_native_supervision.py"].append("ed7828c98bf5a77565dbef47cbf0a2dddd9b71dc77997630b84a1bf60c8ba18d")
PREVIOUS["operator/NATIVE_JOBS.md"].append("ca2629a57c11c600bd19697d68d82eaafe1795640d1d08a45c9bdcf21a6ffd2c")

# Exact published initial/final r6 and merged operator installer predecessors.
PREVIOUS.setdefault("operator/programme_jobs.py", []).append("367e0164cf452a33c0f959074d09c49f9baf781a72e89091fbf094bd89420b95")
PREVIOUS["install_native_supervision.py"].extend([
    "abedd2b3cf9273e47a9839f0e12827b208aab771d0016e3c2d16fac2bd11b841",
    "a1662f789268a79a1a949f2cf80d0ed2a00cc12c88ea029273b5bf76df2f3f9a",
    "d8606e537707dc8439fc622e6ed039ae6d78233947d4167edaa904df61830ad8",
])

# Exact reviewed current sources for the resource-observation receiving join.
PREVIOUS.setdefault("model/native_execution.py", []).extend(["90ab72a4fa50bc091cc9d94c1d8723acff71affdf25d8cefe9943668ca17ef37"])
PREVIOUS.setdefault("model/native_worker.py", []).extend(["d2741fe7d10c968f957058d0d451459abd2190a0c810ed17095fcb13887119d3"])
PREVIOUS.setdefault("operator/native_jobs.py", []).extend(["f1211b519a6ec10759d0dc86b6a4a2c0eaa3bc4832d1d6307cf8416e144f132c"])
PREVIOUS.setdefault("operator/web/jobs.mjs", []).extend(["a444e9902dd6166e55accac9bbe6abe85532b1d61d4779e839f7d9ee11971331"])
PREVIOUS.setdefault("operator/NATIVE_JOBS.md", []).extend(["d39a47eaa42cefba9507ac5dbd496b099ab7c8ca95087bf0bb1f414a75ecc5da","41a54e92a90fd6666b2786e04272e0cfd1a5cb1a39915f96c46b1b2f7fb2ec6a","e2ae8fd5912f8cccf51eb44f21d78d187a321a98cca50f92cbb9a17637916799"])
PREVIOUS.setdefault("install_native_supervision.py", []).extend(["9690dc3d9228c53f383e283684388df7775fc3264802287ea6847437f7fa419c"])

# Exact maintained source before/after saved-study supervision (PR3535).
PREVIOUS.setdefault("model/native_execution.py", []).extend(["2050d878373662c11dd1a80ef6e65ab824b64dbee463944ee6ddf31e66a199ce"])
PREVIOUS.setdefault("model/native_worker.py", []).extend(["6943b73989ab5e82d271f4c5fc90c0970ae413c3d996aa9d541b9ce84f019894"])
PREVIOUS.setdefault("operator/native_jobs.py", []).extend(["b90b1f44c6328d08a5e6fdb049d0a25b6ad864855d77f7fb07c0fc607f681835","6b5ec5d607e38ae8148e744b8b97935ba027d06dcd63190847b485abac4c4f5e"])
PREVIOUS.setdefault("operator/programme_jobs.py", []).extend(["7ee1937019c583423a04a157975e32c74cf686f961ff7c519bf054cf588a9b98"])
PREVIOUS.setdefault("operator/web/jobs.mjs", []).extend(["3954f68136baab7e93f5025c9a03e2355b1f1869db88f56c9ae2498278f464a9"])
PREVIOUS.setdefault("operator/parameter_study_api.py", []).extend(["a6eb20105e6f6f099a3f2a97021d914b2a9535b38cf64ee55bebb55caa3e3a11"])
PREVIOUS.setdefault("install_native_supervision.py", []).extend(["1deba14b65ed046c7283cdeb9a97bd0702027eafc44e62993a8c54c6e1ab6e12"])
PREVIOUS.setdefault("operator/NATIVE_JOBS.md", []).extend(["4f3c1dd30be3c78b585c0070662649e3c985fc56da383317e2c491b4f593b39e"])
PREVIOUS.setdefault("operator/parameter_study_jobs.py", []).extend(["181b0dc0c401bbe4b44a6a106e0fe6236c1c776247398d5ee693532d8602217d", "7fa5a1a929c80251e75d0273722c73f83715b6ebe94c706dade354b4f0c62919"])

# Installed source before the complete retained Parameter result/console join.
PREVIOUS.setdefault("operator/parameter_study_api.py", []).append("4b74287a788429736026bd6a7e8c0f3f1a83d977ff51e06b9c7eaec913150ee5")
PREVIOUS.setdefault("operator/web/parameter_studies.mjs", []).append("26be73f32614a1e9dabf25aea83dbb53bff243a379b5c6ed30d8b2265afa3a84")
PREVIOUS.setdefault("operator/web/parameter_studies.mjs", []).append("ca146243fe69c861c36acbb202492eb01bcd9163fbaa7d00e2b5b56178da9a0b")
PREVIOUS.setdefault("install_native_supervision.py", []).append("f3a0528a818641095969898b635e7c6324f6ab6842995cbe55f90f2079aee733")
PREVIOUS.setdefault("operator/NATIVE_JOBS.md", []).append("fb4339debca8ab51cb97cdf076b16a0f61c86afcc5bef2a5a4383da6001a2b56")

# Complete the received Parameter operating guide while accepting this original edition.
PREVIOUS.setdefault("operator/NATIVE_JOBS.md", []).append("125bfb1e39c0a0c56f84c7d171e15b7c9e55ffd0d635381af1df8137002a68b8")
PREVIOUS.setdefault("install_native_supervision.py", []).append("2badb6f90e9ff87475be475cf7f4551352e507c39ac24684623a4c9a2f1c6bef")


# Exact installed source before compact saved-case navigation (PR3867).
PREVIOUS.setdefault("install_native_supervision.py", []).append("273ea100d343c3665da104942758a4ecc79554f0c00b16149412be4a982c9927")
PREVIOUS.setdefault("operator/NATIVE_JOBS.md", []).append("80ee50777b8c95ae725a1aff63c5bacabdfc385da29fb5f840d983ecd9eb0926")
PREVIOUS.setdefault("operator/parameter_study_api.py", []).append("be0642a44fbb5e55a81184563675b9665333f1ca97cb7ec0f1926f5d29d7f4fe")
PREVIOUS.setdefault("operator/web/parameter_studies.mjs", []).append("af524e4158c89dad72ea8d0a9c6ed636db10bab1f1c977e616ddf6988fae437a")
PREVIOUS.setdefault("model/parameter_case_status.py", []).append("0fd189b233f6a10420b73946151e907caa49774feabccadf674ac14cda9b3b7d")

DETACH_DISPOSITION = ('            final_state = ("interrupted" if isinstance(error, NativeJobDetached) else\n'
                      '                           "cancelled" if isinstance(error, NativeJobCancelled) else "failed")\n')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def replace_one(text, before, after, label):
    if text.count(before) != 1:
        raise ValueError(label + " needs the current source join; found " + str(text.count(before)) + " anchors")
    return text.replace(before, after, 1)


def native_dispatch(text, *, retention=False):
    """Compose either the original run or the exact ECO-RUN12 retained wrapper."""
    retained = ('        if action == "run.start":\n'
                '            from ecsa_runs.upstate import invoke_original_run\n'
                '            return invoke_original_run(self, task, ws, required(value, "run_id"))\n')
    original = ('        if action == "run.start":\n'
                '            return ws.run(required(value, "run_id"))\n')
    if retained in text:
        return replace_one(text, retained,
            '        if action == "run.start":\n'
            '            return self.native_jobs.execute_retained(task, ws)\n',
            "retained native run composition")
    if original in text:
        call = "execute_retained" if retention else "execute"
        return replace_one(text, original,
            '        if action == "run.start":\n'
            '            return self.native_jobs.' + call + '(task, ws)\n',
            "native run dispatch")
    if text.count("return self.native_jobs.execute(task, ws)") == 1:
        return (replace_one(text, "return self.native_jobs.execute(task, ws)",
                            "return self.native_jobs.execute_retained(task, ws)",
                            "retention around existing supervision") if retention else text)
    if text.count("return self.native_jobs.execute_retained(task, ws)") == 1:
        return text
    raise ValueError("The current native run dispatch needs its retained/supervised source join")


def programme_server_patch(text):
    previous_cursor = 'expected_run=one("run_id", "")))'
    current_cursor = ('expected_run=one("run_id", ""), '
                      'expected_execution=one("execution_id", "")))')
    if previous_cursor in text:
        text = replace_one(text, previous_cursor, current_cursor,
                           "same-run process log continuation")
    substitutions = (
        ('if task["action"] == "run.start" and task["state"] != "queued":',
         'if self.native_jobs.supports(task) and task["state"] != "queued":'),
        ('if task["action"] == "run.start":\n            task["_native_job"] = self.native_jobs.snapshot(task)',
         'if self.native_jobs.supports(task):\n            try:\n                task["_native_job"] = self.native_jobs.snapshot(task)\n            except NativeJobError as error:\n                if error.code != "PROGRAMME_PREPARING":\n                    raise'),
        ('stream=one("stream", "native"), offset=one("offset", "0")))',
         'stream=one("stream", "native"), offset=one("offset", "0"),\n'
         '                        expected_run=one("run_id", ""), expected_execution=one("execution_id", "")))'))
    for before, after in substitutions:
        if before in text:
            text = replace_one(text, before, after, "programme native operator registration")
        elif after not in text:
            raise ValueError("The current operator needs its programme supervision registration")
    ast.parse(text)
    return text


def programme_patch(text):
    original = '            result = manager.resume(key, only_runs=payload.get("only_runs"))\n'
    joined = ('            # ' + MARKER + ' programme execution\n'
              '            result = self.operator.native_jobs.execute_programme(\n'
              '                task, manager, key, only_runs=payload.get("only_runs"))\n')
    if joined not in text:
        text = replace_one(text, original, joined, "original programme resume dispatch")
    pair = '            result = manager.create_pair_completion(key, expected_preview_id=payload.get("expected_preview_id"))\n'
    pinned = ('            result = self.operator.native_jobs.create_pair_completion(\n'
              '                task, manager, key, expected_preview_id=payload.get("expected_preview_id"))\n')
    if pair in text:
        text = replace_one(text, pair, pinned, "original paired task preview binding")
    elif "compute.programme.pair-completion" in text and pinned not in text:
        raise ValueError("The current paired completion creation needs its original task preview join")
    ast.parse(text)
    return text


def builtin_route_patch(text):
    """Register the native route in the existing extension collision check."""
    keywords = [node for node in ast.walk(ast.parse(text))
                if isinstance(node, ast.keyword) and node.arg == "builtin_routes"]
    if len(keywords) != 1:
        raise ValueError("The current extension registry needs its native route join")
    node = keywords[0].value
    routes = ast.literal_eval(node)
    if not isinstance(routes, (tuple, list)):
        raise ValueError("The original built-in routes must remain a literal sequence")
    route = ("GET", "/api/native-job")
    count = routes.count(route)
    if count == 1:
        return text
    if count:
        raise ValueError("The native built-in route is registered more than once")
    updated = [*routes, route]
    replacement = repr(tuple(updated) if isinstance(routes, tuple) else updated)
    segment = ast.get_source_segment(text, node)
    if not segment:
        raise ValueError("The original built-in route registry has no source span")
    return replace_one(text, segment, replacement, "native built-in route registration")


def native_import_patch(text):
    """Put the original operator path before a retained supervision import."""
    operator_path = "sys.path.insert(0, str(Path(__file__).resolve().parent))\n"
    native_import = ("from native_jobs import NativeJobs, NativeJobError, "
                     "NativeJobCancelled, NativeJobDetached\n")
    if text.count(native_import) != 1:
        raise ValueError("The retained native import needs its current operator path join")
    if operator_path in text and text.index(operator_path) < text.index(native_import):
        return text
    import_block = "# " + MARKER + "\n" + native_import
    if text.count(import_block) != 1:
        raise ValueError("The retained native import has no exact authored registration")
    return replace_one(text, import_block, operator_path + import_block,
                       "retained native import ordering")


def server_patch(text, *, retention=False):
    text = builtin_route_patch(text)
    if "# " + MARKER in text:
        required = ("self.native_jobs = NativeJobs(self)",
                    '"/api/native-job"', "jobs.mjs", "NativeJobCancelled")
        if any(token not in text for token in required):
            raise ValueError("A partial native supervision registration needs its current source join")
        previous = '            final_state = "cancelled" if isinstance(error, NativeJobCancelled) else "failed"\n'
        if previous in text:
            text = replace_one(text, previous, DETACH_DISPOSITION, "native graceful detach")
        elif DETACH_DISPOSITION not in text:
            raise ValueError("The current native task disposition needs its graceful-detach join")
        if "from native_jobs import NativeJobs, NativeJobError, NativeJobCancelled\n" in text:
            text = replace_one(text,
                "from native_jobs import NativeJobs, NativeJobError, NativeJobCancelled\n",
                "from native_jobs import NativeJobs, NativeJobError, NativeJobCancelled, NativeJobDetached\n",
                "native detach import")
        if "NativeJobDetached" not in text.split("def summary_error", 1)[0]:
            raise ValueError("The current native supervisor import needs its detach type")
        text = native_import_patch(text)
        text = native_dispatch(text, retention=retention)
        return programme_server_patch(text)
    import_anchor = "from model import portable\n"
    operator_path = "sys.path.insert(0, str(Path(__file__).resolve().parent))\n"
    if import_anchor + operator_path in text:
        import_anchor += operator_path
        path_setup = ""
    else:
        path_setup = operator_path
    text = replace_one(text, import_anchor,
        import_anchor + path_setup + "# " + MARKER +
        "\nfrom native_jobs import NativeJobs, NativeJobError, NativeJobCancelled, NativeJobDetached\n", "native import")
    text = replace_one(text, "def summary_error(error):\n",
        "def summary_error(error):\n    if isinstance(error, NativeJobError):\n        return {\"code\": error.code, \"message\": str(error)}, error.status\n", "native error classification")
    text = replace_one(text, "        self.closing = False\n",
        "        self.closing = False\n        self.native_jobs = NativeJobs(self)\n", "native supervisor")
    text = replace_one(text,
        "    def cancel(self, key):\n        with self.lock:\n            task = self.task(key)\n",
        "    def cancel(self, key):\n        with self.lock:\n            task = self.task(key)\n"
        "            if task[\"action\"] == \"run.start\" and task[\"state\"] != \"queued\":\n"
        "                return self.native_jobs.request_stop(task)\n", "native stop")
    text = replace_one(text,
        '            task.update(state="failed", error=detail, ended_at=now())\n'
        '            attempt.update(state="failed", error=detail, ended_at=task["ended_at"])\n',
        DETACH_DISPOSITION +
        '            task.update(state=final_state, error=detail, ended_at=now())\n'
        '            attempt.update(state=final_state, error=detail, ended_at=task["ended_at"])\n', "native task disposition")
    text = native_dispatch(text, retention=retention)
    text = replace_one(text,
        '    def task_view(self, key):\n        task = self.task(key)\n',
        '    def task_view(self, key):\n        task = self.task(key)\n'
        '        if task["action"] == "run.start":\n            task["_native_job"] = self.native_jobs.snapshot(task)\n', "native task view")
    text = replace_one(text,
        '                if url.path == "/api/task":\n',
        '                if url.path == "/api/native-job":\n'
        '                    return self.send_json(200, self.app.native_jobs.view(one("id"), workspace,\n'
        '                        stream=one("stream", "native"), offset=one("offset", "0")))\n'
        '                if url.path == "/api/task":\n', "native console route")
    # Current shared host unions the original asset set with registered assets.
    # Modify only that original literal, retaining the current registry expression.
    asset_sets = []
    for node in ast.walk(ast.parse(text)):
        if (not isinstance(node, ast.Compare) or not isinstance(node.left, ast.Name)
                or node.left.id != "selected" or len(node.ops) != 1
                or not isinstance(node.ops[0], ast.NotIn) or len(node.comparators) != 1):
            continue
        candidate = node.comparators[0]
        while isinstance(candidate, ast.BinOp) and isinstance(candidate.op, ast.BitOr):
            candidate = candidate.left
        if isinstance(candidate, ast.Set):
            names = ast.literal_eval(candidate)
            if {"app.mjs", "index.html"} <= names:
                asset_sets.append((candidate, names))
    if len(asset_sets) != 1:
        raise ValueError("The current static asset registry needs a joined native console registration")
    node, names = asset_sets[0]
    segment = ast.get_source_segment(text, node)
    registered = "{" + ", ".join(repr(name) for name in sorted(names | {"jobs.mjs", "jobs.css"})) + "}"
    text = replace_one(text, segment, registered, "native console asset registry")
    return programme_server_patch(text)


def browser_patch(text):
    if "// " + MARKER in text:
        if "nativeJobs.taskActions(row)" not in text or "nativeJobs.dispatch(button)" not in text:
            raise ValueError("A partial native console registration needs its current source join")
        return text
    text = "// " + MARKER + "\nimport {attachNativeJobs} from './jobs.mjs';\n" + text
    text = replace_one(text, "function toast(message){",
        "const nativeJobs=attachNativeJobs({api,endpoint,detail,refresh,getWorkspace:()=>workspace,"
        "getDetailContext:()=>detailContext,openItem,toast,getState:()=>state});\nfunction toast(message){", "native console attachment")
    text = replace_one(text, "customerReviews.taskActions(row)+",
        "nativeJobs.taskActions(row)+customerReviews.taskActions(row)+", "native task console")
    text = replace_one(text, "  }else if(kind==='comparisons'){\n",
        "    content+=nativeJobs.runActions(row);\n  }else if(kind==='comparisons'){\n", "native run console")
    text = replace_one(text, " const action=button.dataset.action,id=button.dataset.id;\n",
        " const action=button.dataset.action,id=button.dataset.id;\n"
        " if(action?.startsWith('native-job-'))return nativeJobs.dispatch(button);\n", "native browser dispatch")
    text = replace_one(text,
        "async function selectWorkspace(id){\n",
        "async function selectWorkspace(id){\n nativeJobs.detach();\n", "native workspace change")
    return text


def portable_patch(text):
    """Retain current installers and the original root retention package."""
    for variable, additions in (
            ("APPLICATION_FILES", ("install_native_supervision.py", "install_extensions.py")),
            ("APPLICATION_DIRECTORIES", ("ecsa_runs",))):
        tree = ast.parse(text)
        entries = [node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == variable
                           for target in node.targets)]
        if len(entries) != 1:
            raise ValueError("The current portable application inventory needs its " + variable + " join")
        node = entries[0].value
        names = ast.literal_eval(node)
        if not isinstance(names, (list, tuple)) or not all(isinstance(name, str) for name in names):
            raise ValueError("The current portable inventory must retain its exact names")
        updated = list(names)
        for name in additions:
            if name not in updated:
                updated.append(name)
        if list(names) == updated:
            continue
        segment = ast.get_source_segment(text, node)
        if not segment:
            raise ValueError("The original portable inventory has no source segment")
        replacement = repr(tuple(updated) if isinstance(names, tuple) else updated)
        text = replace_one(text, segment, replacement, "portable application closure")
    ast.parse(text)
    return text


def atomic_write(path, body, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".native-install-", delete=False) as out:
            pending = Path(out.name)
            os.fchmod(out.fileno(), mode)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
        pending = None
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending:
            pending.unlink(missing_ok=True)


PARAMETER_QUERY_KEYS = (
    "id", "baseline_run_id", "area_id", "pollutant", "offset", "limit",
    "candidate_run_ids", "run_id", "attempt_id", "stream", "log_offset",
    "expected_attempt_id", "history_offset", "range_offset", "range_limit",
    "expected_artifact_sha256", "case_filter", "query",
)


def parameter_result_server_patch(source):
    """Compose current query fields and assets without narrowing peer routes."""
    tree = ast.parse(source, filename="operator/server.py")
    calls = [node for node in ast.walk(tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
             and node.func.attr == "read" and isinstance(node.func.value, ast.Attribute)
             and node.func.value.attr == "parameter_studies"]
    if len(calls) != 1 or len(calls[0].args) < 3:
        raise ValueError("Parameter results: expected one maintained native read dispatcher.")
    query = calls[0].args[2]
    retained = {node.value for node in ast.walk(query)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    missing = [name for name in PARAMETER_QUERY_KEYS if name not in retained]
    if missing:
        # AST column positions are UTF-8 bytes. Preserve any preceding Unicode
        # and every unknown peer query field exactly.
        raw = source.encode("utf-8")
        lines = raw.splitlines(keepends=True)
        start = sum(map(len, lines[:query.lineno - 1])) + query.col_offset
        end = sum(map(len, lines[:query.end_lineno - 1])) + query.end_col_offset
        original = raw[start:end].decode("utf-8")
        fields = ", ".join(json.dumps(name) + ": one(" + json.dumps(name) + ")"
                           for name in missing)
        replacement = "(" + original + " | {" + fields + "})"
        source = (raw[:start] + replacement.encode("utf-8") + raw[end:]).decode("utf-8")
    matches = list(re.finditer(r"if selected not in (\(*)(\{[^}\n]+\})([^:\n]*):", source))
    if len(matches) != 1:
        raise ValueError("Parameter results: expected the maintained static asset registry.")
    match = matches[0]
    members = ast.literal_eval(match.group(2))
    if not isinstance(members, set) or not all(isinstance(item, str) for item in members):
        raise ValueError("Parameter results: expected the original literal asset set.")
    required_assets = {"parameter_case_console.mjs", "parameter_studies.mjs", "parameter_studies.css"}
    if not required_assets <= members:
        members.update(required_assets)
        literal = "{" + ", ".join(json.dumps(item) for item in sorted(members)) + "}"
        source = (source[:match.start(2)] + literal + source[match.end(2):])
    ast.parse(source, filename="operator/server.py")
    return source


def parameter_study_dependency(body):
    """Keep the installed scientific engine and check the adapter's new API."""
    tree = ast.parse(body.decode("utf-8"))
    declarations = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    for name, arguments in (
            ("native_case_context", ("workspace", "key", "run_id")),
            ("record_interruption", ("workspace", "key", "error")),
            ("_read", ("workspace", "key")),
            ("_bind_state", ("workspace", "key", "spec", "state")),
            ("_baseline_versions", ("run",))):
        node = declarations.get(name)
        if node is None:
            raise ValueError("Receive the current complete saved-study source before native supervision: "
                             "model/parameter_studies.py lacks " + name)
        args = node.args
        positional = [*args.posonlyargs, *args.args]
        names = tuple(item.arg for item in positional)
        required = len(positional) - len(args.defaults)
        if (names[:len(arguments)] != arguments or required > len(arguments)
                or any(value is None for value in args.kw_defaults)):
            raise ValueError("Compose the current saved-study adapter with its scientific API: " + name)
    return {"bytes": len(body), "sha256": sha(body),
            "functions": ["native_case_context", "record_interruption", "_read", "_bind_state",
                          "_baseline_versions"],
            "policy": "retain installed scientific source unchanged"}



def retained_reader_dependencies(application):
    """Validate and retain scientific/context modules used by the incoming readers."""
    required = {
        "model/common.py": ("canonical", "digest", "held", "identifier", "relative_file",
                            "read_json", "file_digest"),
        "model/model_selection.py": ("selected", "run_models", "validate_completed_run"),
        "model/native_versions.py": ("model_versions", "version_label"),
        "model/parameter_calibration.py": ("candidates",),
    }
    bodies, records = {}, {}
    for name, symbols in required.items():
        path = application / name
        if not path.is_file():
            raise ValueError("Receive the complete current saved-study application first; missing " + name)
        body = path.read_bytes()
        tree = ast.parse(body.decode("utf-8"), filename=name)
        declarations = {node.name for node in tree.body
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        missing = set(symbols) - declarations
        if missing:
            raise ValueError("Retained Parameter reader needs current " + name + ": " +
                             ", ".join(sorted(missing)))
        bodies[name] = body
        records[name] = {"bytes": len(body), "sha256": sha(body),
                         "functions": list(symbols),
                         "policy": "retain installed scientific/context source unchanged"}
    return bodies, records

def install(application, increment, *, retention=False):
    application, increment = Path(application).resolve(strict=True), Path(increment).resolve(strict=True)
    originals = {name: (application / name).read_bytes()
                 for name in ("operator/server.py", "operator/web/app.mjs", "model/portable.py")}
    dependency = "model/parameter_studies.py"
    originals[dependency] = (application / dependency).read_bytes()
    retained_dependencies = {dependency: parameter_study_dependency(originals[dependency])}
    reader_bodies, reader_records = retained_reader_dependencies(application)
    originals.update(reader_bodies)
    retained_dependencies.update(reader_records)
    changed = {
        "operator/server.py": parameter_result_server_patch(server_patch(
            originals["operator/server.py"].decode("utf-8"), retention=retention)).encode("utf-8"),
        "operator/web/app.mjs": browser_patch(originals["operator/web/app.mjs"].decode("utf-8")).encode("utf-8"),
        "model/portable.py": portable_patch(originals["model/portable.py"].decode("utf-8")).encode("utf-8")}
    programme_path = application / "operator/programmes.py"
    if programme_path.exists():
        originals["operator/programmes.py"] = programme_path.read_bytes()
        changed["operator/programmes.py"] = programme_patch(
            originals["operator/programmes.py"].decode("utf-8")).encode("utf-8")
    for name in MEMBERS:
        body = (increment / name).read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"))
        destination = application / name
        if destination.exists():
            current = destination.read_bytes()
            if current != body and sha(current) not in PREVIOUS.get(name, []):
                raise ValueError("An authored native supervision member already exists; compose its source: " + name)
            originals[name] = current
        changed[name] = body
    edition = sha(json.dumps({name: sha(body) for name, body in sorted(changed.items())},
                                      sort_keys=True).encode())
    backup = application / ".native-supervision-preimages" / edition
    backup.mkdir(parents=True, exist_ok=True)
    for name, body in originals.items():
        if not (backup / name).exists():
            atomic_write(backup / name, body)
    for name, body in originals.items():
        if (application / name).read_bytes() != body:
            raise ValueError("Concurrent source changed before native supervision installation: " + name)
    # Install additive modules first, then the narrow current-source registration.
    ordered = [*MEMBERS, "operator/server.py", "operator/web/app.mjs", "model/portable.py"]
    if "operator/programmes.py" in changed:
        ordered.append("operator/programmes.py")
    for name in ordered:
        destination = application / name
        if name in originals:
            if not destination.exists() or destination.read_bytes() != originals[name]:
                raise ValueError("Concurrent source changed during native supervision installation: " + name)
        elif destination.exists():
            raise ValueError("Concurrent source appeared during native supervision installation: " + name)
        mode = destination.stat().st_mode & 0o777 if destination.exists() else 0o644
        if not destination.exists() or destination.read_bytes() != changed[name]:
            atomic_write(destination, changed[name], mode)
    for dependency in retained_dependencies:
        if (application / dependency).read_bytes() != originals[dependency]:
            raise ValueError("The retained scientific/context source changed during native supervision installation: " + dependency)
    receipt = {"schema": "upstate.native-supervision-install/v1", "operation_id": MARKER,
               "installed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "edition": edition,
               "preimages": {name: sha(body) for name, body in originals.items()},
               "retained_dependencies": retained_dependencies,
               "files": {name: {"bytes": len(body), "sha256": sha(body)} for name, body in changed.items()}}
    if not (backup / "installation.json").exists():
        atomic_write(backup / "installation.json", (json.dumps(receipt, indent=2) + "\n").encode())
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--increment", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--retention", action="store_true",
                        help="Compose the installed original ecsa_runs retention around native supervision")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.increment, retention=args.retention), indent=2))


if __name__ == "__main__":
    main()
