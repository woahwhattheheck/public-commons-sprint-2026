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
    "model/conservation_catalog.py",
    "operator/conservation_catalog.py",
    "operator/extensions/conservation-catalog.json",
    "operator/CONSERVATION_CATALOG.md",
    "model/CONSERVATION.md",
    "model/CONSERVATION_CONSUMERS.md",
    "model/CONSERVATION_EXPERIMENTS.md",
    "model/CONSERVATION_OPTIMIZATION.md",
    "model/KEOWEE_PRIORITIES.md",
    "model/conservation.py",
    "model/conservation_bindings.py",
    "model/conservation_cli.py",
    "model/conservation_optimization.py",
    "model/conservation_scenarios.py",
    "model/keowee_priority.py",
    "operator/CONSERVATION.md",
    "operator/CONSERVATION_OPTIMIZATION.md",
    "operator/conservation.py",
    "operator/conservation_browser_receiving.py",
    "operator/conservation_experiment_browser_receiving.py",
    "operator/CONSERVATION_EXPERIMENT_BROWSER.md",
    "operator/conservation_optimization.py",
    "operator/conservation_regional_receiving.py",
    "operator/extensions/conservation-optimization.json",
    "operator/install_conservation.py",
    "operator/web/conservation.css",
    "operator/web/conservation.mjs",
    "source/keowee-priority-integration-20261013.json",
    "source/keowee-priority-methods-20261013.json",
    "source/parcel-criteria-integration-20261013.json",
    "source/parcel-criteria-sources-20261013.json",
    "source_tools/PARCEL_CRITERIA.md",
    "source_tools/parcel_criteria.py",
    "source_tools/receive_drive_source.py",
})
SCHEMA = "upstate.conservation-addon/v1"
# Previously published E7A1 source editions that can be upgraded directly.
# Other authored edits stay available for explicit composition.
PREVIOUS_SOURCES = {
    "model/conservation.py": {
        "d407c94dd3df29ef7de6e5d8396f3a048619df0529f88dfb4e1fb4176ef72c12": 81874,
        "099cdbb19f03560e6cf8214605a3d2212afdc5221e8f192eab46f74ed54065ca": 88457,
        "8755fb5f3b9e7870868db8f3c5345030b117259340918e14250c85ea5d4c67f3": 89137,
        "60b7d500a585f685886404ac23785416c6fafb0a733550169258a90413ce3464": 91061
    },
    "model/conservation_cli.py": {
        "1ead9b863bcd772e0845c7603465a24cc5eeb95a877730ccc6f9c4344310c8ed": 3722
    },
    "model/conservation_scenarios.py": {
        "7d219c37ccd94094bf1e3355433ed12499a5aec389220cc7608d76140643ae6d": 10383,
        "d3518493716250749bb16804e1e8699ffa8d52da96b9c082c4dd9437ea5dbb2a": 11455,
        "a6c5f1f98bae9e4b9add1a013a10801a9e8bb9771d35c24418f455f5c219ac91": 30659
    },
    "model/CONSERVATION.md": {
        "5114f307d8640188ad45d09c61e32ee564f94e77f5171c81951f83dc85736c81": 9930,
        "4d51f59276d6585e817d43f44dd80c6aaeed3e15cc6cf149e9cc2b3d0d90cd87": 12685,
        "c46d49b9d9ec84e16be050679546a11edeea6f0f5862b21544e6313e4fca7930": 12197
    },
    "operator/conservation.py": {
        "530d230e20704b058ffc50cebea6cab01b2af42f94d1a472de2482ce95ada0a4": 8663,
        "ba2975b292cbad34536b0f2128a76920c8cfe4e528565cf9575b618720864eda": 8494,
        "4162a1f93e8ec39960482db85a045a0f5ef0437f7e04a8963ce9348ca6ce22db": 8673,
        "454b71b56f7eec4c0c175cb23a597ad32b6f053858692a8dcae92ea97aa4df2e": 9666,
        "9c38b58b730209ab72daa3096bc8d7b98c776429ac4ad4249f04abe45c3dc301": 10378
    },
    "operator/web/conservation.mjs": {
        "7857010fbb286a33bde354715d067ee649304f51ce86b4c642a1bcd34f400c65": 67285,
        "52e834dd9675a64b57260274a358635f1c8fa25510232207e10d0885629ef25e": 65147,
        "ec645237ca3d8321a07e42479ce2af32c960c8b3c28113b11ac23547e16be808": 72380,
        "e18f46038591553b4ae8e0c10f1c449f97d227a5a50170add0d2b7195ad2879b": 75848,
        "1ca5e8e1d45767f96c1814d2384150f4c49594c4ddae070451a230956bcc6e75": 100418,
        "ee9d18d1233af1fc2e9a4d6ba84134feaac9e84497c77a83da582cb92da6b710": 108252
    },
    "operator/web/conservation.css": {
        "9eddc5584dfe6ae93c6e6a779af56ba9604b63757084cb1cd81bdca99617eb13": 7848,
        "625e039cf970763d80ef94a1d8e0d155a28e80249de93fa8fc410e26b90351e5": 7705,
        "fa8bfb6ec628f1ea618d8378b5964f8a32e12ec6cb4a2dbc6d945db3de098555": 7946,
        "8ac5b887081ce108c0a5f1aaa69313240d7c2a6bc9d738ed479a2f766e4b7654": 8425,
        "82f69e6bcf264ac5c49e5eb61b6490cbac89419eabf9877b3c3332415785cad5": 8507
    },
    "operator/CONSERVATION.md": {
        "f01c3d65fbfaea80a60299cee4058d231d1265ff68a19198519abc8240d676cc": 11327,
        "c109ce231393d18f149b5f2bfc5faaec56948d1efda26ddc1c5a3144c1b5b231": 13676,
        "793620676d53702da2447fc0fa47f02f767c0b2b958152395db523b9683d7a12": 18294,
        "d39ab0132a9c32639883943994ece1c7819ae23b73d13c5957af6211d904c277": 22899
    },
    "operator/install_conservation.py": {
        "fac4eb6c7c8b7b27d1a2cbbc13fbee8d2e2ad682d1ba5fcda0126b7676255ae1": 32051,
        "d8e9824780d84641a9ee47d180158adc18e340dff1912945fc75bce78237893f": 31581,
        "30492615ba6f862f7f676183ee293eb0252a59a159830e9976875aa2ab450bda": 20002,
        "76e556f53783d6379a53a775651415541306d9b23ba80d4eec1ff2dfb22a3644": 30753,
        "c9aaa958816139e151fd99cc194deac931186783563738119e7b4ae69a413696": 17382,
        "b7250a44731d3f421a6779e7c236d132e6b446166c8eaab5d34523a8553957b0": 19888,
        "833aed492f04532201544e5f959ca852fe730d79969a6bc009a754f0f14dc42d": 22965,
        "1fde2cd0fd7c7960a99e7757e7724cce43ff5835a48dbab2eaa30092ffa2b37a": 20992,
        "172c2cac2e9933bc5088993e55218597776010e1c6d5c31307e7c24d6c05849a": 21551
    },
    "operator/conservation_regional_receiving.py": {
        "fc6bb0b216927c04c4cf1f665c237e397f997260de6f6457a192d987eb5d0276": 43910,
        "a4326a019784fdb0bd03aa071ee5f01e40694d3063d0a8b6da70caed5ce9daf7": 26367,
        "6db8fe4ab19613472c9e671669c66d4381d1f982b011d7bd6ce314cd0e069b5c": 20028,
        "a450c334ce4bded570acf1584d9623a00f60fa997049015256d0b4b7d830bae1": 29344
    },
    "model/conservation_bindings.py": {
        "882f401903cc02250d8210f6a116fd3dfc27995980f50aeef5c150449a814354": 34965,
        "e3b3a7288817d408b9e685afb4dac7c361d3ace444cf4e99419fe830a7cdd060": 36408
    },
    "model/CONSERVATION_CONSUMERS.md": {
        "0a42f6685d086ec9bca55e6e63d891058de5be5547a5bc4d116a2d2626358123": 16972,
        "aabd1f2ca24827c783d47da103ae55e130a2d22ae77688748848762ff4cd49d0": 16693
    },
    "operator/conservation_browser_receiving.py": {
        "92376677bdeeacdc5294a02ed89a9c9a463373b023bb6aa4ddcd170adc3e0c93": 17804,
        "8c95b46f72826e3d95f1bd79479a80e69146703b6c2088f319c1d0eb5a1d1cad": 19144
    },
    "source_tools/receive_drive_source.py": {
        "c6771e6d8d0ed681b162f49e0d30ebf6f8bd7412666bf128409e498d83bf1b3c": 8658
    },
    "model/keowee_priority.py": {
        "cb7c6f9aa1d193c594b9427cb80ddedc9a209924e4347f5759a54e51151341dd": 34855
    },
    "source/keowee-priority-methods-20261013.json": {
        "f6f0d496697b03cdd667407ff26f0377f1262df608b21f6a3ff059357c134ec5": 45833
    },
    "model/KEOWEE_PRIORITIES.md": {
        "4163651c9bbe009f22cd5cb6d065fbc89265d0daff9fa013e444c8b1781df45f": 32064
    },
    "source/keowee-priority-integration-20261013.json": {
        "36026ed1afb9f2e2de2cc50ee1b6ab0bdc965e324da023624e073ccc6c1dbcae": 9830
    },
    "model/CONSERVATION_EXPERIMENTS.md": {
        "b8859697162b7dd37e19c59fed4ab5abae8fc3e02e50a6e31e6faed9e28bd65d": 12071
    },
    "source_tools/parcel_criteria.py": {
        "07710f48afcf7e5725c058fe82498669110081144846a3555ed707ec839b9f41": 69645
    },
    "source/parcel-criteria-sources-20261013.json": {
        "4b2276fb7c976f08ac11d6d95a96af0ed806a914442deda5126c30916f3b57a0": 18204
    },
    "source_tools/PARCEL_CRITERIA.md": {
        "3c1b9b9c8df3452aa5d16969be10e0917978d80130d138d3df9220a073dc72c3": 22775
    },
    "source/parcel-criteria-integration-20261013.json": {
        "d11fc0238a4637af7432df34761d43bd3dd4f6abedcc72f81700dca6bf6b0da8": 7315
    },
    "operator/conservation_optimization.py": {
        "e987a181ac60463b725897c5321306871c4bc004d336b5468d57641e4b1bec63": 12222,
        "3f16dae23b8cfe5e928cd4f4670e6dfe514bb790dee7c029e7717e8588b8ad1b": 12287
    },
    "operator/extensions/conservation-optimization.json": {
        "744ecd44e96f32aea580f09fad04cecd0d203603d40443e98ad972bbe24712ce": 1841
    },
    "operator/CONSERVATION_OPTIMIZATION.md": {
        "0ce2dd533a1de760c342ba068b62fd6e0607deca4da2df64bb7f70eff52d99ec": 7842,
        "d397e3cb792b2de4b934a2e9e320861c89be28f63dde9b1b6c89791240707e0d": 8748
    }
}


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



# The complete application registers Conservation through retained_desks. Older
# bare applications still use the original direct adapter below.
REGISTERED_REPAIR = json.loads(r'''{"server_removals":["from conservation import Conservation, ACTIONS as CONSERVATION_ACTIONS, READS as CONSERVATION_READS\n","ACTIONS.update(CONSERVATION_ACTIONS)\n","        self.conservation = Conservation(self, Fault)\n","        if action in CONSERVATION_ACTIONS:\n            return self.conservation.invoke(task)\n","                conservation_reads = {\"/api/conservation/\" + name: name for name in CONSERVATION_READS}\n                if url.path in conservation_reads:\n                    return self.send_json(200, self.app.conservation.read(workspace,\n                        conservation_reads[url.path], {name: one(name) for name in (\"study_id\", \"plan_id\")}))\n"],"app_patterns":[["(?m)^import \\{attachConservation(?:WithOptimization)?\\} from '[^'\\n]+';\\n",""],["(?ms)^const conservation=attachConservation(?:WithOptimization)?\\(.*?\\);\\n",""],["(?ms)^  if\\(view==='conservation'\\)\\{\\n.*?conservation\\.mount\\(\\$\\('#content'\\),state\\);return;\\n  \\}\\n",""],["(?m)^[ \\t]*conservation\\.detach\\(\\);\\n",""],["(?m)^[ \\t]*if\\(typeof conservation!=='undefined'\\)conservation\\.detach\\(\\);\\n",""],["if\\(typeof conservation!=='undefined'\\)conservation\\.detach\\(\\);",""],["(?ms)^ if\\(button\\.dataset\\.action\\?\\.startsWith\\('conservation-'\\).*?return conservation\\.dispatch\\(button\\);\\n \\}\\n",""],["\\+conservation\\.taskActions\\(row\\)",""]],"registered_block":"  // Registered desks retain sole ownership of their controller and actions.\n  if(extensions.hasView(view)){\n    community.detach();customerReviews.detach();spatialWorkspace.suspend();\n    if(typeof programmes!=='undefined')programmes.detach();\n    if(typeof experiments!=='undefined')experiments.detach();\n    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();\n    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n    if(typeof rehearsal!=='undefined')rehearsal.detach();\n    if(typeof journey!=='undefined'){journey.detach();journey.updateRail(view);}\n    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();\n    extensions.render(view,$('#content'),state);return;\n  }"}''')


def registered_conservation(application):
    descriptor = application / "operator" / "extensions" / "conservation.json"
    if not descriptor.is_file():
        return False
    value = json.loads(descriptor.read_text(encoding="utf-8"))
    backend = value.get("backend", {})
    factory = backend.get("factory", {})
    expected = {
        "conservation.prepare", "conservation.build", "conservation.plan.save",
        "conservation.export", "conservation.scenario.create",
        "conservation.criteria.prepare", "conservation.experiment.prepare",
    }
    if (value.get("schema") != "upstate.operator-extension/v1"
            or value.get("id") != "conservation"
            or backend.get("module") != "conservation"
            or factory.get("name", factory.get("handler")) != "Conservation"
            or not expected.issubset(set(backend.get("actions", [])))
            or value.get("client", {}).get("view", {}).get("id") != "conservation"):
        raise ValueError("Preserve and compose the existing Conservation registration before installation")
    for asset in value.get("assets", []):
        if not isinstance(asset, str) or Path(asset).name != asset:
            raise ValueError("The Conservation descriptor must name original web assets")
        if not (application / "operator" / "web" / asset).is_file():
            raise ValueError("Receive the complete registered Conservation desk asset: " + asset)
    for name in ("operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / name).is_file():
            raise ValueError("Receive the existing registered operator host: " + name)
    return True


def patch_registered_server(text):
    for fragment in REGISTERED_REPAIR["server_removals"]:
        if text.count(fragment) > 1:
            raise ValueError("The current server has duplicated direct Conservation wiring")
        text = text.replace(fragment, "")
    # Preserve every other owner's nested task decorator.
    text = re.sub(r"(?m)^(\s*return )self\.conservation\.decorate_task\((.*)\)$",
                  lambda match: match.group(1) + match.group(2), text)
    if re.search(r"self\.conservation|CONSERVATION_ACTIONS|CONSERVATION_READS", text):
        raise ValueError("Compose the remaining direct Conservation server wiring before installation")
    if "self.extensions" not in text:
        raise ValueError("The registered Conservation desk requires its original extension host")
    ast.parse(text)
    return text


def patch_registered_app(text):
    for pattern, replacement in REGISTERED_REPAIR["app_patterns"]:
        text = re.sub(pattern, lambda match: replacement, text)
    branch = REGISTERED_REPAIR["registered_block"]
    if branch not in text:
        pattern = r"(?m)^  if\(extensions\.render\(view,\$\('#content'\),state\)\)\{[^\n]+\}\s*$"
        text, count = re.subn(pattern, lambda match: branch, text)
        if count != 1:
            raise ValueError("Expected the current registered desk render branch")
    if re.search(r"\bconservation\.(render|mount|detach|dispatch|taskActions)|const conservation=|import \{attachConservation", text):
        raise ValueError("Compose the remaining direct Conservation browser wiring before installation")
    return text


def patch_server(text, registered=False):
    if registered:
        return patch_registered_server(text)
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
    # Preserve the current extension-host union and either quote style.
    # Edit only the literal static set inside the original selected-file guard.
    static_sets = []
    for comparison in ast.walk(ast.parse(text)):
        if (not isinstance(comparison, ast.Compare)
                or not isinstance(comparison.left, ast.Name)
                or comparison.left.id != "selected"
                or len(comparison.ops) != 1
                or not isinstance(comparison.ops[0], ast.NotIn)):
            continue
        for node in ast.walk(comparison.comparators[0]):
            if isinstance(node, ast.Set) and any(
                    isinstance(item, ast.Constant) and item.value == "index.html"
                    for item in node.elts):
                static_sets.append(node)
    if len(static_sets) != 1:
        raise ValueError("Expected one current operator selected-file static set")
    target = static_sets[0]
    present = {item.value for item in target.elts if isinstance(item, ast.Constant)}
    missing_assets = [name for name in ("conservation.mjs", "conservation.css")
                      if name not in present]
    if missing_assets:
        literal = ast.get_source_segment(text, target)
        if literal is None or not literal.endswith("}"):
            raise ValueError("Cannot locate the current operator static set source")
        lines = text.splitlines(keepends=True)
        first = sum(len(line) for line in lines[:target.lineno - 1]) + target.col_offset
        last = sum(len(line) for line in lines[:target.end_lineno - 1]) + target.end_col_offset
        separator = " " if literal[:-1].rstrip().endswith(",") else ", "
        addition = separator + ", ".join(repr(name) for name in missing_assets)
        text = text[:first] + literal[:-1] + addition + "}" + text[last:]
    ast.parse(text)
    return text


def conservation_lifecycle(text):
    """Detach the current host's other desks before replacing their shared root."""
    opening = "  if(view==='conservation'){\n"
    start = text.find(opening)
    end = text.find("conservation.mount($('#content'),state)", start)
    if start < 0 or end < 0:
        raise ValueError("Expected the installed original Conservation render branch")
    current = text[start:end]
    lifecycle = (
        "    if(typeof extensions!=='undefined')extensions.detach();\n",
        "    if(typeof experiments!=='undefined')experiments.detach();\n",
        "    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();\n",
        "    if(typeof programmes!=='undefined')programmes.detach();\n",
        "    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n",
        "    if(typeof rehearsal!=='undefined')rehearsal.detach();\n",
        "    if(typeof journey!=='undefined'){journey.detach();journey.updateRail(view);}\n",
        "    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();\n",
    )
    addition = "".join(line for line in lifecycle if line.strip() not in current)
    position = start + len(opening)
    return text[:position] + addition + text[position:]


def patch_app(text, registered=False):
    if registered:
        return patch_registered_app(text)
    text = text.replace("for(const node of $('[data-view]'))",
                        "for(const node of $$('[data-view]'))")
    text = text.replace("parameter('sdr','l_max','Maximum slope length','Metres.','min=\"0\"')", "parameter('sdr','l_max','Maximum L factor','Dimensionless maximum for the LS slope-length factor.','min=\"0\"')")
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
    for action, label in (
        ("conservation.criteria.prepare", "Prepare original parcel criteria"),
        ("conservation.experiment.prepare", "Prepare paired conservation experiment"),
    ):
        if repr(action) + ":" not in text:
            text = once(text, "const actionLabels={",
                        "const actionLabels={" + repr(action) + ":" + repr(label) + ",",
                        "Conservation continuation operation label")
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
    text = conservation_lifecycle(text)
    text = once(text, "async function dispatch(button){\n",
                "async function dispatch(button){\n"
                " if(button.dataset.action?.startsWith('conservation-')){\n"
                "  if(['conservation-open-study','conservation-open-plan'].includes(button.dataset.action)){\n"
                "   detailDialog.close(); detailContext=null; await navigate('conservation');\n"
                "  }\n"
                "  return conservation.dispatch(button);\n"
                " }\n",
                "Conservation controls", marker="return conservation.dispatch(button)")
    text = text.replace("detailDialog.close(); await navigate('conservation');",
                        "detailDialog.close(); detailContext=null; await navigate('conservation');")
    text = text.replace(
        "['conservation-open-study','conservation-open-plan'].includes(button.dataset.action)",
        "['conservation-open-study','conservation-open-plan','conservation-use-criteria',"
        "'conservation-new-parcel-study'].includes(button.dataset.action)")
    prior_task_stamp = "(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')).map(t=>[t.id,t.state])"
    current_task_stamp = (
        "(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')||"
        "['experiment.save','experiment.run','experiment.summarize'].includes(t.action))"
        ".map(t=>[t.id,t.state,t.updated_at||null,t.progress||null])"
    )
    text = text.replace(prior_task_stamp, current_task_stamp)
    if "conservation_tasks:" not in text:
        pattern = r'(?m)^(\s*const fingerprint=JSON\.stringify\(\{)(.*?)(\}\);)$'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected the original retained-state fingerprint")
        match = matches[0]
        extra = "conservation_tasks:view==='conservation'?" + current_task_stamp + ":undefined,"
        text = text[:match.start()] + match.group(1) + extra + match.group(2) + match.group(3) + text[match.end():]
    workspace_start = text.find("async function selectWorkspace(id){\n")
    workspace_end = text.find("\nasync function ", workspace_start + 1)
    if workspace_start < 0 or workspace_end < 0:
        raise ValueError("Expected the original guarded workspace transition")
    workspace_section = text[workspace_start:workspace_end]
    workspace_section = workspace_section.replace(" conservation.detach();\n", "")
    workspace_guard = " if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');\n"
    workspace_section = once(workspace_section, workspace_guard,
                             workspace_guard + " conservation.detach();\n",
                             "Conservation workspace transition after accepted draft guard",
                             marker=workspace_guard + " conservation.detach();\n")
    text = text[:workspace_start] + workspace_section + text[workspace_end:]
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



def patch_index(text, registered=False):
    if registered:
        return text
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
    if value.get("schema") not in (SCHEMA, "upstate.conservation-source/v1"):
        raise ValueError("Select the complete conservation source packet")
    if isinstance(value.get("files"), list):
        bodies, metadata = {}, {}
        for row in value["files"]:
            if not isinstance(row, dict) or not isinstance(row.get("path"), str):
                raise ValueError("A complete source entry needs its original path")
            name = row["path"]
            if name in bodies:
                raise ValueError("A source path occurs more than once: " + name)
            if row.get("encoding", "utf-8") != "utf-8":
                raise ValueError("Source files must retain their UTF-8 bodies: " + name)
            bodies[name] = row.get("content")
            metadata[name] = {key: row.get(key) for key in ("bytes", "sha256")}
        value = {**value, "schema": SCHEMA, "files": bodies, "file_metadata": metadata}
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
    needed = {
        "model/conservation_catalog.py", "operator/conservation_catalog.py",
        "operator/extensions/conservation-catalog.json",
        "model/conservation.py", "model/conservation_cli.py", "model/conservation_scenarios.py",
        "model/conservation_bindings.py", "model/conservation_optimization.py",
        "model/keowee_priority.py", "source/keowee-priority-methods-20261013.json",
        "source_tools/parcel_criteria.py", "source/parcel-criteria-sources-20261013.json",
        "operator/conservation.py", "operator/web/conservation.mjs",
        "operator/web/conservation.css", "operator/conservation_optimization.py",
        "operator/extensions/conservation-optimization.json",
    }
    if needed - set(files):
        raise ValueError("The complete current scientific and operator family must travel together; missing: "
                         + ", ".join(sorted(needed - set(files))))
    return value


def install(application, source):
    application = application.resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah application directory")
    packet = read_packet(source)
    registered = registered_conservation(application)
    for dependency in ("model/portfolios.py", "model/experiments.py", "model/common.py"):
        if not (application / dependency).is_file():
            raise ValueError("The current cumulative application needs its maintained dependency: " + dependency)
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
                allowed = PREVIOUS_SOURCES.get(name, {})
                if allowed.get(sha(current)) != len(current):
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
            incoming = patch(current.decode("utf-8"), registered=registered).encode("utf-8")
            if incoming != current:
                updates[name], original[name] = incoming, current
        receipt_dir = bank / marker
        receipt_dir.mkdir(parents=True, exist_ok=True)
        written = []
        record = {
            "schema": "upstate.conservation-install/v1",
            "operation_id": packet["operation_id"], "source_sha256": marker,
            "application": str(application), "files": {}, "state": "prepared",
            "conservation_owner": "registered" if registered else "direct",
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
