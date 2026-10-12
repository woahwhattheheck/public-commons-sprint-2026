"""Retain and continue one explicit portal workspace creation.

These small create-only records bind a private slot before directory creation.
All database initialization and its recovery remain in the original Workbench.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import stat
import uuid

from groundwater_workspace import Workbench
from groundwater_workspace.common import json_text

from .policy import PortalProblem, private_directory, validate_slot

SCHEMA = "groundwater.tethys-creation.v1"


def _identifier(value):
    try:
        parsed = uuid.UUID(value)
        if str(parsed) != value or parsed.version != 4:
            raise ValueError("not canonical uuid4")
    except (AttributeError, TypeError, ValueError):
        raise PortalProblem("portal_creation_id_invalid", "Use the original creation identifier from this portal form.")
    return value


def _exists(path):
    return path.exists() or path.is_symlink()


def _read(path, *, limit=16384):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode) or info.st_size > limit
            or stat.S_IMODE(info.st_mode) & 0o077
            or (hasattr(os, "geteuid") and info.st_uid != os.geteuid())
        ):
            raise PortalProblem("portal_creation_record_invalid", "The retained creation record is not a private regular file.", 409)
        with os.fdopen(fd, "rb") as held:
            fd = None
            raw = held.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("too large")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict) or json_text(value).encode("utf-8") != raw:
            raise ValueError("not canonical")
        return value
    except (UnicodeError, ValueError, RecursionError):
        raise PortalProblem("portal_creation_record_invalid", "The retained creation record is incomplete or changed. Preserve it for recovery.", 409)
    finally:
        if fd is not None:
            os.close(fd)


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _publish(path, value, *, staging=None):
    """Complete and fsync bytes before create-only publication of the final name."""
    raw = json_text(value).encode("utf-8")
    staging = private_directory(staging or path.parent)
    temporary = staging / (path.name + "." + uuid.uuid4().hex + ".pending")
    fd = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0), 0o600,
    )
    try:
        with os.fdopen(fd, "wb") as held:
            fd = None
            held.write(raw)
            held.flush()
            os.fsync(held.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
            _sync_directory(path.parent)
        except FileExistsError:
            if _read(path) != value:
                raise PortalProblem("portal_creation_record_conflict", "A different original creation record already exists.", 409)
    finally:
        if fd is not None:
            os.close(fd)
        # This exact temporary name belongs to this call. Retained final records
        # and any other unfinished original writer are never removed.
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@contextmanager
def _lock(context):
    parent = private_directory(context.root / "creation_intents", create=True)
    path = parent / (context.slot + ".lock")
    fd = os.open(
        path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0), 0o600,
    )
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077
            or (hasattr(os, "geteuid") and info.st_uid != os.geteuid())
        ):
            raise PortalProblem("portal_creation_lock_invalid", "The original creation lock is not a private regular file.", 409)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield parent
    finally:
        os.close(fd)


def _binding(context, user):
    return {
        "scope": context.scope,
        "slot": context.slot,
        "root": str(context.root),
        "container": str(context.container),
        "workspace": str(context.workspace),
        "creator_user_id": str(user.pk),
    }


def _validate(intent, context, user, creation_id=None):
    if intent.get("schema") != SCHEMA:
        raise PortalProblem("portal_creation_record_invalid", "The original creation schema is unsupported.", 409)
    for key, expected in _binding(context, user).items():
        if intent.get(key) != expected:
            raise PortalProblem(
                "portal_creation_binding_changed",
                "This creation belongs to another original account, scope or private slot. Its retained material was not adopted.",
                409, field=key,
            )
    _identifier(intent.get("creation_id"))
    _identifier(intent.get("initial_workspace_id"))
    if creation_id is not None and intent["creation_id"] != creation_id:
        raise PortalProblem(
            "portal_creation_already_started",
            "This slot has an original creation. Use Continue original creation on the launcher.",
            409, original_creation_id=intent["creation_id"],
        )
    if not isinstance(intent.get("actor"), str) or not isinstance(intent.get("created_at"), str):
        raise PortalProblem("portal_creation_record_invalid", "The original creation attribution is incomplete.", 409)
    return intent


def create_or_continue(context, user, creation_id):
    _identifier(creation_id)
    with _lock(context) as parent:
        path = parent / (context.slot + ".json")
        intent = _read(path)
        if intent is None:
            if _exists(context.container):
                raise PortalProblem(
                    "portal_slot_exists",
                    "This slot already has retained material without this creation intent. Reopen or restore it; it was not adopted.",
                    409,
                )
            intent = {
                "schema": SCHEMA,
                **_binding(context, user),
                "creation_id": creation_id,
                "initial_workspace_id": str(uuid.uuid4()),
                "actor": user.get_username(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            _publish(path, intent)  # Must precede the first slot mkdir.
        _validate(intent, context, user, creation_id)

        private_directory(context.container, create=True)
        marker = context.container / "portal-creation.json"
        saved_marker = _read(marker)
        if saved_marker is None:
            if any(context.container.iterdir()):
                raise PortalProblem(
                    "portal_creation_slot_changed",
                    "The original slot has material without its creation marker. Preserve it for operator recovery.",
                    409,
                )
            _publish(marker, intent, staging=parent)
        elif saved_marker != intent:
            raise PortalProblem("portal_creation_slot_changed", "The original private slot marker no longer matches this creation.", 409)
        private_directory(context.workspace, create=True)
        complete_path = context.container / "portal-creation-complete.json"
        completion = _read(complete_path)
        expected_completion = {
            "schema": "groundwater.tethys-creation-complete.v1",
            "creation_id": intent["creation_id"],
            "workspace_id": intent["initial_workspace_id"],
        }
        if completion is not None and completion != expected_completion:
            raise PortalProblem("portal_creation_record_conflict", "The retained creation completion belongs to another identity.", 409)
        database = context.workspace / "groundwater.sqlite"
        if completion is not None or _exists(database):
            context.require_existing()
            workbench = Workbench(context.workspace, existing_only=True)
        else:
            # The core owns initialization.json, its original fixed identity,
            # private temporary SQLite and atomic final publication.
            workbench = Workbench(
                context.workspace, initial_workspace_id=intent["initial_workspace_id"],
            )
        with workbench:
            identity = workbench.state()["workspace"]["id"]
        if identity != intent["initial_workspace_id"]:
            raise PortalProblem(
                "portal_creation_identity_changed",
                "The original database identity differs from this slot's retained creation.",
                409,
            )
        _publish(complete_path, expected_completion)
        return identity


def recoverable_creations(context, user):
    """Read only this account's original intents for the existing launcher."""
    parent = context.root / "creation_intents"
    if not _exists(parent):
        return {}
    private_directory(parent)
    result = {}
    for path in sorted(parent.glob("*.json")):
        slot = path.stem
        try:
            validate_slot(slot)
            intent = _read(path)
            if (
                intent is None or intent.get("schema") != SCHEMA
                or intent.get("scope") != context.scope
                or intent.get("root") != str(context.root)
                or intent.get("slot") != slot
                or intent.get("creator_user_id") != str(user.pk)
            ):
                continue
            _identifier(intent.get("creation_id"))
            _identifier(intent.get("initial_workspace_id"))
            result[slot] = {
                "creation_id": intent["creation_id"],
                "initial_workspace_id": intent["initial_workspace_id"],
            }
        except PortalProblem:
            # Damaged original records remain retained. They are not presented
            # as a new creation or converted into another identity.
            continue
    return result
