# SPDX-License-Identifier: MIT
"""Offline Learning exchange context and atomic guards over the original writer."""
from __future__ import annotations
import copy
import re
from pathlib import Path

CONTEXT_SCHEMA = "stellar-forge.grant-analyst-learning-context.v1"
GUARD_SCHEMA = "stellar-forge.grant-analyst-learning-guard.v1"
GUARD_FIELD = "_merchantLearningExchange"

def require(value, message):
    if not value:
        raise ValueError(message)

def digest(core, value):
    return core.sha(core.public_json(value).encode("utf-8"))

def selection(value):
    require(isinstance(value, dict), "Select a complete Learning exchange context.")
    mode = value.get("mode")
    keys = {"mode", "cycle", "action"} if mode == "action" else {"mode", "cycle", "edition", "grantIds"}
    require(mode in ("action", "review") and set(value) == keys,
            "Choose one original action or one complete cycle review.")
    require(isinstance(value["cycle"], str) and value["cycle"], "Select the original Learning cycle.")
    if mode == "action":
        require(isinstance(value["action"], str) and value["action"], "Select the original Learning action.")
    else:
        require(isinstance(value["edition"], str) and value["edition"], "Select the review source edition.")
        refs = value["grantIds"]
        require(isinstance(refs, list) and refs and all(isinstance(x, str) and x for x in refs)
                and len(refs) == len(set(refs)), "Select each original grant reference once.")
    return copy.deepcopy(value)

def build_context(core, learning, root, current, supplied):
    """The caller holds the original workspace lock for this entire capture."""
    chosen = selection(supplied)
    learning.validate(core, current)
    cycle = learning.selected(current, chosen["cycle"])
    book = core.codebook(current)
    if chosen["mode"] == "action":
        learning.current_action(cycle, chosen["action"])
        captured, comparison = None, None
    else:
        captured = learning.snapshot(core, root, current, chosen["edition"], book["id"], chosen["grantIds"])
        comparison = core.compare(root, current, cycle["baseline"]["report"]["edition"]["id"], chosen["edition"])
    snapshots = [cycle["baseline"]] + [row["snapshot"] for row in cycle["reviews"]]
    if captured is not None:
        snapshots.append(captured)
    edition_ids, book_ids = [], [book["id"]]
    for snapshot in snapshots:
        for key, ids in ((snapshot["report"]["edition"]["id"], edition_ids),
                         (snapshot["report"]["codebook"]["id"], book_ids)):
            if key not in ids:
                ids.append(key)
    originals = []
    for identity in edition_ids:
        item = core.edition(current, identity)
        core.grant_package(root, item)
        raw = core.regular(Path(root) / "sources" / (item["sha256"] + ".json"))
        require(len(raw) == item["bytes"] and core.sha(raw) == item["sha256"],
                "The retained original grant source changed.")
        originals.append({"edition": copy.deepcopy(item), "bytes": len(raw),
                          "sha256": core.sha(raw), "text": raw.decode("utf-8")})
    books = []
    for identity in book_ids:
        rows = [row for row in current["codebooks"] if row["id"] == identity]
        require(len(rows) == 1, "A referenced original study codebook is unavailable.")
        books.append(copy.deepcopy(rows[0]))
    result = {"schema": CONTEXT_SCHEMA, "workspaceId": current["id"], "workspaceName": current["name"],
              "createdAt": core.now(), "selection": chosen, "cycle": copy.deepcopy(cycle),
              "cycleSha256": digest(core, cycle), "selectedCodebook": copy.deepcopy(book),
              "selectedCodebookSha256": digest(core, book), "codebooks": books, "sources": originals,
              "report": copy.deepcopy(captured["report"]) if captured else None,
              "comparison": comparison, "snapshot": captured}
    if captured is not None:
        result["snapshotSha256"] = captured["sha256"]
    return result

def install_guard(core, learning):
    """Run the extra comparison inside the unchanged mutation() lock and cache."""
    original = learning.apply
    require(not getattr(original, "_merchant_learning_exchange", False),
            "The Learning exchange guard is already installed in this host.")
    def apply(actual_core, root, current, action, body):
        if GUARD_FIELD not in body:
            return original(actual_core, root, current, action, body)
        require(actual_core is core and action in ("cycle-action", "cycle-review"),
                "Use the original Learning action or complete review writer.")
        guard = body[GUARD_FIELD]
        require(isinstance(guard, dict), "Retain the complete reviewed Learning exchange guard.")
        chosen = selection(guard.get("selection"))
        keys = {"schema", "workspaceId", "cycleSha256", "selectedCodebookSha256",
                "packetSha256", "returnSha256", "selection"}
        if chosen["mode"] == "review":
            keys.add("snapshotSha256")
        require(set(guard) == keys and guard["schema"] == GUARD_SCHEMA,
                "The Learning exchange guard differs from its reviewed selection.")
        for key in keys - {"schema", "workspaceId", "selection"}:
            require(isinstance(guard[key], str) and re.fullmatch(r"[a-f0-9]{64}", guard[key]),
                    "Retain each complete Learning exchange content identity.")
        require(guard["workspaceId"] == current["id"] and chosen["cycle"] == body.get("cycle"),
                "This return belongs to a different original workspace or cycle.")
        cycle = learning.selected(current, chosen["cycle"])
        require(digest(core, cycle) == guard["cycleSha256"],
                "The cycle changed after comparison. Keep the returned work, refresh and resolve its changes.")
        book = core.codebook(current)
        require(digest(core, book) == guard["selectedCodebookSha256"],
                "The study codebook changed after comparison. Review the current evidence before applying.")
        if chosen["mode"] == "action":
            require(action == "cycle-action" and chosen["action"] == body.get("action"),
                    "Apply only the original action selected in this return.")
            learning.current_action(cycle, chosen["action"])
        else:
            require(action == "cycle-review" and chosen["edition"] == body.get("edition")
                    and chosen["grantIds"] == body.get("grantIds") and body.get("codebook") == book["id"],
                    "Keep the complete reviewed source, codebook and grant-reference selection.")
            captured = learning.snapshot(core, root, current, chosen["edition"], book["id"], chosen["grantIds"])
            require(captured["sha256"] == guard["snapshotSha256"],
                    "Grant review evidence changed after comparison. Keep the return and review the new source context.")
        native_body = {key: value for key, value in body.items() if key != GUARD_FIELD}
        return original(actual_core, root, current, action, native_body)
    apply._merchant_learning_exchange = True
    learning.apply = apply
    return original
