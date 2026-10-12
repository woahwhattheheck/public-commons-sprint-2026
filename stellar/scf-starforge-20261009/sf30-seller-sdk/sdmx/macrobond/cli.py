#!/usr/bin/env python3
"""Native operator CLI for the retained SDMX Macrobond catalog."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import threading

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from connection import definition_xml, normalize_host

MAX_INPUT_BYTES = 8 * 1024 * 1024


def _integer(value):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("Use a nonnegative integer.") from error
    if str(number) != str(value) or number < 0:
        raise argparse.ArgumentTypeError("Use a nonnegative integer.")
    return number


def _positive(value):
    number = _integer(value)
    if number < 1:
        raise argparse.ArgumentTypeError("Use an integer greater than zero.")
    return number


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("The JSON input repeats the field " + repr(key) + ".")
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError("The JSON input contains a non-finite number.")


def _object(raw):
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("The JSON input exceeds 8 MiB.")
    value = json.loads(raw, object_pairs_hook=_unique, parse_constant=_nonfinite)
    if not isinstance(value, dict):
        raise ValueError("Supply a JSON object.")
    return value


def _selection(filename):
    with Path(filename).expanduser().open("rb") as stream:
        return _object(stream.read(MAX_INPUT_BYTES + 1))


def _path(value):
    return Path(value).expanduser().resolve()


def _retained_output(path, raw):
    """Publish a whole selected file once, or recover its identical retained bytes."""
    path = _path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".macrobond-", delete=False) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
            recovered = False
        except FileExistsError:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size != len(raw):
                raise ValueError("The selected output already contains a different file.")
            with path.open("rb") as stream:
                if stream.read(len(raw) + 1) != raw:
                    raise ValueError("The selected output already contains different content.")
            recovered = True
        if os.name == "posix":
            descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return {"path": str(path), "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "recovered": recovered}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _ready_output(path, value, encode):
    """Replace only an earlier private ready record for this same catalog."""
    path = _path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and
                (info.st_mode & 0o077 or info.st_uid != os.geteuid())):
            raise ValueError("The selected ready file must be private.")
        old = _selection(path)
        if old.get("schema") != value["schema"] or old.get("catalog") != value["catalog"]:
            raise ValueError("The selected ready file belongs to another operation.")
    raw = encode(value) + b"\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".macrobond-ready-", delete=False) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return str(path)


def configure_runtime_temporary_directory(directory):
    """Keep native stderr and child SQLite spill in the selected private runtime."""
    def usable(value):
        if not value:
            return None
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            return None
        try:
            info = candidate.lstat()
        except OSError:
            return None
        if not stat.S_ISDIR(info.st_mode) or not os.access(candidate, os.W_OK | os.X_OK):
            return None
        if os.name == "posix" and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
            return None
        return candidate.resolve()

    selected = next((value for name in ("TMPDIR", "TEMP", "TMP")
                     if (value := usable(os.environ.get(name))) is not None), None)
    if selected is None:
        fallback = Path(directory).resolve() / "tmp"
        fallback.mkdir(mode=0o700, exist_ok=True)
        selected = usable(str(fallback))
        if selected is None:
            raise ValueError("The workspace tmp directory must be private and writable")
    tempfile.tempdir = str(selected)
    os.environ["TMPDIR"] = str(selected)
    sqlite = usable(os.environ.get("SQLITE_TMPDIR")) or selected
    os.environ["SQLITE_TMPDIR"] = str(sqlite)


def parser():
    result = argparse.ArgumentParser(
        description="Build and publish a Macrobond catalog from original retained SDMX projects.")
    result.add_argument("--catalog", help="private retained catalog directory")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="create the catalog and its original SDMX workspace")
    commands.add_parser("state", help="read source projects, saved editions and current publication")

    for name, description in (
        ("import-sdmx", "import an original portable SDMX project"),
        ("import", "restore an exported Macrobond catalog and retained source projects"),
    ):
        command = commands.add_parser(name, help=description)
        command.add_argument("--file", required=True, help="exact retained ZIP packet")
    for name, description in (
        ("preview", "review selected original project revisions and series"),
        ("save", "save the reviewed edition using its stable operation_id"),
    ):
        command = commands.add_parser(name, help=description)
        command.add_argument("--file", required=True, help="edition-selection JSON")

    edition = commands.add_parser("edition", help="inspect a saved immutable edition")
    edition.add_argument("--id", required=True)
    series = commands.add_parser("series", help="page the selected edition's series")
    series.add_argument("--edition", required=True)
    series.add_argument("--offset", type=_integer, default=0)
    series.add_argument("--limit", type=_positive, default=50)
    series.add_argument("--query", default="")
    observations = commands.add_parser("observations", help="page one saved series' exact observations")
    observations.add_argument("--edition", required=True)
    observations.add_argument("--series", required=True)
    observations.add_argument("--offset", type=_integer, default=0)
    observations.add_argument("--limit", type=_positive, default=50)
    activate = commands.add_parser("activate", help="select the current edition with the original publication CAS")
    activate.add_argument("--edition", required=True)
    activate.add_argument("--expect-revision", required=True, type=_integer)
    activate.add_argument("--expect-current", required=True,
                          help="exact current edition ID from state, or none for an empty catalog")
    compare = commands.add_parser("compare", help="compare two retained editions")
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    export = commands.add_parser("export", help="retain an edition and its source closure for another operator")
    export.add_argument("--edition", required=True)
    export.add_argument("--out", required=True)
    provider = commands.add_parser("provider", help="read the catalog through the original Macrobond wire serializer")
    provider.add_argument("--command", dest="provider_command", required=True)
    provider.add_argument("--params", default="{}", help='JSON query values; repeated n is an array of strings')

    connection = commands.add_parser("connection", help="write the Macrobond client XML without opening a catalog")
    connection.add_argument("--host", required=True, help="customer-visible HTTP(S) provider base URL")
    connection.add_argument("--out", required=True, help="new XML file, or - for exact XML on stdout")

    serve = commands.add_parser("serve", help="open the original private operator and read-only provider server")
    serve.add_argument("--port", type=_integer, default=0)
    serve.add_argument("--provider-username-env", help="environment variable containing the provider Basic username")
    serve.add_argument("--provider-password-env", help="environment variable containing the provider Basic password")
    serve.add_argument("--ready-file", help="private ready JSON, containing the local operator capability URL")
    return result


def _credential(name):
    import re
    if not isinstance(name, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", name):
        raise ValueError("Use an uppercase environment variable name for provider credentials.")
    if name not in os.environ:
        raise ValueError("The provider credential environment variable is not set: " + name)
    return os.environ[name]


def _serve(catalog, args, encode):
    from server import OperatorServer
    if not 0 <= args.port <= 65535:
        raise ValueError("The port must be between 0 and 65535.")
    if bool(args.provider_username_env) != bool(args.provider_password_env):
        raise ValueError("Select both provider credential environment variables.")
    username = _credential(args.provider_username_env) if args.provider_username_env else None
    password = _credential(args.provider_password_env) if args.provider_password_env else None
    server = OperatorServer(catalog, args.port, provider_username=username, provider_password=password)
    stopping = threading.Event()
    old_handlers = {}
    try:
        ready = {
            "schema": "stellar-forge.macrobond-operator-ready.v1",
            "catalog": str(_path(args.catalog)),
            "pid": os.getpid(),
            "url": server.url,
            "origin": server.origin,
            "provider_url": server.provider_url,
            "provider_authentication": "basic" if username is not None else "none",
        }
        if args.ready_file:
            path = _ready_output(args.ready_file, ready, encode)
            _print({"schema": ready["schema"], "ready_file": path, "origin": server.origin,
                    "provider_url": server.provider_url,
                    "provider_authentication": ready["provider_authentication"]}, encode)
        else:
            _print(ready, encode)

        def stop(_number, _frame):
            if not stopping.is_set():
                stopping.set()
                threading.Thread(target=server.shutdown, name="macrobond-cli-shutdown", daemon=True).start()

        for number in (signal.SIGINT, signal.SIGTERM):
            old_handlers[number] = signal.signal(number, stop)
        server.serve_forever()
        return 0
    finally:
        for number, handler in old_handlers.items():
            signal.signal(number, handler)
        server.server_close()


def _print(value, encode):
    data = encode(value)
    sys.stdout.buffer.write(data + (b"" if data.endswith(b"\n") else b"\n"))
    sys.stdout.buffer.flush()


def main(argv=None):
    arguments = parser()
    args = arguments.parse_args(argv)
    if args.command == "connection":
        raw = definition_xml(args.host)
        if args.out == "-":
            sys.stdout.buffer.write(raw)
            sys.stdout.buffer.flush()
        else:
            result = _retained_output(args.out, raw)
            result["host"] = normalize_host(args.host)
            print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    if not args.catalog:
        arguments.error("--catalog is required for this command.")
    if not os.environ.get("SF30_XML_NODE"):
        node = os.environ.get("SF30_SDMX_NODE") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE")
        if node:
            os.environ["SF30_XML_NODE"] = node
    from catalog import Catalog, wire_json
    root = _path(args.catalog)
    with Catalog(root, create=args.command == "init") as catalog:
        configure_runtime_temporary_directory(root)
        if args.command == "serve":
            return _serve(catalog, args, wire_json)
        if args.command in ("init", "state"):
            value = catalog.state()
        elif args.command == "import-sdmx":
            value = catalog.import_packet(_path(args.file))
        elif args.command == "import":
            value = catalog.import_catalog(_path(args.file))
        elif args.command == "preview":
            value = catalog.preview(_selection(args.file))
        elif args.command == "save":
            value = catalog.save_edition(_selection(args.file))
        elif args.command == "edition":
            value = catalog.edition(args.id)
        elif args.command == "series":
            value = catalog.series(args.edition, offset=args.offset, limit=args.limit, query=args.query)
        elif args.command == "observations":
            value = catalog.observations(args.edition, args.series, offset=args.offset, limit=args.limit)
        elif args.command == "activate":
            current = None if args.expect_current == "none" else args.expect_current
            value = catalog.activate(args.edition, expected_revision=args.expect_revision,
                                     expected_current=current)
        elif args.command == "compare":
            value = catalog.compare(args.before, args.after)
        elif args.command == "export":
            value = catalog.export_packet(args.edition, _path(args.out))
        elif args.command == "provider":
            value = catalog.provider(args.provider_command, _object(args.params.encode("utf-8")))
        else:
            raise ValueError("Choose a supported catalog command.")
        _print(value, wire_json)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        code = getattr(error, "code", "MACROBOND_OPERATION")
        if not isinstance(code, str):
            code = "MACROBOND_OPERATION"
        print(json.dumps({"error": code, "message": str(error)[:1000]},
                         ensure_ascii=False, separators=(",", ":")), file=sys.stderr)
        raise SystemExit(1)
