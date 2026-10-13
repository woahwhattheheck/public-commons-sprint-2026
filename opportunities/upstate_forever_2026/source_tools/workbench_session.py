"""Portable launch selections and private reuse of the original workbench server.

This module does not run a model, change the server's network binding, or retain
credentials in a portable project. Only the receiving machine's private state
contains the current local operator URL.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import webbrowser

PROFILE_SCHEMA = "upstate.workbench-launch/v1"
SESSION_SCHEMA = "upstate.workbench-local-session/v1"
MAX_JSON_BYTES = 256 * 1024


def _json(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_JSON_BYTES:
            raise ValueError("Select a bounded regular launch or Workspace JSON file")
        body = stream.read(MAX_JSON_BYTES + 1)
        if len(body) != info.st_size or len(body) > MAX_JSON_BYTES:
            raise ValueError("The selected JSON changed while it was read")
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("The selected JSON repeats a field")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("The selected JSON contains a non-finite number")
    value = json.loads(body.decode("utf-8"), object_pairs_hook=object_pairs,
                       parse_constant=invalid)
    if not isinstance(value, dict):
        raise ValueError("Select an original JSON object")
    return value


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _path(value, base):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("Use a nonempty path without null characters")
    path = Path(value).expanduser()
    return (path if path.is_absolute() else base / path).resolve(strict=True)


def _python(value, base):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("Select the receiving machine's Python executable")
    # Keep a virtual environment executable intact; do not resolve its symlink.
    expanded = os.path.expanduser(value)
    if os.sep not in expanded and (not os.altsep or os.altsep not in expanded):
        found = shutil.which(expanded)
        if found is None:
            raise ValueError("The selected Python executable was not found")
        expanded = found
    path = Path(os.path.abspath(expanded if os.path.isabs(expanded) else base / expanded))
    if not path.is_file():
        raise ValueError("The selected Python executable is not a file")
    return path


def _portable(path, root):
    try:
        return Path(path).relative_to(root).as_posix()
    except ValueError:  # External dependencies remain explicit receiving-machine paths.
        return str(path)


def _write(path, value, *, exclusive=False):
    path = Path(path)
    if not path.parent.is_dir():
        raise ValueError("Create the receiving directory before saving this file")
    body = (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path)
        else:
            if path.is_symlink():
                raise ValueError("A private session file cannot be a symbolic link")
            os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


@contextlib.contextmanager
def _launch_lock(state):
    path = state / ".workbench-launch.lock"
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def resolve_selection(args, application):
    profile = _json(args.profile) if args.profile else {}
    if profile and profile.get("schema") != PROFILE_SCHEMA:
        raise ValueError("Select an upstate.workbench-launch/v1 profile")
    base = args.profile.expanduser().resolve(strict=True).parent if args.profile else Path.cwd()
    root = _path(args.application or profile.get("application") or str(application),
                 Path.cwd() if args.application else base)
    workspace = _path(args.workspace or profile.get("workspace") or str(root.parent / "workspace"),
                      Path.cwd() if args.workspace else base)
    if not root.is_dir() or not workspace.is_dir() or not (root / "operator/server.py").is_file():
        raise ValueError("Select the complete original application and its extracted Workspace")
    project = _json(workspace / "workspace.json")
    if project.get("schema") != "upstate.scientific-workbench/v1" or not isinstance(project.get("id"), str):
        raise ValueError("Select an original scientific Workspace")
    expected = profile.get("project_id")
    if expected and expected != project["id"]:
        raise ValueError("The launch profile names another original project; choose a new profile")
    selected_python = args.python_path or os.environ.get("ECOSYSTEMS_PYTHON") or profile.get("python") or sys.executable
    # Command-line/environment relative interpreter paths belong to the current shell.
    python_base = Path.cwd() if args.python_path or os.environ.get("ECOSYSTEMS_PYTHON") else base
    executable = _python(selected_python, python_base)
    native = args.native if args.native is not None else profile.get("native", False)
    port = args.port if args.port is not None else profile.get("port", 0)
    if not isinstance(native, bool) or isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("Choose native true/false and a port from 0 through 65535")
    manifests = args.source_manifest if args.source_manifest is not None else profile.get("source_manifests", [])
    roots = args.source_root if args.source_root is not None else profile.get("source_roots", [])
    if not isinstance(manifests, list) or not isinstance(roots, list):
        raise ValueError("Source selections must be complete path lists")
    manifest_base = Path.cwd() if args.source_manifest is not None else base
    roots_base = Path.cwd() if args.source_root is not None else base
    manifests = [_path(value, manifest_base) for value in manifests]
    roots = [_path(value, roots_base) for value in roots]
    if any(not path.is_file() for path in manifests) or any(not path.is_dir() for path in roots):
        raise ValueError("Select existing source manifests and source directories")
    identity = hashlib.sha256(str(workspace).encode()).hexdigest()[:20]
    local = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME")
                 or (Path.home() / ".local/state"))
    state = (Path(args.operator_state).expanduser() if args.operator_state else
             local / "ecosystem-workbench" / identity).resolve()
    if any(state == item or item in state.parents for item in (root, workspace)):
        raise ValueError("Keep private operator state outside application and scientific Workspace directories")
    selection = {"application": str(root), "workspace": str(workspace),
        "project_id": project["id"], "python": str(executable), "native": native,
        "port": port, "source_manifests": [str(p) for p in manifests],
        "source_roots": [str(p) for p in roots]}
    return selection, state, project


def save_profile(filename, selection):
    path = Path(filename).expanduser().absolute()
    root = path.parent.resolve(strict=True)
    value = {"schema": PROFILE_SCHEMA, "project_id": selection["project_id"],
        "application": _portable(selection["application"], root),
        "workspace": _portable(selection["workspace"], root),
        "python": _portable(selection["python"], root),
        "native": selection["native"], "port": selection["port"],
        "source_manifests": [_portable(p, root) for p in selection["source_manifests"]],
        "source_roots": [_portable(p, root) for p in selection["source_roots"]]}
    _write(path, value, exclusive=True)
    return path


def command_for(selection):
    root = Path(selection["application"])
    arguments = ["--workspace", selection["workspace"]]
    for path in selection["source_manifests"]:
        arguments.extend(["--source-manifest", path])
    for path in selection["source_roots"]:
        arguments.extend(["--source-root", path])
    arguments.extend(["--port", str(selection["port"])])
    if selection["native"]:
        invocation = root / "source_tools/native_runtime/invocation.py"
        if not invocation.is_file():
            raise ValueError("Receive the complete native-runtime-invocation component before using --native")
        command = [selection["python"], "-B", str(invocation),
            "--python", selection["python"], "--application", str(root),
            "--entry", "operator/server.py", "--"]
    else:
        command = [selection["python"], "-B", str(root / "operator/server.py")]
    return command, arguments


def _session_url(value):
    if not isinstance(value, str):
        raise ValueError("The operator did not return its original local session URL")
    parts = urllib.parse.urlsplit(value)
    token = urllib.parse.parse_qs(parts.fragment).get("token", [])
    if (parts.scheme != "http" or parts.hostname != "127.0.0.1" or parts.username
            or parts.password or parts.path != "/" or parts.query
            or not parts.port or len(token) != 1
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token[0])
            or urllib.parse.parse_qs(parts.fragment).keys() != {"token"}):
        raise ValueError("The operator returned an unexpected local session address")
    return parts, token[0]


def _request(url, route):
    parts, token = _session_url(url)
    connection = http.client.HTTPConnection("127.0.0.1", parts.port, timeout=4)
    try:
        connection.request("GET", route, headers={"Authorization": "Bearer " + token,
            "Accept-Encoding": "identity"})
        response = connection.getresponse()
        body = response.read(MAX_JSON_BYTES + 1)
        if response.status != 200 or len(body) > MAX_JSON_BYTES:
            raise RuntimeError("The retained local session did not return an authenticated bounded response")
        value = json.loads(body.decode("utf-8"))
        if not isinstance(value, dict):
            raise RuntimeError("The retained local session returned an invalid response")
        return value
    finally:
        connection.close()


def verify_session(receipt, selection):
    value = _request(receipt["operator_url"], "/api/whoami")
    expected_key = _digest({"directory": selection["workspace"]})
    rows = value.get("workspaces", [])
    if (not isinstance(rows, list) or value.get("default_workspace") != expected_key
            or not any(row.get("id") == expected_key
                and row.get("project_id") == selection["project_id"]
                and row.get("available") is True for row in rows if isinstance(row, dict))):
        raise RuntimeError("The running operator belongs to a different original Workspace")
    return expected_key


def existing_session(path, selection):
    if not path.exists():
        return None
    record = _json(path)
    if record.get("schema") != SESSION_SCHEMA:
        raise ValueError("The private session record has an unknown schema")
    if record.get("hostname") != socket.gethostname():
        raise ValueError("The private session record belongs to another machine; use new private operator state")
    try:
        verify_session(record, selection)
    except ConnectionRefusedError:
        return None
    if record.get("selection") != selection:
        raise ValueError("This original operator is still running with another launch selection. "
                         "Reopen its matching selection or close it from its owning terminal before changing runtime/source paths.")
    return record


def adopt_session(filename, selection):
    """Attach only to an original already-running local server; never restart it."""
    if selection["native"] or selection["source_manifests"] or selection["source_roots"]:
        raise ValueError("Adopt using --plain without source arguments; the original owner's runtime/source selection stays authoritative")
    original = _json(filename)
    key = verify_session(original, selection)
    if (not isinstance(original.get("project"), dict)
            or original["project"].get("id") != selection["project_id"]
            or original.get("workspace_key") != key):
        raise ValueError("Select the exact original server startup receipt")
    return {"schema": SESSION_SCHEMA, "hostname": socket.gethostname(),
        "pid": None, "selection": selection, "workspace_key": key,
        "operator_url": original["operator_url"], "adopted_at": time.time(),
        "launch_origin": "adopted-original-operator"}


def public_status(record, selection, state):
    parts, _ = _session_url(record["operator_url"])
    return {"schema": "upstate.workbench-opening/v1", "state": "running",
        "origin": parts.scheme + "://" + parts.netloc, "recipient_route": "owning-machine-loopback",
        "project_id": selection["project_id"], "application": selection["application"],
        "workspace": selection["workspace"], "operator_state": str(state),
        "python": None if record.get("launch_origin") else selection["python"],
        "native_invocation": None if record.get("launch_origin") else selection["native"],
        "launch_origin": record.get("launch_origin", "maintained-launcher"),
        "pid": record.get("pid"), "workspace_key": record["workspace_key"]}


def _open(record, no_browser):
    if no_browser or not webbrowser.open(record["operator_url"]):
        print("Open this PRIVATE session address on this same machine:\n" + record["operator_url"], flush=True)
    print("Cloud loopback is not a recipient route on another device. Use the existing authorized receiving route.", flush=True)


def _collect(process, lines):
    try:
        assert process.stdout is not None
        for line in process.stdout:
            # Record readiness before the main thread can dequeue or interrupt.
            if not _launcher_signal_ready(process, line):
                lines.put(line)
    finally:
        lines.put(None)



def _launcher_signal_ready(process, line):
    """Accept a handler acknowledgement only from this launcher-owned child."""
    if os.name != "nt":
        return False
    try:
        value = json.loads(line)
    except (ValueError, TypeError):
        return False
    if (isinstance(value, dict)
            and value.get("schema") == "upstate.workbench-launch-signals/v1"
            and value.get("pid") == process.pid
            and value.get("key") == getattr(process, "_workbench_signal_key", None)
            and value.get("signal") == "SIGBREAK"):
        process._workbench_drain_ready = True
        return True
    return False


def _close_owned(process, lines):
    """Drain the actual child, including cancellation before its first receipt.

    Windows terminate() is TerminateProcess. CTRL_BREAK is used only after this
    child's installed Python handler has acknowledged the launch nonce. The
    collector keeps draining stdout while the original operator finishes work.
    """
    requested = False
    explained = False
    while process.poll() is None:
        try:
            if not requested:
                if os.name != "nt":
                    process.terminate()
                    requested = True
                elif getattr(process, "_workbench_drain_ready", False):
                    try:
                        process.send_signal(signal.CTRL_BREAK_EVENT)
                    except OSError as error:
                        if process.poll() is not None:
                            break
                        print("The console shutdown signal could not be delivered: " + str(error)
                              + ". This launcher is still monitoring its own operator. "
                              "Close it normally from its owning console.", flush=True)
                    # One attempt; never repeatedly signal a live process.
                    requested = True
                elif not explained:
                    print("Waiting for this operator to install its startup shutdown handler. "
                          "Keep this terminal open.", flush=True)
                    explained = True
            try:
                line = lines.get(timeout=.5)
            except queue.Empty:
                continue
            if line is None:
                # EOF can precede final process exit; wait without spinning.
                try:
                    process.wait(timeout=.5)
                except subprocess.TimeoutExpired:
                    pass
            elif not _launcher_signal_ready(process, line):
                # A cancelled startup can still produce its private receipt.
                # Do not print that credential while reporting shutdown.
                try:
                    value = json.loads(line)
                except (ValueError, TypeError):
                    value = None
                if not isinstance(value, dict) or "operator_url" not in value:
                    if line.strip():
                        print(line.rstrip(), flush=True)
        except KeyboardInterrupt:
            print("Shutdown is already in progress. Keep this terminal open until the "
                  "original operator finishes its active task.", flush=True)
        except OSError:
            if process.poll() is not None:
                break
            raise
    return process.wait()


def start(selection, state):
    command, arguments = command_for(selection)
    arguments += ["--operator-state", str(state)]
    environment = dict(os.environ)
    if not selection["native"]:
        runtime = Path(selection["python"]).parent.parent
        if (runtime / "share/proj").is_dir():
            environment.setdefault("PROJ_DATA", str(runtime / "share/proj"))
        if (runtime / "share/gdal").is_dir():
            environment.setdefault("GDAL_DATA", str(runtime / "share/gdal"))
    # Plain opening intentionally does not claim native readiness. Native mode
    # delegates all interpreter/GDAL/PROJ selection to the maintained invocation.
    signal_key = os.urandom(24).hex() if os.name == "nt" else None
    if signal_key is not None:
        arguments += ["--launcher-signals", signal_key]
    process = None
    lines = queue.Queue()
    errors = []
    deferred_interrupt = []
    def defer_interrupt(signum, frame):
        deferred_interrupt.append((signum, frame))
    try:
        # Defer the ordinary Ctrl+C handler only while creating our child and
        # starting its collector. Otherwise Popen can return into an interrupted
        # assignment, leaving a real child without its owning cleanup path.
        previous = None
        if (threading.current_thread() is threading.main_thread()
                and signal.getsignal(signal.SIGINT) is signal.default_int_handler):
            previous = signal.signal(signal.SIGINT, defer_interrupt)
        try:
            process = subprocess.Popen(command + arguments, cwd=selection["application"],
                env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
            process._workbench_signal_key = signal_key
            process._workbench_drain_ready = False
            threading.Thread(target=_collect, args=(process, lines), daemon=True).start()
        finally:
            if previous is not None:
                signal.signal(signal.SIGINT, previous)
        if deferred_interrupt:
            raise KeyboardInterrupt
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                line = lines.get(timeout=.5)
            except queue.Empty:
                if process.poll() is not None:
                    break
                continue
            if line is None:
                break
            if _launcher_signal_ready(process, line):
                continue
            try:
                receipt = json.loads(line)
            except ValueError:
                errors.append(line.rstrip())
                errors = errors[-12:]
                continue
            if not isinstance(receipt, dict) or "operator_url" not in receipt:
                errors.append(line.rstrip())
                errors = errors[-12:]
                continue
            _session_url(receipt["operator_url"])
            if os.name == "nt" and not process._workbench_drain_ready:
                raise RuntimeError("Receive the matching maintained server lifecycle source before opening on Windows")
            key = verify_session(receipt, selection)
            record = {"schema": SESSION_SCHEMA, "hostname": socket.gethostname(),
                "pid": process.pid, "selection": selection, "workspace_key": key,
                "operator_url": receipt["operator_url"], "started_at": time.time()}
            return process, lines, record
        raise RuntimeError("The original operator did not start. Preserve any existing owning process; "
            "check its terminal and the selected Python/application.\n" + "\n".join(errors))
    except BaseException:
        if process is not None:
            _close_owned(process, lines)
        raise


def main(application, argv=None):
    parser = argparse.ArgumentParser(description="Open or reopen the original received workbench")
    parser.add_argument("--profile", type=Path, help="Portable launch selection saved beside an extracted project")
    parser.add_argument("--save-profile", type=Path, help="Create a new portable selection; never overwrites an existing file")
    parser.add_argument("--configure-only", action="store_true", help="Save the selection without starting an operator")
    parser.add_argument("--application", help="Complete application directory, overriding the selected profile")
    parser.add_argument("--workspace", help="Original Workspace directory")
    parser.add_argument("--python", dest="python_path", help="Receiving machine's Python executable")
    parser.add_argument("--operator-state", help="Private local operator state outside the project/source")
    native = parser.add_mutually_exclusive_group()
    native.add_argument("--native", dest="native", action="store_true", default=None)
    native.add_argument("--plain", dest="native", action="store_false")
    parser.set_defaults(native=None)
    parser.add_argument("--source-manifest", action="append", default=None)
    parser.add_argument("--source-root", action="append", default=None)
    parser.add_argument("--port", type=int)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--adopt-session", type=Path, help="Private original server startup JSON; reuse that running operator without claiming its runtime configuration")
    parser.add_argument("--status", action="store_true", help="Check existing local session; never starts a process or prints its credential")
    args = parser.parse_args(argv)
    process = None
    session_file = None
    record = None
    try:
        if args.configure_only and not args.save_profile:
            raise ValueError("--configure-only requires a new --save-profile destination")
        selection, state, project = resolve_selection(args, application)
        if args.save_profile:
            path = save_profile(args.save_profile, selection)
            print("Saved launch selection: " + str(path), flush=True)
        if args.configure_only:
            return 0
        if args.status and not state.is_dir():
            print(json.dumps({"state": "no-verified-session", "project_id": project["id"]}), flush=True)
            return 3
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != "nt":
            state.chmod(0o700)
        session_file = state / "workbench-session.json"
        with _launch_lock(state):
            record = existing_session(session_file, selection)
            if args.adopt_session:
                adopted = adopt_session(args.adopt_session, selection)
                if record is not None and record["operator_url"] != adopted["operator_url"]:
                    raise ValueError("Another verified original session already owns this private state")
                if record is None:
                    record = adopted
                    _write(session_file, record)
            if record is None and args.status:
                print(json.dumps({"state": "no-verified-session", "project_id": project["id"]}), flush=True)
                return 3
            if record is None:
                process, lines, record = start(selection, state)
                _write(session_file, record)
            print(json.dumps(public_status(record, selection, state)), flush=True)
        if args.status:
            return 0
        _open(record, args.no_browser)
        if process is None:
            print("Reopened the existing original operator. Its owning terminal and tasks remain unchanged.", flush=True)
            return 0
        print("Keep this owning terminal open; Ctrl+C closes this operator after its normal shutdown.", flush=True)
        while process.poll() is None:
            try:
                line = lines.get(timeout=.5)
                if line is None:
                    break
                if line.strip():
                    print(line.rstrip(), flush=True)
            except queue.Empty:
                pass
        return int(process.wait())
    except KeyboardInterrupt:
        print("\nClosing this launcher-owned local session.", flush=True)
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if process is not None:
            if process.poll() is None:
                print("Waiting for the original operator to finish its active task and close.", flush=True)
                _close_owned(process, lines)
            if session_file and record:
                with contextlib.suppress(OSError, ValueError):
                    with _launch_lock(state):
                        current = _json(session_file)
                        if current.get("operator_url") == record.get("operator_url"):
                            session_file.unlink()
