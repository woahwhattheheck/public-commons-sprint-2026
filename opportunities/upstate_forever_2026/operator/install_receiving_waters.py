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
import re
import runpy
from pathlib import Path
import stat
import tempfile


PREFIX = "waterlink-receiving-waters-plan-comparison-12"
REQUIRED = (
    "model/receiving_waters.py",
    "model/receiving_water_accounting.py",
    "model/spatial_esri.py",
    "source/capture_upstream_network.py",
    "model/receiving_water_spatial.py",
    "model/receiving_water_delivery.py",
    "model/receiving_water_cli.py",
    "model/receiving_water_monitoring.py",
    "source_tools/receiving_water_catalog.py",
    "operator/receiving_water_actions.py",
    "operator/web/receiving_waters.mjs",
    "operator/web/receiving_water_editing.mjs",
    "operator/web/receiving_water_sources.mjs",
    "operator/web/receiving_water_plan_compare.mjs",
    "operator/web/receiving_water_spatial.mjs",
    "operator/web/receiving_water_monitoring.mjs",
    "operator/web/receiving_waters.css",
)
EXTENSION_REQUIRED = (
    "operator/web/receiving_waters_extension.mjs",
    "operator/receiving_waters.extension.json",
    "operator/extension_registry.py",
    "operator/web/extension_host.mjs",
)
MONITORING_REQUIRED = (
    "model/MONITORING.md",
    "model/monitoring_actions.py",
    "model/monitoring_campaign.py",
    "model/monitoring_cli.py",
    "model/monitoring_common.py",
    "model/monitoring_design.py",
    "model/monitoring_network.py",
    "model/monitoring_sources.py",
    "model/monitoring_workspace.py",
    "operator/MONITORING_API.md",
    "operator/extensions/monitoring.json",
    "operator/monitoring.py",
    "operator/monitoring_native.py",
    "operator/monitoring_receiving.py",
    "operator/static/monitoring.js",
    "operator/web/monitoring-component.mjs",
    "operator/web/monitoring.css",
    "operator/web/monitoring.mjs",
    "model/requirements-monitoring.txt",
    "integrations/monitoring/install_native_monitoring.py",
    "operator/RECEIVING_WATER_MONITORING.md",
)
MONITORING_REPORT_REQUIRED = (
    "model/monitoring_comparison_report.py",
    "model/monitoring_frontier_comparison.py",
    "model/monitoring_packet.py",
    "model/monitoring_observed_context.py",
    "model/MONITORING_BUDGET_COMPARISON.md",
    "operator/MONITORING_COMPARISON_REPORT.md",
    "operator/MONITORING_BUDGET_CHOICES.md",
    "operator/web/monitoring-frontiers.mjs",
    "operator/web/monitoring-frontiers.css",
    "integration/component_fragments/monitoring-budget-comparison.json",
    "integration/component_fragments/monitoring-comparison-report.json",
    "model/monitoring_report_source.py",
    "model/monitoring_report_cli.py",
    "model/MONITORING_REPORT_SOURCE.md",
    "operator/monitoring_report_native.py",
    "operator/extensions/monitoring-report.json",
    "operator/web/monitoring-report.mjs",
    "model/observed_context.py",
)
RECEIVING_REPORT_REQUIRED = (
    "model/receiving_water_report_source.py",
    "model/receiving_water_report_cli.py",
    "model/RECEIVING_WATER_REPORT_SOURCE.md",
    "operator/receiving_water_report_native.py",
    "operator/extensions/receiving-water-report.json",
    "operator/web/receiving_water_report.mjs",
    "integration/component_fragments/receiving-water-report.json",
    "model/receiving_water_report_transfer.py",
    "model/RECEIVING_WATER_REPORT_TRANSFER.md",
    "integration/component_fragments/receiving-water-report-transfer.json",
    "model/scientific_figures.py",
    "model/scientific_map_figures.py",
    "model/receiving_water_report_maps.py",
    "model/RECEIVING_WATER_REPORT_MAPS.md",
    "integration/component_fragments/receiving-water-report-maps.json",
)
STUDY_TRANSFER_REQUIRED = (
    "model/study_transfer.py",
    "model/study_delivery_transfer.py",
    "model/study_report_transfer.py",
    "operator/study_transfer.py",
    "operator/extensions/study-transfer.json",
    "operator/web/extensions/study_transfer.mjs",
    "operator/web/extensions/study_transfer.css",
    "operator/RECEIVING_WATER_STUDY_TRANSFER.md",
    "integration/component_fragments/receiving-water-study-navigation.json",
)
MONITORING_ACTIONS = {
    "monitoring.network.import", "monitoring.design", "monitoring.frontier",
    "monitoring.campaign.create", "monitoring.campaign.revise",
    "monitoring.campaign.event", "monitoring.export",
}
# Exact retained version 4–10 descriptors before saved-plan comparison.
DESCRIPTOR_PREDECESSORS = {"461066ded3c3681dcaf8507f019dc8f1188d0a1ec45aea7f3a9f2e73835d637c",
                           "8cea5b0259c4d8c2656bad8153c20e5b50aadfb162ff223e07656cb2d056777c",
                           "7c04dc9f70efad4793888df765afc526b04d0dcea4aabdc71e08308e5eb91813",
                           "b76e245f56122f0bed0ed6053ed8bbeac7dee1db30caa4b45779a6fc3ccce6ca",
                           "d2c09c2d0597c85a9cac7aefbd7e18d885408241527a5231240af9d875bb6f7e",
                           "01404603bd67c5f697cfc187980b43327339cfc6f718b7f410039530c9a77def",
                           "dbceab03e787a2382d52363b75473fac95291f54e23848a1617eff33dc9bdd72"}
EXTENSION_TARGET = "operator/extensions/receiving-waters.json"
TARGETS = (
    "operator/server.py",
    "operator/web/app.mjs",
    "operator/web/index.html",
    "model/delivery.py",
    "model/portable.py",
    "model/spatial.py",
    "operator/web/spatial.mjs",
    "operator/web/monitoring.mjs",
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


def join_standalone_server(text):
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


def has_extension_registry(text):
    return re.search(r"self\.extensions\s*=\s*ExtensionRegistry\(", text) is not None


def allow_browser_assets(text):
    """Extend the original explicit allowlist without changing its file route."""
    matches = list(re.finditer(r"if selected not in \(?(\{[^}\n]+\})", text))
    if len(matches) != 1:
        raise ValueError("Expected one current explicit operator static-asset allowlist")
    match = matches[0]
    names = ast.literal_eval(match.group(1))
    if not isinstance(names, set) or not all(isinstance(name, str) for name in names):
        raise ValueError("The operator static allowlist must contain original file names")
    additions = {"receiving_waters.mjs", "receiving_waters.css", "receiving_water_spatial.mjs",
                 "receiving_water_monitoring.mjs", "receiving_water_report.mjs",
                 "receiving_water_editing.mjs", "receiving_water_sources.mjs",
                 "receiving_water_plan_compare.mjs"}
    if additions <= names:
        return text
    replacement = "{" + ", ".join(repr(name) for name in sorted(names | additions)) + "}"
    return text[:match.start(1)] + replacement + text[match.end(1):]


def remove_standalone_registration(text):
    """Move only this installer's original backend joins to the shared registry."""
    additions = (
        "from receiving_water_actions import ReceivingWaterActions, ACTIONS as RECEIVING_WATER_ACTIONS, READS as RECEIVING_WATER_READS\n",
        "ACTIONS.update(RECEIVING_WATER_ACTIONS)\n",
        "        self.receiving_water_actions = ReceivingWaterActions(self, Fault)\n",
        "        if action in RECEIVING_WATER_ACTIONS:\n"
        "            return self.receiving_water_actions.invoke(task)\n",
        "        state.update(self.receiving_water_actions.snapshot(workspace))\n",
        "        task = self.receiving_water_actions.decorate_task(task)\n",
        '                receiving_water_reads = {"/api/receiving-waters/" + name: name for name in RECEIVING_WATER_READS}\n'
        '                if url.path in receiving_water_reads:\n'
        '                    return self.send_json(200, self.app.receiving_water_actions.read(\n'
        '                        workspace, receiving_water_reads[url.path],\n'
        '                        {name: one(name) for name in ("plan_id", "analysis_id", "catalog_id")}))\n',
    )
    for addition in additions:
        if text.count(addition) > 1:
            raise ValueError("Duplicate original receiving-water registration; compose its current source")
        text = text.replace(addition, "", 1)
    remaining = ("RECEIVING_WATER_ACTIONS", "RECEIVING_WATER_READS",
                 "self.receiving_water_actions", "self.app.receiving_water_actions")
    if any(value in text for value in remaining):
        raise ValueError("The receiving-water backend has later edited call sites; preserve and join them to the shared registry")
    return text


def join_server(text):
    if has_extension_registry(text):
        text = remove_standalone_registration(text)
    else:
        text = join_standalone_server(text)
    return allow_browser_assets(text)


def join_registry_app(text):
    """Use one mounted registered desk and the original synchronous delivery helpers."""
    # Both original controller editions are published predecessors. Preserve the
    # current host's cross-desk callbacks by routing them to its sole desk.
    for old in (
        "    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n",
        "  if(typeof receivingWaters!=='undefined'&&view!=='receiving-waters')receivingWaters.detach();\n",
        "  if(view==='receiving-waters')html=receivingWaters.render();\n",
        "  if(view==='receiving-waters')receivingWaters.mount($('#content'));else receivingWaters.detach();\n",
        " if(action?.startsWith('water-'))return receivingWaters.dispatch(button);\n",
    ):
        text = text.replace(old, "")
    text = text.replace("receivingWaters.detach();", "")
    text = text.replace("(extensions.hasView('receiving-waters')?'':receivingWaters.taskActions(row))+", "")
    text = text.replace("receivingWaters.taskActions(row)+", "")
    text = text.replace("openReceivingPlan:id=>receivingWaters.openPlan(id)",
                        "openReceivingPlan:id=>extensions.openExtension('receiving-waters','openPlan',id)")
    text = text.replace("openReceivingAnalysis:id=>receivingWaters.openAnalysis(id)",
                        "openReceivingAnalysis:id=>extensions.openExtension('receiving-waters','openAnalysis',id)")
    contexts = (
        "{getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast}",
        "{getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,"
        "navigate,openDelivery:selection=>deliveryForm(undefined,selection)}",
        "{getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,"
        "navigate,openDelivery:selection=>deliveryForm(undefined,selection),openScientificReport}",
    )
    for context in contexts:
        original = "const receivingWaters=attachReceivingWaters(" + context + ");\n"
        if text.count(original) > 1:
            raise ValueError("The original receiving-water controller is repeated")
        text = text.replace(original, "", 1)
    text = after_line(
        text, "import {attachCustomerReviews}",
        "import {attachReceivingWaters} from './receiving_waters.mjs';\n",
        "import {attachReceivingWaters}",
    )
    # The original helper closure performs no work until called. Retain only its
    # two synchronous form functions; lifecycle/actions belong to extension_host.
    facade = ("const receivingWaterDelivery=(()=>{const original=attachReceivingWaters("
              "{getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast});"
              "return {deliveryFields:original.deliveryFields,deliverySelection:original.deliverySelection};})();\n")
    text = after_line(text, "const customerReviews=attachCustomerReviews(",
                      facade, "const receivingWaterDelivery=")
    text = text.replace("receivingWaters.deliveryFields(", "receivingWaterDelivery.deliveryFields(")
    text = text.replace("receivingWaters.deliverySelection(", "receivingWaterDelivery.deliverySelection(")
    text = text.replace("receivingWaterDelivery.deliverySelection({baseline_run_id:val(\'baseline\'),scenario_run_ids:alternatives})",
                        "receivingWaterDelivery.deliverySelection({baseline_run_id:val(\'baseline\'),scenario_run_ids:alternatives},row||{})")
    text = replace_once(
        text, " '<h3 class=\"subheading full\">Actual supporting source editions",
        " receivingWaterDelivery.deliveryFields(row||{})+\n"
        " '<h3 class=\"subheading full\">Actual supporting source editions",
        "receivingWaterDelivery.deliveryFields(",
    )
    text = replace_once(
        text, "return submitAction('delivery.build',{title:",
        "return submitAction('delivery.build',{...receivingWaterDelivery.deliverySelection("
        "{baseline_run_id:val('baseline'),scenario_run_ids:alternatives},row||{}),title:",
        "...receivingWaterDelivery.deliverySelection(",
    )
    text = replace_once(
        text, "  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection};\n",
        "  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection,"
        "subject:button.dataset.subject,subject_kind:button.dataset.subjectKind,statistic:button.dataset.statistic,"
        "run:button.dataset.run,quantity:button.dataset.quantity};\n",
        "subject:button.dataset.subject,subject_kind:button.dataset.subjectKind",
    )
    # Do not retain an unexpected second browser owner after known legacy joins.
    if "receivingWaters." in text or "const receivingWaters=" in text:
        raise ValueError("Compose the independently changed receiving-water controller before shared registration")
    return text


def join_client_report(text):
    """Compose original physical quantities into the maintained report model."""
    return replace_once(
        text,
        '    receptor_inventory = state.get("receptor_inventory") or {}\n'
        '    if receptor_inventory:\n'
        '        sections.append(_receptor_section(state, receptor_inventory))\n',
        '    receptor_inventory = state.get("receptor_inventory") or {}\n'
        '    if receptor_inventory:\n'
        '        sections.append(_receptor_section(state, receptor_inventory))\n'
        '    for index, (title, paragraphs) in enumerate(\n'
        '            (state.get("receiving_waters") or {}).get("report_sections", [])):\n'
        '        sections.append(_section("receiving-water-" + str(index), title, paragraphs))\n',
        '"receiving-water-" + str(index)',
    )


def join_app(text):
    if "createExtensionHost(" in text:
        return join_registry_app(text)
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
        text, "customerReviews.taskActions(row)",
        "receivingWaters.taskActions(row)+customerReviews.taskActions(row)",
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
    text = replace_once(
        text, "  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection};\n",
        "  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection,subject:button.dataset.subject,subject_kind:button.dataset.subjectKind,statistic:button.dataset.statistic,run:button.dataset.run,quantity:button.dataset.quantity};\n",
        "subject:button.dataset.subject,subject_kind:button.dataset.subjectKind",
    )
    # Compose the original plural-selector repair when receiving an earlier core.
    for old, new in (
        ("for(const node of $('[data-view]'))", "for(const node of $$('[data-view]'))"),
        ("for(const node of $('[data-native-models]',form)){", "for(const node of $$('[data-native-models]',form)){"),
        ("for(const input of $('input,select,textarea,button',node))", "for(const input of $$('input,select,textarea,button',node))"),
    ):
        text = text.replace(old, new)
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
    if "cartography.report_pdf(" in text:
        text = replace_once(
            text, '                cartography.report_pdf(target, selection.get("title", workspace.project["title"]),\n',
            '                sections.extend(receiving_water_delivery.report_section(water_product))\n'
            '                cartography.report_pdf(target, selection.get("title", workspace.project["title"]),\n',
            "sections.extend(receiving_water_delivery.report_section(water_product))",
        )
    elif "client_report.build_report(" not in text:
        raise ValueError("Compose the current delivery report engine before receiving-water installation")
    text = replace_once(
        text, "            atomic_json(audit_manifest, manifest)\n",
        "            receiving_water_delivery.extend_assets(manifest, state)\n"
        "            atomic_json(audit_manifest, manifest)\n",
        "receiving_water_delivery.extend_assets(manifest, state)",
    )
    return text


def join_portable(text):
    text = replace_once(
        text,
        '            for path in sorted((root / "grids").glob("*/.grid.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n',
        '            for path in sorted((root / "grids").glob("*/.grid.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n'
        '            for path in sorted((root / "receiving-water-analyses").glob("*/.analysis.lock")):\n'
        '                stack.enter_context(held(path, blocking=False))\n',
        '(root / "receiving-water-analyses").glob("*/.analysis.lock")',
    )

    text = replace_once(
        text,
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n',
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n'
        '            stack.enter_context(held(root / ".receiving-water-monitoring.lock", blocking=False))\n',
        'held(root / ".receiving-water-monitoring.lock", blocking=False)',
    )

    text = replace_once(
        text,
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n',
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n'
        '            stack.enter_context(held(root / ".monitoring-report-source.lock", blocking=False))\n',
        'held(root / ".monitoring-report-source.lock", blocking=False)',
    )
    return replace_once(
        text,
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n',
        '            stack.enter_context(held(root / ".workspace.lock", blocking=False))\n'
        '            stack.enter_context(held(root / ".receiving-water-report-source.lock", blocking=False))\n',
        'held(root / ".receiving-water-report-source.lock", blocking=False)',
    )


def join_monitoring_report(text):
    """Preserve current Monitoring and Fieldwork lifecycles when adding reports."""
    text = replace_once(
        text, '/* Native host adapter: original authorization, task queue and file tickets. */\n',
        'import {attachMonitoringReport} from \'./monitoring-report.mjs\';\n'
        '/* Native host adapter: original authorization, task queue and file tickets. */\n',
        'import {attachMonitoringReport} from \'./monitoring-report.mjs\';',
    )
    legacy = 'export function attachMonitoring({getState, api, endpoint, showTask, toast}) {\n'
    if legacy in text:
        text = replace_once(
            text, legacy,
            'export function attachMonitoring(context) {\n'
            '  const {getState, api, endpoint, showTask, toast}=context;\n',
            'export function attachMonitoring(context) {',
        )
    scopes = re.findall(r"export function attachMonitoring\((host|context)\) \{", text)
    if len(scopes) != 1:
        raise ValueError("Compose the current Monitoring host/context adapter before report integration")
    scope = scopes[0]
    existing = re.findall(r"attachMonitoringReport\(node,(\w+),key\)", text)
    if existing and existing != [scope]:
        raise ValueError("The current Monitoring report helper uses another adapter context")
    addition = ('    node.monitoringReport ||= attachMonitoringReport(node,' + scope + ',key);\n'
                '    node.monitoringReport.update();\n')
    marker = 'node.monitoringReport ||= attachMonitoringReport(node,' + scope + ',key);'
    if '    await fieldwork.mount(root,key);\n' in text:
        text = replace_once(
            text, '    await fieldwork.mount(root,key);\n',
            addition + '    await fieldwork.mount(root,key);\n', marker,
        )
    else:
        text = replace_once(
            text, '    await node.ready;\n',
            '    await node.ready;\n' + addition, marker,
        )
    text = replace_once(
        text, '  async function update() {\n',
        '  async function update() {\n    active?.monitoringReport?.update();\n',
        'active?.monitoringReport?.update();',
    )
    text = replace_once(
        text, '  function detach(){generation++;networkOpening++;',
        '  function detach(){generation++;networkOpening++;active?.monitoringReport?.detach();',
        'active?.monitoringReport?.detach();',
    )
    return text


def join_spatial(text):
    text = replace_once(
        text, 'return units in {"class", "classes", "mask", "category",',
        'return units in {"class", "classes", "mask", "binary", "category",',
        '"class", "classes", "mask", "binary"',
    )
    text = after_line(
        text, "from .common import",
        "from . import receiving_water_spatial\n",
        "from . import receiving_water_spatial",
    )
    text = replace_once(
        text, "        return tuple((str(p.relative_to(root)), _signature(p)) for p in sorted(paths))\n",
        "        paths.extend(receiving_water_spatial.manifest_paths(self.workspace))\n"
        "        return tuple((str(p.relative_to(root)), _signature(p)) for p in sorted(paths))\n",
        "paths.extend(receiving_water_spatial.manifest_paths(self.workspace))",
    )
    text = replace_once(
        text, "            # Atomic source manifests can be added during a native run. Never cache\n",
        "            receiving_water_spatial.add_layers(ws, add)\n"
        "            # Atomic source manifests can be added during a native run. Never cache\n",
        "receiving_water_spatial.add_layers(ws, add)",
    )
    text = replace_once(
        text, '                     "profile_id", "scenario_id", "baseline_run_id", "alternative_run_id", "direction"):\n',
        '                     "profile_id", "scenario_id", "baseline_run_id", "alternative_run_id", "direction",\n'
        '                     "receiving_water_plan_id", "receiving_water_analysis_id", "subject_id",\n'
        '                     "subject_kind", "family", "relationship_precision", "quantity_scope",\n'
        '                     "quantity", "statistic", "normalization_id", "relationship_method",\n'
        '                     "source_body_sha256", "source_selection_id", "invest_version"):\n',
        '"source_body_sha256", "source_selection_id", "invest_version")',
    )
    return text


def join_spatial_app(text):
    if "from './receiving_water_spatial.mjs'" not in text:
        text = (
            "import {isReceivingWaterTarget, receivingWaterTargetMatches, receivingWaterView, receivingWaterStateSignature} "
            "from './receiving_water_spatial.mjs';\n\n" + text
        )
    text = replace_once(
        text, "import {isReceivingWaterTarget, receivingWaterTargetMatches, receivingWaterView} from './receiving_water_spatial.mjs';",
        "import {isReceivingWaterTarget, receivingWaterTargetMatches, receivingWaterView, receivingWaterStateSignature} from './receiving_water_spatial.mjs';",
        "receivingWaterView, receivingWaterStateSignature}",
    )
    text = replace_once(
        text, "return JSON.stringify(['sources','grids','runs','comparisons','deliveries','spatial_reviews'].map(kind=>(state.data?.[kind]||[]).map(row=>[row.id,row.state])));",
        "return JSON.stringify([['sources','grids','runs','comparisons','deliveries','spatial_reviews'].map(kind=>(state.data?.[kind]||[]).map(row=>[row.id,row.state])),receivingWaterStateSignature(state)]);",
        ",receivingWaterStateSignature(state)]",
    )
    text = replace_once(
        text, "function groupTitle(name){return ({source:",
        "function groupTitle(name){return ({'receiving-water-plan':'Receiving-water boundaries',"
        "'receiving-water-analysis':'Receiving-water results',source:",
        "'receiving-water-plan':'Receiving-water boundaries'",
    )
    text = replace_once(
        text, "  function targetMatches(row,target){\n",
        "  function targetMatches(row,target){\n"
        "    if(isReceivingWaterTarget(target))return receivingWaterTargetMatches(row,target);\n",
        "if(isReceivingWaterTarget(target))return receivingWaterTargetMatches(row,target)",
    )
    text = replace_once(
        text, "  function applyTarget(c,target){\n"
        "    const matches=c.model.catalog.layers.filter(row=>targetMatches(row,target));\n",
        "  function applyTarget(c,target){\n"
        "    const matches=c.model.catalog.layers.filter(row=>targetMatches(row,target));\n"
        "    if(isReceivingWaterTarget(target)){Object.assign(c.model,receivingWaterView(matches,target,id=>selected(c,id)));dirty(c);return;}\n",
        "Object.assign(c.model,receivingWaterView(matches,target,id=>selected(c,id)))",
    )
    return text


JOINERS = {
    "operator/server.py": join_server,
    "operator/web/app.mjs": join_app,
    "operator/web/index.html": join_index,
    "model/delivery.py": join_delivery,
    "model/portable.py": join_portable,
    "model/spatial.py": join_spatial,
    "operator/web/spatial.mjs": join_spatial_app,
    "operator/web/monitoring.mjs": join_monitoring_report,
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
    original_server = (root / "operator/server.py").read_text(encoding="utf-8")
    original_app = (root / "operator/web/app.mjs").read_text(encoding="utf-8")
    registry = has_extension_registry(original_server)
    browser_registry = "createExtensionHost(" in original_app
    if registry != browser_registry:
        raise ValueError("Complete the existing shared extension host's server and browser join before composing receiving waters")
    if not registry:
        raise ValueError("Install the current shared extension host before the receiving-water monitoring workflow")
    if ("openScientificReport" not in original_app
            or "sourceReports.openForSources(" not in original_app):
        raise ValueError("Receive the current shared scientific report composer and its source-selection host capability")
    extension_host = (root / "operator/web/extension_host.mjs").read_text(encoding="utf-8")
    if "task._extension_task_actions?.extension_id" not in extension_host:
        raise ValueError("Receive the current shared host with registered backend task-result navigation")
    required = (REQUIRED + EXTENSION_REQUIRED + MONITORING_REQUIRED
                + MONITORING_REPORT_REQUIRED + RECEIVING_REPORT_REQUIRED + STUDY_TRANSFER_REQUIRED)
    for relative in required:
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(f"Receive the complete receiving-water extension source: {path}")
        if relative.endswith(".py"):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    monitoring = json.loads((root / "operator/extensions/monitoring.json").read_bytes())
    if (monitoring.get("schema") != "upstate.operator-extension/v1"
            or monitoring.get("id") != "monitoring"
            or monitoring.get("backend", {}).get("module") != "monitoring_native"
            or monitoring.get("client", {}).get("module") != "/web/monitoring.mjs"
            or not MONITORING_ACTIONS <= set(monitoring.get("backend", {}).get("actions", []))):
        raise ValueError("Receive the complete original registered Monitoring desk")
    version = re.fullmatch(r"1\.(\d+)\.\d+", str(monitoring.get("version", "")))
    adapter = (root / "operator/web/monitoring.mjs").read_text(encoding="utf-8")
    component = (root / "operator/web/monitoring-component.mjs").read_text(encoding="utf-8")
    if (version is None or int(version.group(1)) < 3
            or "async function openNetwork(" not in adapter
            or "await node.ready;" not in adapter
            or "this.ready=this.run(" not in component):
        raise ValueError("Receive Monitoring 1.3 or later compatible source with its complete network handoff")
    report_descriptor = json.loads((root / "operator/extensions/monitoring-report.json").read_bytes())
    report_backend = report_descriptor.get("backend") or {}
    report_route = {"methods": ["GET"], "path": "/api/monitoring-report",
                    "handler": "read", "args": ["operator", "workspace_key", "payload"]}
    if (report_descriptor.get("schema") != "upstate.operator-extension/v1"
            or report_descriptor.get("id") != "monitoring-report"
            or report_descriptor.get("client")
            or "monitoring.export" not in report_descriptor.get("requires_actions", [])
            or "monitoring-report.mjs" not in report_descriptor.get("assets", [])
            or report_backend.get("module") != "monitoring_report_native"
            or "monitoring.report.prepare" not in report_backend.get("actions", [])
            or report_backend.get("invoke") != {"handler": "perform", "args": ["operator", "task"]}
            or report_route not in report_backend.get("routes", [])
            or report_backend.get("decorate_task") != {"handler": "decorate_task", "args": ["operator", "task"]}
            or report_backend.get("verify_workspace") != {"handler": "verify_workspace", "args": ["workspace"]}):
        raise ValueError("Receive the complete registered Monitoring report provider and native file bindings")
    report_client = (root / "operator/web/monitoring-report.mjs").read_text(encoding="utf-8")
    if "export function attachMonitoringReport(node, context, workspaceKey)" not in report_client:
        raise ValueError("Receive the current Monitoring scientific report browser helper")
    water_report = json.loads((root / "operator/extensions/receiving-water-report.json").read_bytes())
    water_backend = water_report.get("backend") or {}
    water_route = {"methods": ["GET"], "path": "/api/receiving-water-report",
                   "handler": "read", "args": ["operator", "workspace_key", "payload"]}
    if (water_report.get("schema") != "upstate.operator-extension/v1"
            or water_report.get("id") != "receiving-water-report"
            or water_report.get("client")
            or "receiving.water.plan" not in water_report.get("requires_actions", [])
            or "receiving_water_report.mjs" not in water_report.get("assets", [])
            or water_backend.get("module") != "receiving_water_report_native"
            or "receiving.water.report.prepare" not in water_backend.get("actions", [])
            or water_backend.get("invoke") != {"handler": "perform", "args": ["operator", "task"]}
            or water_route not in water_backend.get("routes", [])
            or water_backend.get("state") != {"key": "receiving_water_reports",
                "handler": "snapshot", "args": ["operator", "workspace_key"]}
            or water_backend.get("decorate_task") != {"handler": "decorate_task", "args": ["operator", "task"]}
            or water_backend.get("verify_workspace") != {"handler": "verify_workspace", "args": ["workspace"]}):
        raise ValueError("Receive the complete registered receiving-water report provider")
    water_client = (root / "operator/web/receiving_water_report.mjs").read_text(encoding="utf-8")
    if "export function attachReceivingWaterReport(context)" not in water_client:
        raise ValueError("Receive the maintained receiving-water scientific report controls")
    study_descriptor = json.loads((root / "operator/extensions/study-transfer.json").read_bytes())
    if (study_descriptor.get("schema") != "upstate.operator-extension/v1"
            or study_descriptor.get("id") != "study-transfer"
            or study_descriptor.get("backend", {}).get("module") != "study_transfer"
            or "study.export" not in study_descriptor.get("backend", {}).get("actions", [])
            or study_descriptor.get("client", {}).get("module") != "/web/extensions/study_transfer.mjs"):
        raise ValueError("Receive the maintained Study transfer provider and browser")
    study_tree = ast.parse((root / "model/study_transfer.py").read_text(encoding="utf-8"))
    root_declaration = next((node.value for node in study_tree.body
                             if isinstance(node, ast.Assign)
                             and any(isinstance(target, ast.Name) and target.id == "ROOT_KINDS"
                                     for target in node.targets)), None)
    root_names = {node.value for node in ast.walk(root_declaration)
                  if isinstance(node, ast.Constant) and isinstance(node.value, str)} if root_declaration is not None else set()
    if not {"receiving-water-plans", "receiving-water-analyses"} <= root_names:
        raise ValueError("Receive Study transfer with original receiving-water plan and analysis roots")
    study_client = (root / "operator/web/extensions/study_transfer.mjs").read_text(encoding="utf-8")
    if ("openForStudies" not in study_client
            or "receiving-water-plans" not in study_client
            or "receiving-water-analyses" not in study_client):
        raise ValueError("Receive the current Study transfer browser with direct original study selection")
    water_browser = (root / "operator/web/receiving_waters.mjs").read_text(encoding="utf-8")
    water_editing = (root / "operator/web/receiving_water_editing.mjs").read_text(encoding="utf-8")
    if ("from './receiving_water_editing.mjs'" not in water_browser
            or "async function editSaved(" not in water_browser
            or "export function revisePlan(" not in water_editing
            or "export function reviseAnalysis(" not in water_editing
            or "async function openReceiving(" not in study_client):
        raise ValueError("Receive the complete editable Receiving forms and original study return navigation")
    water_sources = (root / "operator/web/receiving_water_sources.mjs").read_text(encoding="utf-8")
    if ("from './receiving_water_sources.mjs'" not in water_browser
            or "export function attachReceivingSourcePicker(" not in water_sources
            or "/api/spatial/describe" not in water_sources
            or "/api/spatial/overlay" not in water_sources):
        raise ValueError("Receive the maintained original-feature picker and Spatial review source APIs")
    water_compare = (root / "operator/web/receiving_water_plan_compare.mjs").read_text(encoding="utf-8")
    if ("from './receiving_water_plan_compare.mjs'" not in water_browser
            or "export function comparePlanEditions(" not in water_compare):
        raise ValueError("Receive the maintained original saved-plan comparison and Receiving form handoff")
    migration = runpy.run_path(str(root / "integrations/monitoring/install_native_monitoring.py"),
                              run_name="_original_monitoring_migration")
    removers = {"operator/server.py": migration["remove_server"],
                "operator/web/app.mjs": migration["remove_app"],
                "operator/web/index.html": migration["remove_index"]}
    joiners = dict(JOINERS)
    if "client_report.build_report(" in (root / "model/delivery.py").read_text(encoding="utf-8"):
        report_path = root / "model/client_report.py"
        if not report_path.is_file():
            raise FileNotFoundError("Receive the current complete model/client_report.py")
        joiners["model/client_report.py"] = join_client_report
    originals, changes = {}, {}
    for relative, join in joiners.items():
        path = root / relative
        before = path.read_bytes()
        source = before.decode("utf-8")
        if relative in removers:
            source = removers[relative](source)
        after = join(source).encode("utf-8")
        if relative.endswith(".py"):
            ast.parse(after.decode("utf-8"), filename=str(path))
        originals[relative] = before
        if before != after:
            changes[relative] = after
    if registry:
        template = json.loads((root / "operator/receiving_waters.extension.json").read_bytes())
        if (template.get("schema") != "upstate.operator-extension/v1"
                or template.get("id") != "receiving-waters"
                or template.get("backend", {}).get("module") != "receiving_water_actions"):
            raise ValueError("Choose the original receiving-water extension descriptor")
        for asset in template.get("assets", []):
            if (not isinstance(asset, str) or "/" in asset or "\\" in asset
                    or asset in {"", ".", ".."}
                    or not (root / "operator/web" / asset).is_file()):
                raise ValueError("A complete installed receiving-water web asset is missing")
        target = root / EXTENSION_TARGET
        before = target.read_bytes() if target.exists() else None
        installed = json.loads(before) if before is not None else None
        if installed is not None and installed != template:
            previous = json.loads(json.dumps(template))
            previous["version"] = "2"
            previous["client"].pop("task_actions", None)
            previous["assets"] = [name for name in previous["assets"]
                                  if name not in {"receiving_water_spatial.mjs", "receiving_water_monitoring.mjs",
                                                  "receiving_water_report.mjs", "receiving_water_editing.mjs",
                                                  "receiving_water_sources.mjs",
                                                  "receiving_water_plan_compare.mjs"}]
            previous["client"]["requires"] = [name for name in previous["client"]["requires"]
                                               if name not in {"openScientificReport", "openExtension"}]
            previous["backend"]["actions"] = [name for name in previous["backend"]["actions"]
                                                if name != "receiving.water.monitoring"]
            previous["backend"]["routes"] = [route for route in previous["backend"]["routes"]
                                               if route.get("operation") != "monitoring"]
            if installed != previous and sha256(before) not in DESCRIPTOR_PREDECESSORS:
                raise ValueError("The installed receiving-water descriptor has authored changes; compose that descriptor before replacing it")
        originals[EXTENSION_TARGET] = before
        if installed != template:
            changes[EXTENSION_TARGET] = (json.dumps(template, indent=2) + "\n").encode("utf-8")
    elif (root / EXTENSION_TARGET).exists():
        raise ValueError("This application already carries the shared receiving-water descriptor; restore the complete extension host join")
    report = {
        "schema": "upstate.receiving-water-install/v1",
        "operation": PREFIX,
        "root": str(root),
        "mode": "shared-extension" if registry else "original-operator",
        "state": "ready" if check else "installed",
        "files": [
            {"path": relative, "before_sha256": sha256(originals[relative]) if originals[relative] is not None else None,
             "after_sha256": sha256(after), "bytes": len(after)}
            for relative, after in changes.items()
        ],
        "components": [
            {"path": relative, "sha256": sha256((root / relative).read_bytes()),
             "bytes": (root / relative).stat().st_size}
            for relative in required
        ],
    }
    if check or not changes:
        return report
    identity = sha256(json.dumps(report["files"], sort_keys=True).encode("utf-8"))
    backup = root / ".receiving-water-install" / identity
    backup.mkdir(parents=True, exist_ok=True)
    for relative, before in originals.items():
        if relative not in changes or before is None:
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
            current = path.read_bytes() if path.exists() else None
            if current != originals[relative]:
                raise ValueError(f"Source changed during integration: {relative}; rerun against that edition")
            mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(path, after, mode)
            applied.append(relative)
    except BaseException:
        for relative in reversed(applied):
            path = root / relative
            if path.is_file() and path.read_bytes() == changes[relative]:
                if originals[relative] is None:
                    path.unlink()
                else:
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
