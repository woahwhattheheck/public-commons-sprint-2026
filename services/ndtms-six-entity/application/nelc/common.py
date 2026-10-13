from __future__ import annotations
import csv, hashlib, io, json, os, re, tempfile
from datetime import datetime, timezone, date
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

SCHEMA = "nelc.workbench/v1"
MAX_TABLES = 20
MAX_ROWS = 250_000
MAX_INPUT_BYTES = 512 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_CELL_BYTES = 2 * 1024 * 1024
KINDS = ("edition", "contract", "approval", "correction", "assessment", "release",
         "target-return", "baseline", "comparison", "plan", "verification",
         "report", "report-comparison", "local-target", "local-receipt", "ndtms-analysis")

class Problem(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details
    def as_dict(self):
        return {"code": self.code, "message": self.message, "details": self.details}

class Cancelled(BaseException):
    pass

def check_stop(signal=None):
    if signal is not None and signal.is_set():
        raise Cancelled("The original operation was interrupted; its request can be resumed.")

def require(condition, code, message, details=None):
    if not condition:
        raise Problem(code, message, details)

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def text(value, field, nonempty=True, maximum=20_000):
    require(isinstance(value, str), "FIELD_TYPE", f"{field} must be text.")
    require((not nonempty or bool(value.strip())) and len(value) <= maximum,
            "FIELD_VALUE", f"{field} is empty or too long.")
    return value

def integer(value, field, minimum=0, maximum=10**12):
    require(isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum,
            "FIELD_VALUE", f"{field} must be an integer from {minimum} to {maximum}.")
    return value

def safe_name(value):
    text(value, "filename", maximum=200)
    p = PurePosixPath(value)
    require(not p.is_absolute() and len(p.parts) == 1 and value not in (".", "..")
            and "\\" not in value and all(ord(c)>=32 and ord(c)!=127 for c in value), "FILE_NAME", "Use a plain filename.")
    return value

def safe_relative(value):
    text(value, "archive path", maximum=500)
    p = PurePosixPath(value)
    require(not p.is_absolute() and "\\" not in value and "\x00" not in value
            and all(x not in ("", ".", "..") for x in p.parts)
            and str(p) == value, "ARCHIVE_PATH", "An archive member has an unsafe path.", value)
    return p

def number(raw, tokens=()):
    require(isinstance(raw, str), "CELL_TYPE", "CSV cells must remain strings.")
    if raw in tokens:
        return None
    require(bool(re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", raw)),
            "DECIMAL_VALUE", "A numeric field contains an unapproved value.", {"raw": raw})
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise Problem("DECIMAL_VALUE", "The numeric string cannot be read.", {"raw": raw})
    require(value.is_finite(), "DECIMAL_VALUE", "A numeric value must be finite.")
    return value

def column(value, headers):
    integer(value, "column index", 0, len(headers)-1)
    return value

def key(values):
    return canonical(values)

def file_hash(path, signal=None):
    h, count = hashlib.sha256(), 0
    with open(path, "rb") as stream:
        while True:
            check_stop(signal)
            chunk = stream.read(1024*1024)
            if not chunk:
                break
            h.update(chunk); count += len(chunk)
    return h.hexdigest(), count

def atomic_bytes(path, body, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), "PATH_SYMLINK", "A managed path cannot be a symlink.")
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        try: os.unlink(temporary)
        except FileNotFoundError: pass

def csv_bytes(headers, rows, delimiter=",", encoding="utf-8-sig"):
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=delimiter, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode(encoding)

def result_id(kind, payload):
    return kind + "-" + digest(payload)[:28]
