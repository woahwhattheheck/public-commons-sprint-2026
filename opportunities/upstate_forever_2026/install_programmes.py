#!/usr/bin/env python3
"""Install native programme controls into an existing Upper Savannah application.

Use the complete source package as --source-root. Changes are additive and
shared registrations are composed from current source, preserving other modules.
"""
from __future__ import annotations

import argparse
import ast
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

FILES = (
    "model/compute_programme.py",
    "model/compute_programme_cli.py",
    "model/programme_experiments.py",
    "model/programme_interactions.py",
    "model/programme_case_status.py",
    "model/programme_views.py",
    "model/record_catalog.py",
    "model/delivery_catalogue.py",
    "docs/PROGRAMME_LARGE_DESIGNS.md",
    "model/parameter_case_status.py",
    "docs/PROGRAMME_CASE_CONSOLE.md",
    "docs/PARAMETER_CASE_CONSOLE.md",
    "model/PAIR_COMPLETION.md",
    "source_tools/receive_gura.py",
    "source_tools/gura_workflow.py",
    "source_tools/gura_comparison.py",
    "source_tools/GURA_COMPARISON.md",
    "GURA_NATIVE_WORKFLOW.md",
    "source/gura-original-tables-3.20/NDR/biophysical_table_gura.csv",
    "source/gura-original-tables-3.20/SDR/biophysical_table_Gura.csv",
    "source/gura-original-tables-3.20/source.json",
    "operator/programmes.py",
    "operator/web/programmes.mjs",
    "operator/web/parameter_case_console.mjs",
    "operator/web/programmes.css",
    "PROGRAMMES.md",
)


PREVIOUS_EDITIONS ={
  "model/compute_programme.py": [
    "0d676a655f42427749a835706d139ce287bc8ea8f138970413652b6938a93e03",
    "f3ffdf5ed39aa827e83ed67b73fabad894f6219e46509e18da8f5a7c88512bce",
    "b118d793dc2b2cc2de8ea0016ccb8b0e0e18af422a1f154e8dd822801c6387c1",
    "c4327d021354b53a12f39ce9bca2d84442b997cb6b45a69e912593a186d497e5",
    "d9391e2f83a0b10ca5bc77560730780d2d318077f0dad19020ec4ff6c199e0f1",
    "efdf95c8c2f31b1a0b288b10c80a8e33f57ee06639535d8165c92cda5df068bf",
    "5df48145fc5b05a4a2468fe938c2eddd5c4bd508c6407e6e95cd3cc616969f37",
    "1b01e49baeb0463b7dd194a39979b81bc47785c735c63cefea71c2a5d699753e",
    "7bfaac9fd416a503441038a4716db4b75d2cf8c71db88c4417055c2c686ae4a1"
  ],
  "model/compute_programme_cli.py": [
    "2021af6d59f3a9f94849da50cbcd58eac987f9cbae52964582d1d090c461ff96",
    "268ea8468e60e13b81b6f2236df7cdcf8dae35a3767751e5168bd94e5dee3518",
    "a49c784ccfb96497780444f8259db5743b446c4568c5c143e010b200d1f5b7ea",
    "29437b34d83c871f652b7d5300f50c0aa46a144671013aabc877366068f93551",
    "634894886f680f1762a7885bf6de9233edad4d15a2159bcdd41506e8698f0f29"
  ],
  "operator/programmes.py": [
    "67c0c1697b44f81763e21dbf3dd62e258886247707f72a408d2b6ecbf6a10a61",
    "2cf9f3748debb8c78b272141ea2da4f02193ebe279a41b5a02ad1af0c6a56bd7",
    "d3d0b5e2a9fb774de81e61541c0b6420f58c766613e925d1e3ac566b293075d4",
    "0741c15a214d01880a35bc1ff62198b36af20dcabe3e2fba321ef0bfb53e8aef",
    "431a783614df0b72d3c25a3896f520ed69fbd421c172046d2a6b0b2480ccd94e",
    "ad3ed6b0da026423fe1a42444306ebf2aa90474ab6e34a429d18360d45244656",
    "2e78ffe05f0df088339c32a2c3c1122a4e121b4e7c6d374752a835eec56863f9"
  ],
  "operator/web/programmes.mjs": [
    "0a334cf55eaa95a7c0347ad605adea170261495b3042fc33b6b051fbaad9d2d4",
    "6bfb24faecccc34da3668c77234d871c75fa68195d44d804ce78cd04b7b7d81a",
    "2e0438a63ee057ecef5bf36d14a9053701b98f83f09cea3a14a57dffa9432571",
    "5a3f6d32cc1de2a8a4dc86550684c240cb51be5dad675eb6d3c7fe6e96bb3f0d",
    "95f29be61a90fbcca671264b0c3fe849e3de0aec894c6e8438235e0aded1fe30",
    "2602a24040ffbf5e9bb45dfcc709114328899cd2acb865c613478cba0ba09443",
    "8f415ee9049807121bc842c27a0cbd465eb7702a747540f82a6c5fa52cd8d493",
    "14b71fd70d0050c9968b9a025287c65d7240146aae8c085817762c79f4d40f8b",
    "a68c80290257eed884503665ca47f6ebef5951a91a3667cb23d62dfc62ea6f3f",
    "fefe6f9b6adc7fe9e662ca0260a8a08a44217da16d57fa908893a8b1e37bdd9e"
  ],
  "operator/web/programmes.css": [
    "939dea3c338775175b137239acfbc7d4cd1e2daef58060af2ed73ea98c484bdf",
    "83cbf4f2d83088665f6719f8f687f5efdf7b7f15c30f5cbaf3364af6e2d68034"
  ],
  "install_programmes.py": [
    "168d26a1792c2f1ade350d92130279e2710c2c4d4790b2f1cdf911b1007b21f0",
    "d0def021491c12552834c3d2e3f85599d025dea5fc00bf14cde1df8fc3794508",
    "24610143bb5b2e13cbbc239153801cc5886332705ac9d27df3575783d77f1a06",
    "cdac9d9f0d358ef788e3707618bc2a8526a72d47bbb1e4a312374741946f3055",
    "d8348ad65bbd0cb08327af500b668fbb8072882c7d1d32863738df42b2ca2093",
    "36551ce83830be56451913df78f5d64dee428ffd30f97490d41ef7c55313109b",
    "8ddac4633d080a775ac6dd99136fd7e04ba52b6c9ad9e1aac9e58ce9ef4f30fb",
    "3c23eb8407888398fbb95370a2671d924817b7ed54223565c107244698a28b3e",
    "b6e086094c3246dc0d88bd8fac2ba643b92e64213e252c6d1ce14c0cbd47d99d"
  ],
  "PROGRAMMES.md": [
    "b0a9c33c09f4dddba47db5a677ddc135b5c4242630c255ab4c232d4f365a206f",
    "59c5602aac0a6d476610cea86f7481087b808f9dec67522e5b8e0da11d2090be",
    "8820d98e4c7b02ab587fae65cb9e36010ef2cc24b1ce7b1978d1de08a80a44f8",
    "4f21691ce7d25e64e6bfb76862d8ab8baa0a12474b37fbc56cef5c894f8e6793"
  ],
  "model/programme_experiments.py": [
    "f5ba6fc94f46102065aa084f5314a5ac660d31a3eff927549e99f71b831a17cc",
    "ecba938e891af641a245e1c453c22a9a6d257e7b85d70c3b5d495999fead972d"
  ],
  "source_tools/receive_gura.py": [
    "4282b6f65b59c97a94b7f6528615c17a48741a378f42e41db2397d7395e3ed5b",
    "474e2dee21f878bac64c4cd513fdc5898ce8cc771aa027e74fd71388a662ecdc"
  ],
  "source/gura-original-tables-3.20/NDR/biophysical_table_gura.csv": [
    "e3f503cb1c82fb1035225eb68eb84303de8de7842b1bda6e94f4754fe538c42c"
  ],
  "source/gura-original-tables-3.20/SDR/biophysical_table_Gura.csv": [
    "b27b1549a41c4929f161e3b18962d6bc8627c10ed7ed27e504203c175a0f5f69"
  ],
  "source/gura-original-tables-3.20/source.json": [
    "40aba1995f45941b0391db17b94bceb36d6478b07339d2fb486644c3624e35d2"
  ],
  "model/PAIR_COMPLETION.md": [
    "95cbf57c338b0a83ff04bc2f353bf8ab323de6b080dfd2db128ee434de79237b"
  ],
  "source_tools/gura_workflow.py": [
    "9b5eff5099256c301ae09419d7a8f1ef83c81a3b89256340630649f6b6c49af2",
    "b96e4c9a66c1d32ba54bbb290a48cd7866f000bc3f12f23c007a45417f48b97f",
    "26eaf937a2a54ebcf3bc2170ccdc18f14fc3867c180133487f0f64ee2cf3adc0"
  ],
  "source_tools/gura_comparison.py": [
    "1df9249eb00e096d58cd7f63a24a7beaab4be0a00f8eb6aca000c275237feeb4",
    "13f15c6c55eec76ccb3ccee918c4e4aa131ad8153b959e9dcbec558b99b04423",
    "27b3c2a6e03459e67dafb2d8bba6555d5f433a18e3304bb40d74c38fe8dc0af4"
  ],
  "source_tools/GURA_COMPARISON.md": [
    "096a9093940fbf14736421f167c875a3ed91d02c66d0b10d5330962dfdeb445c",
    "29dea0a2c7634aa325337960a0fac7bd6ad663a54cb0cca65310b729d5927c68"
  ],
  "GURA_NATIVE_WORKFLOW.md": [
    "3cc684db0f9ff7f4ef17e56826fece82947225709c3543c43e0136d2a1cc41a9",
    "29e08e1ccd4c23d8d9df986ecfebdc7474bb4f76dc48f11f4958e0e74bf12637",
    "36844187971332a94ef0858ead1305880710b3126b4d9afcf09dc3f0185c99e8"
  ],
  "model/parameter_case_status.py": [
    "6152010782ea3163137c1282633ae270ef9376b73ec07f70a8c08736a6f5d7a8",
    "f5ce7d3de05e3e2d5e55453db619bc6c0988f8a168446ad38da9d92725ab253c"
  ],
  "operator/web/parameter_case_console.mjs": [
    "3d9ea07a81a91ac62780eeacd8fab29b622dc9692b1b98346266158a79508834",
    "d3245562620abb46d69a7c76a46d27b63d8005ccf26d80eabe08ad2f57190638"
  ]
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def add(source, anchor, addition, label, *, after=True):
    if addition in source:
        return source
    if source.count(anchor) != 1:
        raise ValueError(label + ": current source needs one compatible registration anchor; found " + str(source.count(anchor)))
    return source.replace(anchor, anchor + addition if after else addition + anchor, 1)


def replace(source, old, new, label):
    if new in source:
        return source
    if source.count(old) != 1:
        raise ValueError(label + ": current source needs one compatible registration anchor; found " + str(source.count(old)))
    return source.replace(old, new, 1)


CONSOLE_QUERY_KEYS = (
    "programme_id", "include_sources", "run_id", "attempt_id", "stream",
    "log_offset", "expected_attempt_id", "history_offset", "limit",
    "offset", "case_filter", "query",
)


def patch_case_console(source):
    """Compose current query fields and assets without narrowing peer routes."""
    tree = ast.parse(source, filename="operator/server.py")
    calls = [node for node in ast.walk(tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
             and node.func.attr == "read" and isinstance(node.func.value, ast.Attribute)
             and node.func.value.attr == "programmes"]
    if len(calls) != 1 or len(calls[0].args) < 3:
        raise ValueError("Programme console: expected one maintained native read dispatcher.")
    query = calls[0].args[2]
    retained = {node.value for node in ast.walk(query)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    missing = [name for name in CONSOLE_QUERY_KEYS if name not in retained]
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
        raise ValueError("Programme console: expected the maintained static asset registry.")
    match = matches[0]
    members = ast.literal_eval(match.group(2))
    if not isinstance(members, set) or not all(isinstance(item, str) for item in members):
        raise ValueError("Programme console: expected the original literal asset set.")
    if "parameter_case_console.mjs" not in members:
        members.add("parameter_case_console.mjs")
        literal = "{" + ", ".join(json.dumps(item) for item in sorted(members)) + "}"
        source = (source[:match.start(2)] + literal + source[match.end(2):])
    ast.parse(source, filename="operator/server.py")
    return source


def check_console_dependencies(application):
    """Use the current original native readers; do not replace their engines."""
    required = {
        "model/native_execution.py": ("inspect_execution",),
        "model/native_worker.py": ("identity_matches",),
        "model/parameter_studies.py": ("_read", "native_case_context"),
    }
    for name, symbols in required.items():
        path = application / name
        if not path.is_file():
            raise ValueError("Receive the complete current native application first; missing " + name)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=name)
        exported = {node.name for node in tree.body
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        missing = set(symbols) - exported
        if missing:
            raise ValueError("The retained-case console needs current " + name + ": " +
                             ", ".join(sorted(missing)) +
                             ". Receive the maintained native application before this extension.")


def patch_server(source):
    # Named-team editions classify these previews before workspace selection.
    # Keep their existing authorization and add only this read-only inspection.
    if "readonly = {" in source:
        matches = [match for match in re.finditer(r"readonly\s*=\s*\{[^}]*\}", source)
                   if '"/api/programmes/preview"' in match.group(0)]
        if len(matches) != 1:
            raise ValueError("Programme preview permissions: expected the maintained read-only route set.")
        match = matches[0]
        if '"/api/programmes/interaction-preview"' not in match.group(0):
            updated = match.group(0)[:-1] + ', "/api/programmes/interaction-preview"}'
            source = source[:match.start()] + updated + source[match.end():]
    # A received current operator already owns compact state, supervised native
    # jobs and task decorators. Compose the two read-only programme previews
    # without replaying older shared-state registrations over those services.
    installed = ("self.programmes = Programmes(self, Fault)",
                 "return self.programmes.invoke(task)",
                 "programme_reads[url.path]",
                 "from programmes import Programmes, ACTIONS as PROGRAMME_ACTIONS")
    if all(value in source for value in installed):
        source = add(source,
            '                return self.send_json(200, self.app.programmes.preview(value.get("workspace", self.app.primary), value))\n',
            '            if url.path == "/api/programmes/experiment-preview":\n'
            '                return self.send_json(200, self.app.programmes.experiment_preview(value.get("workspace", self.app.primary), value))\n',
            "saved experiment preview")
        source = add(source,
            '                return self.send_json(200, self.app.programmes.experiment_preview(value.get("workspace", self.app.primary), value))\n',
            '            if url.path == "/api/programmes/interaction-preview":\n'
            '                return self.send_json(200, self.app.programmes.interaction_preview(value.get("workspace", self.app.primary), value))\n',
            "saved conservation study preview")
        previous = '{"programme_id": one("programme_id")}))'
        updated = '{"programme_id": one("programme_id"), "include_sources": one("include_sources")}))'
        if previous in source:
            source = replace(source, previous, updated, "completed native source catalogue selection")
        if not all(value in source for value in ("programmes.mjs", "programmes.css", "ACTIONS.update(PROGRAMME_ACTIONS)")):
            raise ValueError("Complete the current programme asset and action registrations before adding study attribution.")
        ast.parse(source, filename="operator/server.py")
        return patch_case_console(source)
    source = add(source, "from model.spatial_exports import SpatialExports\n",
                 "from programmes import Programmes, ACTIONS as PROGRAMME_ACTIONS, READS as PROGRAMME_READS\n", "programme import")
    source = add(source, "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\n",
                 "ACTIONS.update(PROGRAMME_ACTIONS)\n", "programme action registry")
    source = add(source, "        self.customer_reviews = CustomerReviews(self, Fault)\n",
                 "        self.programmes = Programmes(self, Fault)\n", "programme operator")
    source = add(source, "        if action in CUSTOMER_REVIEW_ACTIONS:\n",
                 "        if action in PROGRAMME_ACTIONS:\n            return self.programmes.invoke(task)\n", "programme worker", after=False)
    # Maintained operator editions derive activity from current native runs and
    # locks. Keep that complete registration instead of reinstating a full
    # programme catalogue before every poll.
    activity_states = (
        '        state["compute_programmes"] = self.programme_activity.summaries(workspace, state["runs"])\n',
        '        state["compute_programmes"] = ProgrammeActivity(self, Fault).summaries(workspace, state["runs"])\n',
    )
    if not any(line in source for line in activity_states):
        source = add(source, "        state = ws.overview()\n",
                     '        state["compute_programmes"] = self.programmes.catalogue(workspace)["programmes"]\n',
                     "programme state")
    if "self.programmes.decorate_task(" not in source:
        source = replace(source, "        return self.customer_reviews.decorate_task(task)\n",
                         "        return self.programmes.decorate_task(self.customer_reviews.decorate_task(task))\n", "programme task view")
    if 'if url.path in programme_reads:' not in source:
        source = add(source, '                review_reads = {"/api/reviews/" + name: name for name in CUSTOMER_REVIEW_READS}\n',
                     '                programme_reads = {"/api/programmes/" + name: name for name in PROGRAMME_READS}\n'
                     '                if url.path in programme_reads:\n'
                     '                    return self.send_json(200, self.app.programmes.read(workspace, programme_reads[url.path],\n'
                     '                        {"programme_id": one("programme_id")}))\n',
                     "programme read routes", after=False)
    # Match each existing handler independently: experiment-preview and other
    # current routes may legitimately sit between these original handlers.
    for route, method in reversed((
            ("preview", "preview"), ("pause", "pause"),
            ("delivery-preview", "delivery_preview"))):
        addition = (
            f'            if url.path == "/api/programmes/{route}":\n'
            f'                return self.send_json(200, self.app.programmes.{method}'
            '(value.get("workspace", self.app.primary), value))\n')
        source = add(source, "            value = self.body()\n", addition,
                     "programme " + route + " route")
    source = add(source,
                 '                return self.send_json(200, self.app.programmes.preview(value.get("workspace", self.app.primary), value))\n',
                 '            if url.path == "/api/programmes/experiment-preview":\n'
                 '                return self.send_json(200, self.app.programmes.experiment_preview(value.get("workspace", self.app.primary), value))\n',
                 "saved experiment preview")
    source = add(source,
                 '                return self.send_json(200, self.app.programmes.experiment_preview(value.get("workspace", self.app.primary), value))\n',
                 '            if url.path == "/api/programmes/interaction-preview":\n'
                 '                return self.send_json(200, self.app.programmes.interaction_preview(value.get("workspace", self.app.primary), value))\n',
                 "saved conservation study preview")
    source = replace(source,
        'return self.send_json(200, self.app.programmes.read(workspace, programme_reads[url.path],\n                        {"programme_id": one("programme_id")}))',
        'return self.send_json(200, self.app.programmes.read(workspace, programme_reads[url.path],\n                        {"programme_id": one("programme_id"), "include_sources": one("include_sources")}))',
        "completed native source catalogue selection")
    matches = list(re.finditer(r"if selected not in (\(*)(\{[^}\n]+\})([^:\n]*):", source))
    if len(matches) != 1:
        raise ValueError("Static programme assets: current operator asset registry is ambiguous.")
    match = matches[0]
    members = ast.literal_eval(match.group(2))
    if not isinstance(members, set) or not all(isinstance(item, str) for item in members):
        raise ValueError("Static programme assets: expected the current literal file allowlist.")
    members.update({"programmes.mjs", "programmes.css"})
    literal = "{" + ", ".join(json.dumps(item) for item in sorted(members)) + "}"
    source = (source[:match.start()] + "if selected not in " + match.group(1) +
              literal + match.group(3) + ":" + source[match.end():])
    ast.parse(source, filename="operator/server.py")
    return patch_case_console(source)


def patch_app(source):
    if "const programmes=attachProgrammes(" in source and "programmes.dispatch(button)" in source:
        # Keep the maintained instance and its current host capabilities.
        return add(source, "const actionLabels={",
                   "'compute.programme.interaction':'Use conservation study',"
                   "'compute.programme.attach-interaction':'Attach conservation attribution',"
                   "'compute.programme.sync-interaction':'Reconcile conservation attribution',",
                   "conservation programme task labels")
    source = add(source, "import {attachCustomerReviews} from './reviews.mjs';\n",
                 "import {attachProgrammes} from './programmes.mjs';\n", "programme browser import")
    source = add(source, "const viewLabels={", "programmes:'Run programmes',", "programme view")
    source = add(source, "const actionLabels={",
                 "'compute.programme.save':'Save run programme','compute.programme.run':'Continue run programme',"
                 "'compute.programme.report':'Build result catalogue','compute.programme.delivery':'Build programme delivery',",
                 "programme action labels")
    source = add(source, "const actionLabels={",
                 "'compute.programme.pair-completion':'Prepare matching scenario baselines',",
                 "matched scenario continuation task label")
    source = add(source, "const actionLabels={",
                 "'compute.programme.experiment':'Use saved experiment',",
                 "saved experiment task label")
    source = add(source, "const actionLabels={",
                 "'compute.programme.interaction':'Use conservation study',"
                 "'compute.programme.attach-interaction':'Attach conservation attribution',"
                 "'compute.programme.sync-interaction':'Reconcile conservation attribution',",
                 "conservation programme task labels")
    source = add(source, "function toast(message){",
                 "const programmes=attachProgrammes({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,openItem,"
                 "refreshState:refresh,navigate,closeDetail:()=>{detailDialog.close();detailContext=null;}});\n",
                 "programme browser instance", after=False)
    spatial = list(re.finditer(r"if\(view==='spatial'\)\{[^\n]*", source))
    if len(spatial) != 1:
        raise ValueError("Programme spatial lifecycle: expected one maintained spatial view")
    if "programmes.detach();" not in spatial[0].group(0):
        start = spatial[0].start() + len("if(view==='spatial'){")
        source = source[:start] + "programmes.detach();" + source[start:]
    source = add(source, "  const d=state.data;let html='';\n",
                 "  if(view==='programmes'){community.detach();customerReviews.detach();programmes.mount($('#content'),state);return;}\n"
                 "  programmes.detach();\n", "programme view mount", after=False)
    source = add(source, "  $('#content').innerHTML=html;\n",
                 "  if(view==='runs'){const actions=$('.page-actions',$('#content'));if(actions)actions.insertAdjacentHTML('beforeend',button('programme-open','Run programmes'));}\n",
                 "programme native runs entry")
    if "programmes.taskActions(row)" not in source:
        source = replace(source, "customerReviews.taskActions(row)",
                         "programmes.taskActions(row)+customerReviews.taskActions(row)", "programme task opening")
    source = replace(source, "toast((actionLabels[task.action]||task.action)+' completed.')",
                     "toast(programmes.completionMessage(task)||(actionLabels[task.action]||task.action)+' completed.')", "programme completion label")
    if "spatialWorkspace.suspend();programmes.detach();" not in source:
        source = replace(source, " spatialWorkspace.suspend();community.detach();customerReviews.detach();workspace=id;",
                         " spatialWorkspace.suspend();programmes.detach();community.detach();customerReviews.detach();workspace=id;", "programme workspace switch")
    source = add(source, " const action=button.dataset.action,id=button.dataset.id;\n",
                 " if(action?.startsWith('programme-'))return programmes.dispatch(button);\n", "programme dispatch")
    return source


def patch_index(source):
    source = add(source, '<link rel="stylesheet" href="/web/reviews.css">\n',
               '<link rel="stylesheet" href="/web/programmes.css">\n', "programme stylesheet")
    return add(source, '<button data-view="runs">Native model runs</button>\n',
               '    <button data-view="programmes">Run programmes</button>\n', "programme navigation")


def run(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "model/native.py", "model/common.py", "model/profiles.py"):
        if not (application / name).is_file():
            raise ValueError("Receive the existing full application first; missing " + name)
    lock_root = application / ".locks"
    lock_root.mkdir(exist_ok=True)
    with (lock_root / "programme-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        check_console_dependencies(application)
        pending = {}
        original = {}
        for name in FILES:
            source_file = source_root / name
            data = source_file.read_bytes()
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            target = application / name
            before = target.read_bytes() if target.exists() else None
            if (before is not None and before != data
                    and sha(before) not in PREVIOUS_EDITIONS.get(name, ())):
                raise ValueError("Existing authored programme source differs: " + name +
                                 ". Reconcile this file before installing the selected edition.")
            original[name] = before
            pending[name] = data
        for name, patch in (
            ("operator/server.py", patch_server),
            ("operator/web/app.mjs", patch_app),
            ("operator/web/index.html", patch_index),
        ):
            before = (application / name).read_bytes()
            original[name] = before
            pending[name] = patch(before.decode("utf-8")).encode("utf-8")
        changed = [name for name, data in pending.items() if original[name] != data]
        receipt = {
            "schema": "upstate.programme-install/v1",
            "application": str(application), "source_root": str(source_root),
            "dry_run": dry_run, "changed": changed,
            "files": [{"path": name, "bytes": len(data), "sha256": sha(data),
                       "previous_sha256": sha(original[name]) if original[name] is not None else None}
                      for name, data in sorted(pending.items())],
            "opening_route": "/#programmes",
        }
        if dry_run:
            return receipt
        with tempfile.TemporaryDirectory(prefix=".upstate-programmes-", dir=application.parent) as scratch:
            staging = Path(scratch)
            for name in changed:
                file = staging / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(pending[name])
            # Compare the actual current source at each replacement boundary.
            for name in changed:
                target = application / name
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent source change preserved at " + name +
                                       "; reopen current source and rerun this same installation.")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Current complete Upper Savannah application directory")
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
