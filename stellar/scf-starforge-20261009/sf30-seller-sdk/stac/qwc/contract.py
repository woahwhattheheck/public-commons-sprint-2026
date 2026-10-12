# SPDX-License-Identifier: MIT
"""QWC publication inputs and retained files; native GIS and QWC keep their engines."""
from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit, urlencode, parse_qsl
import uuid

SCHEMA = "starforge.stac-qwc-publication.v1"
WORKSPACE_SCHEMA = "starforge.stac-qwc-workspace.v1"
REQUEST_SCHEMA = "starforge.stac-qwc-request.v1"
PROFILE_SCHEMA = "starforge.stac-qwc-host.v1"
PACKAGE_SCHEMA = "starforge.stac-qwc-package.v1"
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
ENV = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CHUNK = 1024 * 1024
MAX_JSON = 32 * CHUNK
HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[2]


class QwcError(ValueError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details


def need(ok, code, message, **details):
    if not ok:
        raise QwcError(code, message, **details)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def value_hash(value):
    return digest(json_bytes(value))


def identifier(value, field):
    need(isinstance(value, str) and ID.fullmatch(value), "IDENTITY_REQUIRED",
         "Use a stable ordinary identifier.", field=field)
    return value


def relative(value):
    need(isinstance(value, str) and 0 < len(value) <= 4096 and "\\" not in value
         and not value.startswith("/") and not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value)
         and all(p not in ("", ".", "..") for p in value.split("/"))
         and not any(ord(c) < 32 or ord(c) == 127 for c in value),
         "RELATIVE_PATH_REQUIRED", "Use an ordinary relative file path.", path=value)
    return value


def directory(value, create=False):
    need(isinstance(value, (str, Path)) and str(value), "DIRECTORY_REQUIRED", "Choose a directory.")
    p = Path(value).expanduser().absolute()
    if create:
        p.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(p.is_dir() and not p.is_symlink(), "DIRECTORY_REQUIRED",
         "Choose an existing ordinary directory.", path=str(p))
    return p.resolve(strict=True)


def member(root, name, existing=True):
    root = directory(root)
    path = root
    for part in relative(name).split("/"):
        path /= part
        need(not path.is_symlink(), "MEMBER_SYMLINK", "A retained member must be an ordinary file.", path=name)
    if existing:
        need(path.is_file(), "MEMBER_MISSING", "A retained member is missing.", path=name)
    return path


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, body, *, expected=None, create_only=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not path.is_symlink(), "WRITE_SYMLINK", "The destination must be an ordinary file.", path=str(path))
    if path.exists():
        previous = measure(path)
        if create_only:
            need(previous == {"bytes": len(body), "sha256": digest(body)},
                 "RETAINED_INPUT_CHANGED", "The existing operation retains different bytes.", path=str(path))
            sync_directory(path.parent)
            return previous
        need(expected is None or previous["sha256"] == expected,
             "WRITE_REVISION_CHANGED", "The destination changed since review.", path=str(path))
    else:
        need(expected is None, "WRITE_PREIMAGE_MISSING", "The reviewed destination is missing.", path=str(path))
    fd, temporary = tempfile.mkstemp(prefix=".qwc-" + uuid.uuid4().hex + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if create_only:
            try:
                os.link(temporary, path)
            except FileExistsError:
                need(measure(path) == {"bytes": len(body), "sha256": digest(body)},
                     "RETAINED_INPUT_CHANGED", "The existing operation retains different bytes.", path=str(path))
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"bytes": len(body), "sha256": digest(body)}


def keep_json(path, value):
    return atomic(path, json_bytes(value), create_only=True)


def read_json(path, limit=MAX_JSON):
    p = Path(path)
    need(p.is_file() and not p.is_symlink(), "JSON_FILE_REQUIRED", "Choose an ordinary JSON file.", path=str(p))
    with p.open("rb") as stream:
        body = stream.read(limit + 1)
    need(len(body) <= limit, "JSON_TOO_LARGE", "The complete JSON exceeds its declared input size.", path=str(p))
    try:
        result = json.loads(body.decode("utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeError) as error:
        raise QwcError("JSON_INVALID", "The JSON input could not be decoded.", path=str(p)) from error
    return result, body


def measure(path, expected=None, progress=None):
    p = Path(path)
    need(p.is_file() and not p.is_symlink(), "FILE_REQUIRED", "Choose an ordinary retained file.", path=str(p))
    fd = os.open(p, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    sha, length = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode), "FILE_REQUIRED", "An ordinary file is required.")
        while block := stream.read(CHUNK):
            sha.update(block)
            length += len(block)
            if progress:
                progress({"phase": "file", "path": str(p), "bytes": length, "totalBytes": before.st_size})
        after = os.fstat(stream.fileno())
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and length == before.st_size,
         "SOURCE_CHANGED_DURING_READ", "A selected file changed during reading.", path=str(p))
    result = {"bytes": length, "sha256": sha.hexdigest()}
    need(expected is None or all(result[k] == expected[k] for k in result),
         "FILE_IDENTITY_CHANGED", "The retained file differs from its original descriptor.", path=str(p))
    return result


def copy_file(source, target, expected, progress=None, *, replace=False, mode=0o600, gid=None):
    source, target = Path(source), Path(target)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not target.is_symlink(), "TARGET_SYMLINK", "The target must be an ordinary file.", path=str(target))
    if target.exists() and not replace:
        measure(target, expected, progress)
        sync_directory(target.parent)
        return expected
    fd, temporary = tempfile.mkstemp(prefix=".qwc-copy-", dir=target.parent)
    sha, length = hashlib.sha256(), 0
    try:
        with source.open("rb") as src, os.fdopen(fd, "wb") as dst:
            if gid is not None and os.fstat(dst.fileno()).st_gid != gid:
                os.fchown(dst.fileno(), -1, gid)
            os.fchmod(dst.fileno(), mode)
            while block := src.read(CHUNK):
                length += len(block)
                need(length <= expected["bytes"], "FILE_SIZE_CHANGED", "The selected file grew while copying.")
                sha.update(block)
                dst.write(block)
                if progress:
                    progress({"phase": "copy", "path": str(source), "bytes": length, "totalBytes": expected["bytes"]})
            dst.flush()
            os.fsync(dst.fileno())
        need(length == expected["bytes"] and sha.hexdigest() == expected["sha256"],
             "FILE_IDENTITY_CHANGED", "The selected file changed while copying.", path=str(source))
        if replace:
            os.replace(temporary, target)
        else:
            try:
                os.link(temporary, target)
            except FileExistsError:
                measure(target, expected)
        sync_directory(target.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"bytes": length, "sha256": sha.hexdigest()}


def inventory(root, progress=None, *, omit=()):
    root = directory(root)
    result = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        files.sort()
        for name in dirs:
            path = Path(parent) / name
            need(not path.is_symlink(), "SOURCE_SYMLINK",
                 "Keep the selected configuration or viewer tree self-contained.", path=str(path))
        for name in files:
            path = Path(parent) / name
            rel = path.relative_to(root).as_posix()
            if rel in omit:
                continue
            result.append({"path": rel, **measure(path, progress=progress)})
    return result


def copy_inventory(source, target, files, progress=None):
    source, target = directory(source), directory(target, True)
    for row in files:
        copy_file(member(source, row["path"]), member(target, row["path"], False), row, progress)
    return files


@contextmanager
def writer(root, name=".qwc.lock"):
    root = directory(root, True)
    path = member(root, name, False)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise QwcError("WRITER_ACTIVE", "The original publication writer is still active.", path=str(root)) from error
        yield fd
    finally:
        os.close(fd)


def url(value, field, *, directory_url=False):
    need(isinstance(value, str) and value, "URL_REQUIRED", "Select the existing service URL.", field=field)
    p = urlsplit(value)
    need(p.scheme in ("http", "https") and p.hostname and not p.username and not p.password and not p.fragment,
         "SERVICE_URL_INVALID", "Use the existing HTTP service URL without embedded credentials.", field=field)
    if directory_url:
        need(not p.query and p.path.endswith("/"), "SERVICE_BASE_URL",
             "Use the exact service base URL ending with a slash.", field=field)
    return urlunsplit(p)


def command(value, field):
    need(isinstance(value, list) and 1 <= len(value) <= 80 and
         all(isinstance(x, str) and x and "\x00" not in x for x in value),
         "NATIVE_COMMAND_REQUIRED", "Use the existing native command as an argument array.", field=field)
    need(Path(value[0]).is_absolute(), "NATIVE_EXECUTABLE_REQUIRED",
         "Select the existing absolute native executable.", field=field)
    return copy.deepcopy(value)


def normalize_profile(raw):
    need(isinstance(raw, dict) and raw.get("schema") == PROFILE_SCHEMA,
         "HOST_PROFILE_REQUIRED", "Open the complete original QWC host profile.")
    p = copy.deepcopy(raw)
    identifier(p.get("id"), "id")
    identifier(p.get("tenant"), "tenant")
    identifier(p.get("themeId"), "themeId")
    relative(p.get("mapPrefix"))
    need(not p["mapPrefix"].endswith("/current"), "MAP_PREFIX_INVALID", "Choose the owned map prefix above current/project.")
    for key in ("inputRoot", "viewerRoot", "qgisResourcesRoot", "generatedConfigRoot", "generatorSource", "generatorCwd"):
        p[key] = str(directory(p.get(key)))
    for key in ("tenantConfig", "themeInput"):
        relative(p.get(key))
        member(p["inputRoot"], p[key])
    need(isinstance(p.get("themePointer"), str) and p["themePointer"].startswith("/"),
         "THEME_POINTER_REQUIRED", "Select the exact native theme JSON pointer or final /- array insertion.")
    need(type(p.get("permissionsDefaultAllow")) is bool,
         "EXISTING_PERMISSIONS_REQUIRED", "Retain the existing host's effective permissions_default_allow boolean.")
    for key in ("qgisPython", "generatorPython"):
        need(isinstance(p.get(key), str) and Path(p[key]).is_absolute() and Path(p[key]).is_file(),
             "NATIVE_PYTHON_REQUIRED", "Choose the existing native Python executable.", field=key)
    p["qgisServerBaseUrl"] = url(p.get("qgisServerBaseUrl"), "qgisServerBaseUrl", directory_url=True)
    p["wmsBaseUrl"] = url(p.get("wmsBaseUrl"), "wmsBaseUrl", directory_url=True)
    p["viewerUrl"] = url(p.get("viewerUrl"), "viewerUrl")
    need(urlsplit(p["qgisServerBaseUrl"]).path == urlsplit(p["wmsBaseUrl"]).path,
         "NATIVE_OWS_PREFIX", "Keep the existing native and public QWC OWS path prefix.")
    need(isinstance(p.get("qwcVersion"), str) and p["qwcVersion"].strip(),
         "QWC_VERSION_REQUIRED", "Retain the actual selected QWC version.")
    if p.get("reloadCommand") is not None:
        p["reloadCommand"] = command(p["reloadCommand"], "reloadCommand")
    need(isinstance(p.get("environmentNames", []), list) and
         all(isinstance(x, str) and ENV.fullmatch(x) for x in p.get("environmentNames", [])),
         "ENVIRONMENT_NAMES_INVALID", "Retain environment variable names for the existing native host.")
    p["environmentNames"] = sorted(set(p.get("environmentNames", [])))
    return p


def pointer_parts(pointer):
    need(isinstance(pointer, str) and pointer.startswith("/"), "JSON_POINTER_REQUIRED", "Choose an exact native JSON pointer.")
    parts = pointer[1:].split("/")
    need(all(not re.search(r"~(?![01])", x) for x in parts), "JSON_POINTER_INVALID", "Use RFC 6901 pointer escaping.")
    return [x.replace("~1", "/").replace("~0", "~") for x in parts]


def selected_theme(document, pointer):
    current = document
    parts = pointer_parts(pointer)
    for part in parts[:-1]:
        if isinstance(current, list):
            need(part.isdigit() and str(int(part)) == part and int(part) < len(current),
                 "THEME_POINTER_MISSING", "The reviewed native theme path changed.")
            current = current[int(part)]
        else:
            need(isinstance(current, dict) and part in current,
                 "THEME_POINTER_MISSING", "The reviewed native theme path changed.")
            current = current[part]
    final = parts[-1]
    if isinstance(current, list):
        if final == "-":
            return current, len(current), None
        need(final.isdigit() and str(int(final)) == final and int(final) < len(current),
             "THEME_POINTER_MISSING", "The reviewed native theme path changed.")
        key = int(final)
    else:
        need(isinstance(current, dict) and final in current,
             "THEME_POINTER_MISSING", "The reviewed native theme path changed.")
        key = final
    return current, key, current[key]


def derive_theme(document, profile, options):
    result = copy.deepcopy(document)
    parent, key, previous = selected_theme(result, profile["themePointer"])
    need(previous is None or isinstance(previous, dict) and previous.get("id") == profile["themeId"],
         "THEME_ID_CHANGED", "The selected native theme belongs to another identity.")
    need(isinstance(options, dict), "THEME_OPTIONS_REQUIRED", "Use a complete native QWC theme options object.")
    current = copy.deepcopy(previous or {})
    current.update(copy.deepcopy(options))
    map_name = profile["mapPrefix"] + "/current/project"
    current["id"] = profile["themeId"]
    current["url"] = urlsplit(profile["qgisServerBaseUrl"]).path + map_name
    need(isinstance(current.get("title"), str) and current["title"].strip(),
         "THEME_TITLE_REQUIRED", "Give the published theme a title.")
    if isinstance(parent, list) and key == len(parent):
        parent.append(current)
    else:
        parent[key] = current
    return result, previous, current


def normalize_request(raw, profile, *, source_required=True):
    need(isinstance(raw, dict) and raw.get("schema") == REQUEST_SCHEMA,
         "PUBLICATION_REQUEST_REQUIRED", "Open the complete publication request.")
    r = copy.deepcopy(raw)
    for key in ("operationId", "requestId"):
        identifier(r.get(key), key)
    need(isinstance(r.get("actor"), str) and 0 < len(r["actor"].strip()) <= 240,
         "ACTOR_REQUIRED", "Name the operator receiving this edition.")
    qgis = r.get("qgis")
    need(isinstance(qgis, dict) and type(qgis.get("revision")) is int and qgis["revision"] >= 0,
         "QGIS_SOURCE_REQUIRED", "Select the original saved QGIS workspace and its displayed revision.")
    if source_required:
        qgis["directory"] = str(directory(qgis.get("directory")))
    else:
        need(isinstance(qgis.get("directory"), str) and Path(qgis["directory"]).is_absolute(),
             "QGIS_SOURCE_REQUIRED", "Retain the original absolute QGIS workspace path.")
        qgis["directory"] = str(Path(qgis["directory"]).expanduser().absolute())
    need(isinstance(qgis.get("projectId"), str) and qgis["projectId"], "QGIS_PROJECT_REQUIRED", "Select a retained native map version.")
    need(isinstance(r.get("theme"), dict), "THEME_OPTIONS_REQUIRED", "Retain the native theme choices.")
    if r.get("print") is not None:
        selected = r["print"]
        need(isinstance(selected, dict) and selected.get("mode") in ("existing", "map-page") and
             isinstance(selected.get("name"), str) and selected["name"].strip(),
             "PRINT_SELECTION_REQUIRED", "Choose an existing native layout or an explicit map page.")
        if selected["mode"] == "map-page":
            need(selected.get("paper", "A4") in ("A4", "A3") and
                 selected.get("orientation", "landscape") in ("landscape", "portrait"),
                 "PRINT_PAGE_INVALID", "Choose the native A4/A3 page and orientation.")
    roles = r.get("roleViews", [])
    need(isinstance(roles, list) and len(roles) <= 50, "ROLE_VIEWS_INVALID", "Retain the selected original role views.")
    seen = set()
    for row in roles:
        need(isinstance(row, dict), "ROLE_VIEW_INVALID", "Use an explicit original role view.")
        identifier(row.get("id"), "roleViews.id")
        need(row["id"] not in seen, "ROLE_VIEW_DUPLICATE", "Each role view needs its original distinct identity.")
        seen.add(row["id"])
        if row.get("headersEnvironment") is not None:
            need(isinstance(row["headersEnvironment"], str) and ENV.fullmatch(row["headersEnvironment"]),
                 "ROLE_ENVIRONMENT_INVALID", "Use the private header environment name.")
        if row.get("role") is not None:
            need(isinstance(row["role"], str) and 0 < len(row["role"]) <= 240,
                 "ROLE_NAME_INVALID", "Retain the original ConfigDB role name.")
        need(isinstance(row.get("expectedLayerNames"), list) and
             all(isinstance(x, str) and x for x in row["expectedLayerNames"]),
             "ROLE_LAYERS_REQUIRED", "Retain the configured layer names for this original role view.")
    r["roleViews"] = roles
    return r


def public_service(profile):
    map_name = profile["mapPrefix"] + "/current/project"
    parts = urlsplit(profile["viewerUrl"])
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "t"]
    query.append(("t", profile["themeId"]))
    return {"viewerUrl": urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), "")),
            "wmsUrl": profile["wmsBaseUrl"] + map_name, "wmsVersion": "1.3.0"}


def original_gis():
    import sys
    qgis_source = HERE.parent / "qgis"
    if str(qgis_source) not in sys.path:
        sys.path.insert(0, str(qgis_source))
    from starforge_stac import model
    return model
