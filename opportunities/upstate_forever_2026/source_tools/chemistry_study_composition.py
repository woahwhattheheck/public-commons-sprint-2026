"""Compose Chemistry lineage into the maintained selected-study source.

This module edits only declared joins on the actual receiving application.
All other source, selection policies and producer callbacks remain byte-for-byte.
"""
from __future__ import annotations

import ast

CORE = "model/study_transfer.py"
REPORT = "model/scientific_report_study_transfer.py"
MARKER = "# Chemistry selected-study lineage: v1"
IMPORT = "from . import chemistry_study_transfer as chemistry_transfer\n"
CONSTANTS = """# Chemistry selected-study lineage: v1
IMMUTABLE_KINDS = (*IMMUTABLE_KINDS, *chemistry_transfer.IMMUTABLE_KINDS)
DOCUMENTS = {**DOCUMENTS, **chemistry_transfer.DOCUMENTS}
LOCKS = {**LOCKS, **chemistry_transfer.LOCKS}
LABELS = {**LABELS, **chemistry_transfer.LABELS}
"""
VISIT = """        elif chemistry_transfer.visit(self, kind, key, value, reason):
            pass
"""
LOCK_BODY = """    for relative in chemistry_transfer.lock_paths(closure):
        token = ("original-study-owner-lock", relative)
        if token not in already:
            stack.enter_context(held(closure.root / relative, blocking=False))
            already.add(token)
"""
SOURCE = """    from . import chemistry_study_transfer
    chemistry_study_transfer.include_source(closure, collection_id, entry)
"""


def _one(values, label):
    values = list(values)
    if len(values) != 1:
        raise ValueError("Compose the current selected-study " + label + " before installing Chemistry")
    return values[0]


def _module(source):
    return ast.parse(source)


def _function(tree, name):
    return _one((node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                 and node.name == name), name)


def _line_offset(source, line):
    return sum(len(value) for value in source.splitlines(keepends=True)[:line - 1])


def _insert(source, edits):
    for offset, body in sorted(edits, reverse=True):
        source = source[:offset] + body + source[offset:]
    ast.parse(source)
    return source


def _exact_once(source, body, label):
    if source.count(body) != 1:
        raise ValueError("Current Chemistry study join is partial or repeated: " + label)


def patch_core(source):
    if MARKER in source:
        for body, label in ((IMPORT, "import"), (CONSTANTS, "record kinds"),
                            (VISIT, "record visitor"), (LOCK_BODY, "producer lock")):
            _exact_once(source, body, label)
        ast.parse(source)
        return source
    if "chemistry_transfer" in source:
        raise ValueError("Reconcile the existing Chemistry transfer callback before installation")
    tree = _module(source)
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)]
    labels = _one((node for node in assignments if any(
        isinstance(target, ast.Name) and target.id == "LABELS" for target in node.targets)), "labels")
    first = _one((node for node in assignments if any(
        isinstance(target, ast.Name) and target.id == "SELECTION_SCHEMA" for target in node.targets)),
        "selection schema")
    owner = _one((node for node in tree.body if isinstance(node, ast.ClassDef)
                  and node.name == "_Closure"), "closure class")
    visitor = _function(owner, "_visit")
    reference = "        elif calibration_transfer.visit(self, kind, key, value, reason):\n"
    section = ast.get_source_segment(source, visitor)
    if section is None or section.count(reference) != 1:
        raise ValueError("Compose the maintained calibration visitor before Chemistry installation")
    # The exact existing peer callback is a stable insertion anchor, retained.
    visitor_offset = source.index(reference, _line_offset(source, visitor.lineno))
    locks = _function(tree, "_capture_locks")
    first_lock_statement = locks.body[0]
    if (isinstance(first_lock_statement, ast.Expr)
            and isinstance(first_lock_statement.value, ast.Constant)
            and isinstance(first_lock_statement.value.value, str)):
        first_lock_statement = locks.body[1]
    joined = _insert(source, [
        (_line_offset(source, first.lineno), IMPORT + "\n"),
        (_line_offset(source, labels.end_lineno + 1), "\n" + CONSTANTS),
        (visitor_offset, VISIT),
        (_line_offset(source, first_lock_statement.lineno), LOCK_BODY),
    ])
    for body, label in ((IMPORT, "import"), (CONSTANTS, "record kinds"),
                        (VISIT, "record visitor"), (LOCK_BODY, "producer lock")):
        _exact_once(joined, body, label)
    return joined


def patch_report(source):
    if "chemistry_study_transfer" in source:
        _exact_once(source, SOURCE, "ordered source callback")
        ast.parse(source)
        return source
    tree = _module(source)
    function = _function(tree, "_source")
    returned = _one((node for node in function.body if isinstance(node, ast.Return)),
                    "ordered source return")
    if not isinstance(returned.value, ast.Dict):
        raise ValueError("The maintained source resolver must return its original binding")
    keys = [node.value for node in returned.value.keys if isinstance(node, ast.Constant)]
    if not {"schema", "source_collection_id", "source_id", "body_sha256", "member_sha256"}.issubset(keys):
        raise ValueError("Receive the current saved-report source-binding resolver")
    joined = _insert(source, [(_line_offset(source, returned.lineno), SOURCE)])
    _exact_once(joined, SOURCE, "ordered source callback")
    return joined


def compose(sources):
    """Return complete current postimages for the existing two shared modules."""
    return {CORE: patch_core(sources[CORE]), REPORT: patch_report(sources[REPORT])}
