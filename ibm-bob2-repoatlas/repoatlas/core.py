"""Source-only authority facade for RepoAtlas.

The mature source analyzer is retained in `_core_source_v1.py`; this module owns
the supported package API and the source-only authority boundary. Caller JSON
cannot self-attest IBM/lablab registration, Bob execution, track publication,
or submission evidence. Ordinary package initialization also retires the
legacy module's direct compile/verify entrypoints so a normal private-submodule
import cannot bypass this facade.

This is cooperative Python-runtime API hardening, not hostile-interpreter or
source-file tamper resistance. A later provider transition still requires a
separately source-bound and reviewed successor.
"""
from __future__ import annotations

import math
import sys
from typing import Any

from . import _core_source_v1 as _source

RepoAtlasError = _source.RepoAtlasError

# Object-mode compilation is a supported public ingress and therefore needs
# explicit code-owned cardinality ceilings independent of the byte parser.
# Keep these aligned with the analyzer's existing maximum admitted file set:
# one change per path, at most one document row per admitted path in the
# conservative envelope, and no per-row reference list larger than the entire
# admitted file universe.
MAX_CHANGES = _source.MAX_FILES
MAX_DOC_ROWS = _source.MAX_FILES
MAX_ROW_REFS = _source.MAX_FILES

# JSON nesting is a product contract, not an interpreter-recursion accident.
MAX_JSON_DEPTH = 256
# Verification accepts caller-supplied object-mode packet/receipt artifacts.
# Bound total JSON node work independently of CPython's recursion limit while
# leaving generous room above any artifact produced from the admitted input.
MAX_ARTIFACT_NODES = _source.MAX_TEXT

# Extend only the interpreter thread-switch interval while one bounded
# verifier-owned snapshot is being taken; restore the caller's prior value
# before canonical serialization.
_ATOMIC_FREEZE_SWITCH_SECONDS = 3600.0


def _preflight_json_depth(data: bytes) -> None:
    depth = 0
    in_string = False
    escaped = False
    for byte in data:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:  # backslash
                escaped = True
            elif byte == 0x22:  # quote
                in_string = False
            continue
        if byte == 0x22:
            in_string = True
        elif byte in (0x5B, 0x7B):  # [ {
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise RepoAtlasError("json_too_deep")
        elif byte in (0x5D, 0x7D) and depth:
            # Syntax/matching remains the JSON decoder's job. This preflight
            # owns only the deterministic upper bound on open nesting.
            depth -= 1


def parse_json_bytes(data: bytes) -> Any:
    # The retained decoder historically accepted bytearray/bytes subclasses
    # accidentally through len()+decode(). Make the public ingress exact and
    # stable so every accepted shape passes the same fences.
    if type(data) is not bytes:
        raise RepoAtlasError("json_bytes_required")
    # Preserve the retained byte-work ceiling *before* the O(n) depth scan.
    # This prevents an oversized adversarial payload from moving work ahead of
    # the already-declared MAX_TEXT bound.
    if len(data) > _source.MAX_TEXT:
        raise RepoAtlasError("input_too_large")
    _preflight_json_depth(data)
    try:
        return _source.parse_json_bytes(data)
    except RepoAtlasError:
        raise
    except RecursionError as exc:
        raise RepoAtlasError("json_too_deep") from exc
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc
    except ValueError as exc:
        # CPython can reject extremely long integer literals before json.loads
        # can produce a JSONDecodeError (sys.set_int_max_str_digits). Keep that
        # runtime-specific parser guard inside RepoAtlas's stable fail-closed
        # error surface rather than letting a raw traceback escape the CLI.
        raise RepoAtlasError("invalid_json") from exc


def _preflight_mapping(value: Any, name: str, maximum_fields: int) -> None:
    """Bound direct-object mapping work before `_source._only()` allocates."""
    if type(value) is not dict:
        return
    if len(value) > maximum_fields:
        raise RepoAtlasError(f"{name}:field_cardinality")
    for key in value:
        # json.loads can only produce string object keys, but escaped lone
        # surrogates are still Python ``str`` values and object-mode callers
        # bypass the parser entirely. Reject non-JSON/pathological/UTF-8-invalid
        # field names before `_source._only()` can embed them in an error string
        # that the UTF-8 CLI would then fail to print.
        if type(key) is not str or len(key) > 256:
            raise RepoAtlasError(f"{name}:field_name")
        try:
            key.encode("utf-8", "strict")
        except UnicodeEncodeError as exc:
            raise RepoAtlasError(f"{name}:field_name") from exc


def _preflight_cardinality(raw: Any) -> None:
    """Bound every repeated object-mode structure before expensive traversal."""
    if type(raw) is not dict:
        return

    _preflight_mapping(raw, "root", 9)

    for name, limit in (
        ("changes", MAX_CHANGES),
        ("adrs", MAX_DOC_ROWS),
        ("runbooks", MAX_DOC_ROWS),
    ):
        rows = raw.get(name, [])
        if type(rows) is list and len(rows) > limit:
            raise RepoAtlasError(f"{name}:cardinality")

    # `_source._validate` already bounds the top-level files list before
    # iterating it. Only inspect nested refs when that outer list is itself
    # within the retained bound, so this preflight cannot be turned into a new
    # unbounded traversal.
    files = raw.get("files", [])
    if type(files) is list and len(files) <= _source.MAX_FILES:
        for i, row in enumerate(files):
            _preflight_mapping(row, f"files[{i}]", 7)
            if type(row) is not dict:
                continue
            tests = row.get("tests", [])
            if type(tests) is list and len(tests) > MAX_ROW_REFS:
                raise RepoAtlasError(f"files[{i}].tests:cardinality")

    # Dependency count is already source-bounded before row traversal. Mirror
    # that outer condition only so direct-object row maps are bounded before
    # `_source._only()` constructs an attacker-sized unknown-key set.
    dependencies = raw.get("dependencies", [])
    if type(dependencies) is list and len(dependencies) <= _source.MAX_EDGES:
        for i, row in enumerate(dependencies):
            _preflight_mapping(row, f"dependencies[{i}]", 3)

    changes = raw.get("changes", [])
    if type(changes) is list and len(changes) <= MAX_CHANGES:
        for i, row in enumerate(changes):
            _preflight_mapping(row, f"changes[{i}]", 4)

    for name in ("adrs", "runbooks"):
        rows = raw.get(name, [])
        if type(rows) is not list or len(rows) > MAX_DOC_ROWS:
            continue
        for i, row in enumerate(rows):
            _preflight_mapping(row, f"{name}[{i}]", 3)
            if type(row) is not dict:
                continue
            covers = row.get("covers", [])
            if type(covers) is list and len(covers) > MAX_ROW_REFS:
                raise RepoAtlasError(f"{name}[{i}].covers:cardinality")

    _preflight_mapping(raw.get("provider"), "provider", 4)


def _validate_source_input(raw: Any) -> dict[str, Any]:
    _preflight_cardinality(raw)
    try:
        normalized = _source._validate(raw)
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc
    except RecursionError as exc:
        raise RepoAtlasError("input_too_deep") from exc

    if any(normalized["provider"].values()):
        raise RepoAtlasError("provider:external_evidence_requires_bound_successor")

    # Bind the admitted file manifest to the change image it claims to
    # describe. Added/modified paths carry the post-image; deleted paths carry
    # the pre-image. Missing manifest rows remain analyzer findings, but a row
    # that exists may not contradict the corresponding change digest.
    files_by_path = {row["path"]: row for row in normalized["files"]}
    for change in normalized["changes"]:
        manifest_row = files_by_path.get(change["path"])
        if manifest_row is None:
            continue
        expected_sha = (
            change["before_sha256"]
            if change["change"] == "deleted"
            else change["after_sha256"]
        )
        if manifest_row["sha256"] != expected_sha:
            raise RepoAtlasError(
                f"changes:file_manifest_sha_mismatch:{change['path']}"
            )
    return normalized


def _json_string_canonical_size(value: str, name: str, remaining: int) -> int:
    """Return exact UTF-8 JSON string bytes without allocating encoded output."""
    # Every Unicode scalar needs at least one output byte plus the two quotes.
    # This O(1) lower bound rejects arbitrarily large strings before scanning.
    if len(value) + 2 > remaining:
        raise RepoAtlasError(f"verify:{name}_too_complex")

    size = 2
    short_escapes = {0x08, 0x09, 0x0A, 0x0C, 0x0D, 0x22, 0x5C}
    for char in value:
        codepoint = ord(char)
        if 0xD800 <= codepoint <= 0xDFFF:
            raise RepoAtlasError(f"verify:{name}_not_canonical_json")
        if codepoint in short_escapes:
            size += 2
        elif codepoint < 0x20:
            size += 6
        elif codepoint < 0x80:
            size += 1
        elif codepoint < 0x800:
            size += 2
        elif codepoint < 0x10000:
            size += 3
        else:
            size += 4
        if size > remaining:
            raise RepoAtlasError(f"verify:{name}_too_complex")
    return size


def _canonical_verified_artifact(
    value: Any,
    name: str,
    max_canonical_bytes: int,
    _get_switch_interval=sys.getswitchinterval,
    _set_switch_interval=sys.setswitchinterval,
) -> bytes:
    """Freeze one coherent supplied packet/receipt generation under bounded work.

    The verifier must not assemble an impossible artifact by reading sibling
    containers from different caller generations.  CPython can otherwise
    switch Python threads between exact-dict/list reads even though each
    individual read is callback-free.  This boundary temporarily extends the
    interpreter thread-switch interval only across the bounded, non-blocking
    preflight+freeze.  The prior interval is restored before serialization.

    A shape-first pass gives nesting errors precedence over byte-budget errors.
    The byte-work ceiling remains O(trusted expected artifact): small ordinary
    tamper can serialize and become a semantic mismatch, while large scalar or
    alias amplification still fails before unbounded serialization.
    """
    if type(max_canonical_bytes) is not int or max_canonical_bytes < 0:
        raise RepoAtlasError(f"verify:{name}_too_complex")

    work_byte_limit = max_canonical_bytes

    def preflight_shape() -> None:
        stack: list[tuple[Any, int]] = [(value, 0)]
        remaining_nodes = MAX_ARTIFACT_NODES - 1

        while stack:
            current, container_depth = stack.pop()
            current_type = type(current)

            if current_type is dict:
                next_depth = container_depth + 1
                if next_depth > MAX_JSON_DEPTH:
                    raise RepoAtlasError(f"verify:{name}_too_deep")
                member_count = len(current)
                if member_count > remaining_nodes:
                    raise RepoAtlasError(f"verify:{name}_too_complex")
                remaining_nodes -= member_count
                try:
                    items = list(current.items())
                except RuntimeError as exc:
                    raise RepoAtlasError(
                        f"verify:{name}_generation_changed"
                    ) from exc
                if len(items) != member_count:
                    raise RepoAtlasError(f"verify:{name}_generation_changed")
                for key, item in reversed(items):
                    if type(key) is not str:
                        raise RepoAtlasError(
                            f"verify:{name}_not_canonical_json"
                        )
                    stack.append((item, next_depth))
                continue

            if current_type is list:
                next_depth = container_depth + 1
                if next_depth > MAX_JSON_DEPTH:
                    raise RepoAtlasError(f"verify:{name}_too_deep")
                member_count = len(current)
                if member_count > remaining_nodes:
                    raise RepoAtlasError(f"verify:{name}_too_complex")
                remaining_nodes -= member_count
                items = list(current)
                if len(items) != member_count:
                    raise RepoAtlasError(f"verify:{name}_generation_changed")
                for index in range(member_count - 1, -1, -1):
                    stack.append((items[index], next_depth))
                continue

            if (
                current is None
                or current_type is bool
                or current_type is str
                or current_type is int
                or current_type is float
            ):
                continue
            raise RepoAtlasError(f"verify:{name}_not_canonical_json")

    def freeze_generation() -> Any:
        root: list[Any] = [None]
        stack: list[tuple[Any, int, Any, Any]] = [(value, 0, root, 0)]
        remaining_nodes = MAX_ARTIFACT_NODES - 1
        remaining_bytes = work_byte_limit

        def charge(amount: int) -> None:
            nonlocal remaining_bytes
            if amount < 0 or amount > remaining_bytes:
                raise RepoAtlasError(f"verify:{name}_too_complex")
            remaining_bytes -= amount

        while stack:
            current, container_depth, parent, slot = stack.pop()
            current_type = type(current)

            if current_type is dict:
                next_depth = container_depth + 1
                if next_depth > MAX_JSON_DEPTH:
                    raise RepoAtlasError(f"verify:{name}_too_deep")
                member_count = len(current)
                if member_count > remaining_nodes:
                    raise RepoAtlasError(f"verify:{name}_too_complex")
                remaining_nodes -= member_count
                try:
                    items = list(current.items())
                except RuntimeError as exc:
                    raise RepoAtlasError(
                        f"verify:{name}_generation_changed"
                    ) from exc
                if len(items) != member_count:
                    raise RepoAtlasError(f"verify:{name}_generation_changed")
                frozen_dict: dict[str, Any] = {}
                parent[slot] = frozen_dict
                charge(2 + member_count + max(member_count - 1, 0))
                for key, _ in items:
                    if type(key) is not str:
                        raise RepoAtlasError(
                            f"verify:{name}_not_canonical_json"
                        )
                    charge(
                        _json_string_canonical_size(
                            key, name, remaining_bytes
                        )
                    )
                    frozen_dict[key] = None
                for key, item in reversed(items):
                    stack.append((item, next_depth, frozen_dict, key))
                continue

            if current_type is list:
                next_depth = container_depth + 1
                if next_depth > MAX_JSON_DEPTH:
                    raise RepoAtlasError(f"verify:{name}_too_deep")
                member_count = len(current)
                if member_count > remaining_nodes:
                    raise RepoAtlasError(f"verify:{name}_too_complex")
                remaining_nodes -= member_count
                items = list(current)
                if len(items) != member_count:
                    raise RepoAtlasError(f"verify:{name}_generation_changed")
                frozen_list: list[Any] = [None] * member_count
                parent[slot] = frozen_list
                charge(2 + max(member_count - 1, 0))
                for index in range(member_count - 1, -1, -1):
                    stack.append(
                        (items[index], next_depth, frozen_list, index)
                    )
                continue

            if current is None:
                charge(4)
                parent[slot] = None
                continue
            if current_type is bool:
                charge(4 if current else 5)
                parent[slot] = current
                continue
            if current_type is str:
                charge(
                    _json_string_canonical_size(
                        current, name, remaining_bytes
                    )
                )
                parent[slot] = current
                continue
            if current_type is int:
                bits = abs(current).bit_length()
                minimum_digits = 1 if bits == 0 else ((bits - 1) // 4) + 1
                if (
                    minimum_digits + (1 if current < 0 else 0)
                    > remaining_bytes
                ):
                    raise RepoAtlasError(f"verify:{name}_too_complex")
                try:
                    rendered = str(current)
                except ValueError as exc:
                    raise RepoAtlasError(
                        f"verify:{name}_too_complex"
                    ) from exc
                charge(len(rendered))
                parent[slot] = current
                continue
            if current_type is float:
                if not math.isfinite(current):
                    raise RepoAtlasError(
                        f"verify:{name}_not_canonical_json"
                    )
                charge(len(repr(current)))
                parent[slot] = current
                continue
            raise RepoAtlasError(f"verify:{name}_not_canonical_json")

        return root[0]

    previous_interval = _get_switch_interval()
    changed_interval = previous_interval < _ATOMIC_FREEZE_SWITCH_SECONDS
    if changed_interval:
        _set_switch_interval(_ATOMIC_FREEZE_SWITCH_SECONDS)
    try:
        preflight_shape()
        frozen = freeze_generation()
    finally:
        if changed_interval:
            _set_switch_interval(previous_interval)

    try:
        canonical = _source._canonical(frozen)
    except RepoAtlasError:
        raise
    except RecursionError as exc:
        raise RepoAtlasError(f"verify:{name}_too_deep") from exc
    if len(canonical) > work_byte_limit:
        raise RepoAtlasError(f"verify:{name}_too_complex")
    return canonical

def _build_source_only_api():
    # Capture the reviewed analyzer once, then retire its ordinary module-level
    # compiler/verifier names. Because importing a submodule initializes the
    # parent package first, `import repoatlas._core_source_v1` cannot recover a
    # second normal compiler surface after this package has initialized.
    source_compile = _source.compile_packet
    for name in ("compile_packet", "verify_bundle"):
        if hasattr(_source, name):
            delattr(_source, name)

    def compile_packet(raw: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        _validate_source_input(raw)
        try:
            return source_compile(raw)
        except UnicodeEncodeError as exc:
            raise RepoAtlasError("invalid_unicode_scalar") from exc
        except RecursionError as exc:
            raise RepoAtlasError("input_too_deep") from exc

    def verify_bundle(raw: Any, packet: Any, receipt: Any) -> bool:
        _validate_source_input(raw)
        expected_packet, expected_receipt = compile_packet(raw)
        # Artifact identity is canonical serialized identity, not Python's
        # loose object equality. In particular, bool is a subclass of int, so
        # dict equality treats False == 0 and True == 1 even though those are
        # distinct JSON artifacts with different content-addressed bytes.
        expected_packet_bytes = _source._canonical(expected_packet)
        expected_receipt_bytes = _source._canonical(expected_receipt)
        def same_top_level_shape(candidate: Any, expected: dict[str, Any]) -> bool:
            if type(candidate) is not dict or len(candidate) != len(expected):
                return False
            return all(key in candidate for key in expected)

        try:
            actual_packet = _canonical_verified_artifact(
                packet, "packet", len(expected_packet_bytes)
            )
        except RepoAtlasError as exc:
            # A same-schema ordinary tamper can be a few bytes longer than the
            # trusted packet. Preserve the historical semantic mismatch label
            # without widening the exact work ceiling or serializing past it.
            if (
                str(exc) == "verify:packet_too_complex"
                and same_top_level_shape(packet, expected_packet)
            ):
                raise RepoAtlasError("verify:packet_mismatch") from exc
            raise
        if actual_packet != expected_packet_bytes:
            raise RepoAtlasError("verify:packet_mismatch")

        try:
            actual_receipt = _canonical_verified_artifact(
                receipt, "receipt", len(expected_receipt_bytes)
            )
        except RepoAtlasError as exc:
            if (
                str(exc) == "verify:receipt_too_complex"
                and same_top_level_shape(receipt, expected_receipt)
            ):
                raise RepoAtlasError("verify:receipt_mismatch") from exc
            raise
        if actual_receipt != expected_receipt_bytes:
            raise RepoAtlasError("verify:receipt_mismatch")
        return True

    return compile_packet, verify_bundle


compile_packet, verify_bundle = _build_source_only_api()
del _build_source_only_api