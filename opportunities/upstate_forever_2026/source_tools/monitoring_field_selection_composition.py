"""Compose field-selection controls into the maintained Monitoring host.

Only the three reviewed integration sites are changed. Unrelated receiver edits
remain in place; a changed named hook requires deliberate source reconciliation.
The original installer owns source locking, before-image checks and rollback.
"""
from __future__ import annotations

import hashlib
import json

MEMBER = "operator/web/monitoring.mjs"
EDITS = [
    {
        "id": "import",
        "marker": "import {attachMonitoringFieldSelection}",
        "before": "import {attachMonitoringFrontiers}",
        "after": "import {attachMonitoringFieldSelection} from './monitoring-field-selection.mjs';\nimport {attachMonitoringFrontiers}"
    },
    {
        "id": "mount",
        "marker": "node.monitoringFieldSelection",
        "before": "    await fieldwork.mount(root,key);",
        "after": "    node.monitoringFieldSelection ||= attachMonitoringFieldSelection(node,{...host,transport},key);\n    await node.monitoringFieldSelection.mount();\n    if(ticket!==generation || workspace()!==key)return;\n    await fieldwork.mount(root,key);"
    },
    {
        "id": "detach",
        "marker": "active?.monitoringFieldSelection?.detach()",
        "before": "fieldwork.detach();",
        "after": "active?.monitoringFieldSelection?.detach();fieldwork.detach();"
    }
]


def compose(bodies):
    if set(bodies) != {MEMBER}:
        raise ValueError("Field selection requires the current original Monitoring host")
    current = bodies[MEMBER]
    if not isinstance(current, str):
        raise ValueError("Read the complete UTF-8 Monitoring host before composing")
    for edit in EDITS:
        before, after = edit["before"], edit["after"]
        if current.count(after) == 1:
            continue
        if edit["marker"] in current:
            raise ValueError(MEMBER + ": field-selection " + edit["id"] +
                             " hook differs; reconcile the named hook without replacing the current host")
        if current.count(before) != 1:
            raise ValueError(MEMBER + ": field-selection " + edit["id"] +
                             " site must match exactly once; current source was preserved")
        current = current.replace(before, after, 1)
    return {MEMBER: current}


CUSTODY = (
    "integrations/monitoring/source_adoption.json",
    "integration/monitoring_observed_sources.json",
    "integration/monitoring_study_transfer_sources.json",
    "integration/reach_chemistry/COMPOUND_SOURCE.json",
)


def bind_custody(bodies, host):
    """Bind accepted inventory rows to the actual preserved receiving host.

    Original predecessor history is left intact. No unrelated source member is
    admitted for replacement. The Chemistry installer verifies these complete
    postimages before committing them in its existing source transaction.
    """
    rebound = {}
    actual = {MEMBER: host}
    for name in CUSTODY:
        original = bodies[name]
        document = json.loads(original)
        rows = document.get("installed_files", document.get("files"))
        if not isinstance(rows, list):
            raise ValueError("Read the complete original field custody inventory: " + name)
        changed = False
        for row in rows:
            path = row.get("path")
            if path not in actual:
                continue
            body = actual[path]
            identity = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            if any(row.get(key) != value for key, value in identity.items()):
                row.update(identity)
                changed = True
        body = ((json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                if changed else original)
        rebound[name] = body
        actual[name] = body
    return rebound
