#!/usr/bin/env python3
"""Read the already-running collection API through its maintained private session.

No server is started, no fixed port is assumed, and the session capability is
never returned or included in command arguments. Use the received interpreter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath
import http.client
import sys
import urllib.parse

READ_ROUTES = frozenset(("/api/whoami", "/api/state", "/api/extensions",
                         "/api/runtime", "/api/task", "/api/native-job", "/api/run-log"))


class OpeningRequired(RuntimeError):
    """The collection must first be opened through its root launcher."""


def collection_member(root: Path, name: str, *, required: bool = True) -> Path:
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or "\0" in name or name.startswith("/")
            or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError("Select a contained collection-relative member")
    path = root.joinpath(*PurePosixPath(name).parts)
    for candidate in (path, *path.parents):
        if candidate == root:
            break
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("A collection member must not be an alias")
    selected = path.resolve(strict=required)
    if not selected.is_relative_to(root):
        raise ValueError("The selected collection member leaves its folder")
    return selected


def receiving_binding(manifest: dict) -> dict | None:
    """Retain either supported own-data layout used by the collection opener."""
    studies = manifest.get("studies")
    if not isinstance(studies, list) or any(not isinstance(row, dict) for row in studies):
        raise ValueError("The collection needs its retained study list")
    own = [row for row in studies if row.get("family") == "own-data"]
    explicit = manifest.get("receiving_workspace")
    if len(own) > 1:
        raise ValueError("The collection has more than one own-data Workspace")
    if own:
        row = own[0]
        if any(not isinstance(row.get(key), str) or not row[key]
               for key in ("workspace", "project_id", "title")):
            raise ValueError("The retained own-data Workspace selection is incomplete")
        if explicit is not None and (not isinstance(explicit, dict) or any(
                explicit.get(key) != row[key] for key in ("workspace", "project_id"))):
            raise ValueError("The receiving selection differs from the retained own-data row")
        return {"workspace": row["workspace"], "project_id": row["project_id"],
                "title": row["title"], "purpose": "own-data"}
    if explicit is not None and (not isinstance(explicit, dict)
            or explicit.get("purpose") != "own-data"):
        raise ValueError("The receiving Workspace selection is incomplete")
    return explicit


def state_directory(collection: Path, session) -> Path:
    key = hashlib.sha256(str(collection).encode()).hexdigest()[:20]
    identity = "collection-" + key
    resolver = getattr(session, "state_directory", None)
    if resolver is not None:
        # The maintained opener owns native locations and existing Mac migration.
        return Path(resolver(identity)).expanduser().resolve()
    # Retained R5/Linux source predates the shared selector. Reuse that original
    # layout only when operating the older source, rather than moving its state.
    local = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME")
                 or (Path.home() / ".local/state"))
    return (local / "ecosystem-workbench" / identity).expanduser().resolve()


def read(collection: str | Path, route: str = "/api/whoami", *,
         operator_state: str | Path | None = None, query: dict[str, str] | None = None) -> dict:
    """Use original selection/readiness checks, then issue one read-only request."""
    root = Path(collection).expanduser().resolve(strict=True)
    manifest = json.loads((root / "STUDIES.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != "upstate.portable-study-collection/v1":
        raise ValueError("Select the complete collection containing STUDIES.json")
    application = collection_member(root, manifest["application"])
    current_application = Path(__file__).resolve().parents[2]
    if application != current_application:
        raise ValueError("Run this reader from the selected collection's own application")
    if route not in READ_ROUTES:
        raise ValueError("Select a documented read-only API route")
    parameters = dict(query or {})
    if any(not isinstance(k, str) or not isinstance(v, str) or not k
           or any(c in k + v for c in "\r\n\0") for k, v in parameters.items()):
        raise ValueError("API query names and values must be ordinary strings")
    if any(k.casefold() in ("token", "capability", "authorization") for k in parameters):
        raise ValueError("Session authentication is handled privately, not in query arguments")
    sys.path.insert(0, str(application))
    from source_tools import workbench_session as session
    state = (Path(operator_state).expanduser().resolve(strict=True) if operator_state
             else state_directory(root, session))
    if state.is_relative_to(root):
        raise ValueError("Private operator state must remain outside the delivered collection")

    path = state / "workbench-session.json"
    if not path.exists():
        raise OpeningRequired("Open the extracted collection using Open_Workbench.cmd on Windows "
                              "or Open_Workbench.command on macOS, then repeat this request.")
    record = session._json(path)
    selection = record.get("selection")
    if not isinstance(selection, dict) or selection.get("application") != str(application):
        raise ValueError("The retained session belongs to another application folder")
    received = receiving_binding(manifest)
    candidates = [received] if isinstance(received, dict) else manifest.get("studies", [])
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("The collection has no retained Workspace selection")
    matched = False
    for row in candidates:
        if not isinstance(row, dict):
            raise ValueError("The collection contains an invalid Workspace entry")
        workspace = collection_member(root, row["workspace"])
        project = json.loads((workspace / "workspace.json").read_text(encoding="utf-8"))
        if (not isinstance(project, dict) or project.get("schema") != "upstate.scientific-workbench/v1"
                or project.get("id") != row["project_id"]):
            raise ValueError("A Workspace differs from the collection's original identity")
        matched |= (selection.get("workspace") == str(workspace)
                    and selection.get("project_id") == row["project_id"])
    if not matched:
        raise ValueError("The retained session belongs to another collection Workspace")
    try:
        current = session.existing_session(path, selection)
        if current is None:
            raise OpeningRequired("This session has closed. Reopen the collection through its root launcher.")
        suffix = "?" + urllib.parse.urlencode(parameters) if parameters else ""
        return session._request(current["operator_url"], route + suffix)
    except (ConnectionError, TimeoutError, http.client.HTTPException) as error:
        raise OpeningRequired("The workbench is not responding. Reopen this collection through "
                              "its root launcher and repeat the request.") from error


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route", choices=sorted(READ_ROUTES), nargs="?", default="/api/whoami")
    parser.add_argument("--collection", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--operator-state", type=Path,
                        help="Only needed when the root launcher used an explicit private state folder")
    parser.add_argument("--query", action="append", default=[], metavar="NAME=VALUE")
    args = parser.parse_args(argv)
    try:
        query = {}
        for item in args.query:
            name, separator, value = item.partition("=")
            if not separator or not name or name in query:
                raise ValueError("Use each query name once, as NAME=VALUE")
            query[name] = value
        response = read(args.collection, args.route, operator_state=args.operator_state, query=query)
        print(json.dumps(response, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        # Keep malformed private record details and session URLs out of output.
        if isinstance(error, (OpeningRequired, ValueError)) and not isinstance(error, json.JSONDecodeError):
            message = str(error)
        else:
            message = "Could not read the current workbench session. Reopen the collection and use its own reader."
        print("Workbench API: " + message, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
