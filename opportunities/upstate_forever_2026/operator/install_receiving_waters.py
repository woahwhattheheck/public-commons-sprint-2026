#!/usr/bin/env python3
"""Join receiving-water modules to the current retained operator and delivery.

Run after receiving the published additive science, compiler, and browser files:
    python -B operator/install_receiving_waters.py --root .
The installer preserves other components and records original file preimages.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile


PREFIX = "waterlink-receiving-waters-1"
REQUIRED = (
    "model/receiving_waters.py",
    "model/receiving_water_delivery.py",
    "model/receiving_water_cli.py",
    "source_tools/receiving_water_catalog.py",
    "operator/receiving_water_actions.py",
    "operator/web/receiving_waters.mjs",
    "operator/web/receiving_waters.css",
)
TARGETS = (
    "operator/server.py",
    "operator/web/app.mjs",
    "operator/web/index.html",
    "model/delivery.py",
    "model/portable.py",
)


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def replace_once(text, old, new, marker):
    if marker in text:
        return text
    count = text.count(old)
    if count != 1:
        raise ValueError(
            f"Expected one current integration seam for {marker!r}; found {count}. "
            "Receive the current operator and regional delivery source before installing."
        )
    return text.replace(old, new, 1)


def after_line(text, prefix, addition, marker):
    if marker in text:
        return text
    lines = text.splitlines(keepends=True)
    matches = [i for i, line in enumerate(lines) if line.strip().startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one current source line for {prefix!r}; found {len(matches)}")
    index = matches[0] + 1
    lines.insert(index, addition)
    return "".join(lines)


def before_method_return(text, class_name, method_name, addition, marker):
    if marker in text:
        return text
    tree = ast.parse(text)
    cls = next((node for node in tree.body if isinstance(node, ast.ClassDef)
                and node.name == class_name), None)
    method = next((node for node in cls.body if isinstance(node, ast.FunctionDef)
                   and node.name == method_name), None) if cls else None
    returns = [node for node in method.body if isinstance(node, ast.Return)] if method else []
    if len(returns) != 1:
        raise ValueError(f"Expected one final {class_name}.{method_name} return")
    lines = text.splitlines(keepends=True)
    lines.insert(returns[0].lineno - 1, addition)
    return "".join(lines)


def join_server(text):
    text = after_line(
        text, "from customer_reviews import",
        "from receiving_water_actions import ReceivingWaterActions, ACTIONS as RECEIVING_WATER_ACTIONS, READS as RECEIVING_WATER_READS\n",
        "from receiving_water_actions import",
    )
    text = after_line(
        text, "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)",
        "ACTIONS.update(RECEIVING_WATER_ACTIONS)\n",
        "ACTIONS.update(RECEIVING_WATER_ACTIONS)",
    )
    text = after_line(
        text, "self.customer_reviews = CustomerReviews(",
        "        self.receiving_water_actions = ReceivingWaterActions(self, Fault)\n",
        "self.receiving_water_actions = ReceivingWaterActions(",
    )
    text = replace_once(
        text, '        action = task["action"]\n',
        '        action = task["action"]\n'
        '        if action in RECEIVING_WATER_ACTIONS:\n'
        '            return self.receiving_water_actions.invoke(task)\n',
        "return self.receiving_water_actions.invoke(task)",
    )
    text = before_method_return(
        text, "Operator", "state",
        "        state.update(self.receiving_water_actions.snapshot(workspace))\n",
        "state.update(self.receiving_water_actions.snapshot(workspace))",
    )
    text = before_method_return(
        text, "Operator", "task_view",
        "        task = self.receiving_water_actions.decorate_task(task)\n",
        "task = self.receiving_water_actions.decorate_task(task)",
    )
    text = replace_once(
        text, '                if url.path == "/api/spatial/catalog":\n',
        '                receiving_water_reads = {"/api/receiving-waters/" + name: name for name in RECEIVING_WATER_READS}\n'
        '                if url.path in receiving_water_reads:\n'
        '                    return self.send_json(200, self.app.receiving_water_actions.read(\n'
        '                        workspace, receiving_water_reads[url.path],\n'
        '                        {name: one(name) for name in ("plan_id", "analysis_id", "catalog_id")}))\n'
        '                if url.path == "/api/spatial/catalog":\n',
        'receiving_water_reads = {"/api/receiving-waters/"',
    )
    return text


def join_app(text):
    text = after_line(
        text, "import {attachCustomerReviews}",
        "import {attachReceivingWaters} from './receiving_waters.mjs';\n",
        "import {attachReceivingWaters}",
    )
    text = after_line(
        text, "const customerReviews=attachCustomerReviews(",
        "const receivingWaters=attachReceivingWaters({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast});\n",
        "const receivingWaters=attachReceivingWaters(",
    )
    text = replace_once(
        text, "const viewLabels={", "const viewLabels={'receiving-waters':'Receiving waters',",
        "'receiving-waters':'Receiving waters'",
    )
    text = replace_once(
        text, "const actionLabels={",
        "const actionLabels={'receiving.water.catalog':'Compile published waters',"
        "'receiving.water.plan':'Prepare receiving areas',"
        "'receiving.water.profile':'Prepare utility areas',"
        "'receiving.water.analyze':'Analyze receiving waters',",
        "'receiving.water.catalog':'Compile published waters'",
    )
    text = replace_once(
        text, "if(view==='spatial'){", "if(view==='spatial'){receivingWaters.detach();",
        "if(view==='spatial'){receivingWaters.detach();",
    )
    text = replace_once(
        text, "  $('#content').innerHTML=html;\n",
        "  if(view==='receiving-waters')html=receivingWaters.render();\n"
        "  $('#content').innerHTML=html;\n"
        "  if(view==='receiving-waters')receivingWaters.mount($('#content'));else receivingWaters.detach();\n",
        "if(view==='receiving-waters')html=receivingWaters.render();",
    )
    text = replace_once(
        text, "workspace=id;state=null;sessionStorage.setItem('upstate-selected-workspace',id);",
        "receivingWaters.detach();workspace=id;state=null;sessionStorage.setItem('upstate-selected-workspace',id);",
        "receivingWaters.detach();workspace=id;",
    )
    text = after_line(
        text, "if(action?.startsWith('review-'))",
        " if(action?.startsWith('water-'))return receivingWaters.dispatch(button);\n",
        "return receivingWaters.dispatch(button)",
    )
    text = replace_once(
        text, "customerReviews.taskActions(row)+fileList(row._downloads||[])",
        "receivingWaters.taskActions(row)+customerReviews.taskActions(row)+fileList(row._downloads||[])",
        "receivingWaters.taskActions(row)",
    )
    text = replace_once(
        text, " '<h3 class=\"subheading full\">Actual supporting source editions",
        " receivingWaters.deliveryFields(row||{})+\n '<h3 class=\"subheading full\">Actual supporting source editions",
        "receivingWaters.deliveryFields(row||{})",
    )
    text = replace_once(
        text, "return submitAction('delivery.build',{title:",
        "return submitAction('delivery.build',{...receivingWaters.deliverySelection({baseline_run_id:val('baseline'),scenario_run_ids:alternatives}),title:",
        "...receivingWaters.deliverySelection(",
    )
    return text


def join_index(text):
    text = replace_once(
        text, "</head>",
        '<link rel="stylesheet" href="/web/receiving_waters.css">\n</head>',
        'href="/web/receiving_waters.css"',
    )
    return replace_once(
        text, '    <button data-view="deliveries">Maps and delivery</button>',
        '    <button data-view="receiving-waters">Receiving waters</button>\n'
        '    <button data-view="deliveries">Maps and delivery</button>',
        'data-view="receiving-waters"',
    )


def join_delivery(text):
    text = after_line(
        text, "from .delivery_archive import package_archive",
        "from . import receiving_water_delivery\n",
        "from . import receiving_water_delivery",
    )
    text = after_line(
        text, 'comparison_root = workspace.root / "comparisons" / comparison["id"]',
        '            water_product = receiving_water_delivery.collect(\n'
        '                workspace, selection, directory / "receiving-waters",\n'
        '                priority_settings=state["priority"])\n'
        '            receiving_water_delivery.attach_state(state, directory, water_product)\n'
        '            atomic_json(state_path, state)\n',
        "water_product = receiving_water_delivery.collect(",
    )
    text = replace_once(
        text, "            future_maps = {}\n",
        "            receiving_water_delivery.apply_map_specs(all_specs, water_product)\n"
        "            future_maps = {}\n",
        "receiving_water_delivery.apply_map_specs(all_specs, water_product)",
    )
    text = replace_once(
        text, '                cartography.report_pdf(target, selection.get("title", workspace.project["title"]),\n',
        '                sections.extend(receiving_water_delivery.report_section(water_product))\n'
        '                cartography.report_pdf(target, selection.get("title", workspace.project["title"]),\n',
        "sections.extend(receiving_water_delivery.report_section(water_product))",
    )
    text = replace_once(
        text, "            atomic_json(audit_manifest, manifest)\n",
        "            receiving_water_delivery.extend_assets(manifest, state)\n"
        "            atomic_json(audit_manifest, manifest)\n",
        "receiving_water_delivery.extend_assets(manifest, state)",
    )
    return text


def join_portable(text):
    return replace_once(
        text,
        '            for path in sorted((root / "grids").glob("*/.grid.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n',
        '            for path in sorted((root / "grids").glob("*/.grid.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n'
        '            for path in sorted((root / "receiving-water-analyses").glob("*/.analysis.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n',
        '(root / "receiving-water-analyses").glob("*/.analysis.lock")',
    )


JOINERS = {
    "operator/server.py": join_server,
    "operator/web/app.mjs": join_app,
    "operator/web/index.html": join_index,
    "model/delivery.py": join_delivery,
    "model/portable.py": join_portable,
}


def write_atomic(path, body, mode=0o644):
    descriptor, filename = tempfile.mkstemp(prefix=".waterlink-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(filename, mode)
        os.replace(filename, path)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def install(root, *, check=False):
    root = Path(root).resolve()
    for relative in REQUIRED + TARGETS:
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(
                f"Receive the complete original application and published component first: {path}"
            )
        if relative.endswith(".py"):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    originals, changes = {}, {}
    for relative, join in JOINERS.items():
        path = root / relative
        before = path.read_bytes()
        after = join(before.decode("utf-8")).encode("utf-8")
        if relative.endswith(".py"):
            ast.parse(after.decode("utf-8"), filename=str(path))
        originals[relative] = before
        if before != after:
            changes[relative] = after
    report = {
        "schema": "upstate.receiving-water-install/v1",
        "operation": PREFIX,
        "root": str(root),
        "state": "ready" if check else "installed",
        "files": [
            {"path": relative, "before_sha256": sha256(originals[relative]),
             "after_sha256": sha256(after), "bytes": len(after)}
            for relative, after in changes.items()
        ],
        "components": [
            {"path": relative, "sha256": sha256((root / relative).read_bytes()),
             "bytes": (root / relative).stat().st_size}
            for relative in REQUIRED
        ],
    }
    if check or not changes:
        return report
    identity = sha256(json.dumps(report["files"], sort_keys=True).encode("utf-8"))
    backup = root / ".receiving-water-install" / identity
    backup.mkdir(parents=True, exist_ok=True)
    for relative, before in originals.items():
        if relative not in changes:
            continue
        target = backup / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != before:
            raise ValueError(f"Existing install preimage differs: {target}")
        if not target.exists():
            write_atomic(target, before)
    applied = []
    try:
        for relative, after in changes.items():
            path = root / relative
            if path.read_bytes() != originals[relative]:
                raise ValueError(f"Source changed during integration: {relative}; rerun against that edition")
            mode = stat.S_IMODE(path.stat().st_mode)
            write_atomic(path, after, mode)
            applied.append(relative)
    except BaseException:
        for relative in reversed(applied):
            path = root / relative
            if path.read_bytes() == changes[relative]:
                write_atomic(path, originals[relative], stat.S_IMODE(path.stat().st_mode))
        raise
    report["preimages"] = str(backup)
    write_atomic(backup / "install.json", (json.dumps(report, indent=2) + "\n").encode("utf-8"))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--check", action="store_true", help="Inspect all joins without writing")
    args = parser.parse_args(argv)
    result = install(args.root, check=args.check)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
