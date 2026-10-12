"""Canonical records, exact field types and portable package primitives."""
from __future__ import annotations
import datetime as dt
import hashlib
import io
import json
import math
import pathlib
import re
import stat
import zipfile
from fractions import Fraction

ROOT = pathlib.Path(__file__).resolve().parent
OPERATION = "IANZ-33593043-ARAHONO-WORKSHARE-94FE-20261012"
FORMAT = "ianz.arahono.workspace/v1"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PACKAGE_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 20000
MAX_RECORDS = 200000

class WorkspaceError(ValueError):
    def __init__(self, message, *, code="invalid_request", status=400, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details
    def as_dict(self):
        return {"error": self.code, "message": str(self), "details": self.details}

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds")

def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise WorkspaceError("Duplicate JSON member: " + key)
        result[key] = value
    return result

def loads(data):
    try:
        return json.loads(data, object_pairs_hook=_pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(WorkspaceError("Non-finite JSON number: " + value)))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise WorkspaceError("Read a complete UTF-8 JSON document: " + str(error)) from error

def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def identity(value):
    return hashlib.sha256(dumps(value).encode()).hexdigest()

def copy(value):
    return loads(dumps(value))

def safe_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise WorkspaceError("A portable file path must be nonempty, relative and use forward slashes.")
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")) or ":" in path.parts[0]:
        raise WorkspaceError("Unsafe portable path: " + value)
    return value

def utc_value(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Missing UTC offset")
        return parsed
    except (ValueError, TypeError, AttributeError) as error:
        raise WorkspaceError("Date and time must retain an explicit UTC offset: " + str(value)) from error

def fraction(value):
    if not isinstance(value, str) or not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", value):
        raise WorkspaceError("Exact quantities and monetary amounts must be ordinary decimal strings.")
    if len(value) > 160:
        raise WorkspaceError("The decimal value is too long.")
    return Fraction(value)

CONTRACT = loads((ROOT / "contracts/data-contract.json").read_text(encoding="utf-8"))
ENTITIES = {entity["name"]: entity for entity in CONTRACT["entities"]}
FIELDS = {name: {field["name"]: field for field in entity["fields"]} for name, entity in ENTITIES.items()}

def entity_schema(entity):
    if entity not in ENTITIES:
        raise WorkspaceError("Unknown canonical entity: " + str(entity))
    return ENTITIES[entity]

def record_key(entity, values):
    fields = entity_schema(entity)["key"]
    missing = [key for key in fields if values.get(key) is None or values.get(key) == ""]
    if missing:
        raise WorkspaceError("Original key fields are required.", details={"entity": entity, "fields": missing})
    key = values[fields[0]] if len(fields) == 1 else dumps([values[field] for field in fields])
    if not isinstance(key, str):
        key = str(key)
    if len(key) > 2048 or "\x00" in key:
        raise WorkspaceError("The original record key is invalid.")
    return key

def _field_error(field, value):
    kind = field["type"]
    if value is None:
        return "Required value is absent" if field["required"] else None
    if value == "" and field["required"]:
        return "Required value is blank"
    if kind in {"string", "foreign-key", "enum", "uri", "date", "date-or-month", "month",
                "datetime", "sha256", "relative-path", "decimal-string"} and not isinstance(value, str):
        return "Retain the original value as text"
    if isinstance(value, str) and len(value) > 1048576:
        return "Field text exceeds 1 MiB"
    try:
        if kind == "boolean" and type(value) is not bool:
            return "Use a JSON boolean"
        if kind == "integer" and type(value) is not int:
            return "Use an integer"
        if kind == "array" and not isinstance(value, list):
            return "Use a JSON array"
        if kind == "object" and not isinstance(value, dict):
            return "Use a JSON object"
        if kind == "decimal-string":
            fraction(value)
        if kind == "sha256" and not re.fullmatch(r"[a-f0-9]{64}", value):
            return "Use the SHA-256 of the actual bytes"
        if kind == "relative-path":
            safe_path(value)
        if kind == "datetime":
            utc_value(value)
        if kind == "date":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return "Preserve a complete ISO date"
            dt.date.fromisoformat(value)
        if kind == "month":
            if not re.fullmatch(r"\d{4}-\d{2}", value):
                return "Preserve the original month as YYYY-MM"
            dt.date.fromisoformat(value + "-01")
        if kind == "date-or-month":
            if re.fullmatch(r"\d{4}-\d{2}", value):
                dt.date.fromisoformat(value + "-01")
            elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                dt.date.fromisoformat(value)
            else:
                return "Preserve the source's date or month precision"
        if kind == "uri" and not re.match(r"^(https?://|urn:)", value):
            return "Use the original HTTPS/HTTP source or a retained URN"
        if kind == "enum" and " | " in field["meaning"]:
            options = field["meaning"].split(" | ")
            if value not in options:
                return "Select a received canonical value: " + ", ".join(options)
    except (ValueError, OverflowError) as error:
        return str(error)
    return None

def validate_record(entity, values, *, complete=False):
    entity_schema(entity)
    if not isinstance(values, dict):
        raise WorkspaceError("Canonical values must be an object.")
    extra = sorted(set(values) - set(FIELDS[entity]))
    if extra:
        raise WorkspaceError("Unrecognised canonical fields; retain extra source columns in annotations.",
                             details={"entity": entity, "fields": extra})
    record_key(entity, values)
    errors = []
    for name, field in FIELDS[entity].items():
        issue = _field_error(field, values.get(name))
        if issue and (complete or name in values or name in ENTITIES[entity]["key"]):
            errors.append({"field": name, "message": issue, "value": values.get(name)})
    if errors:
        raise WorkspaceError("Review canonical field values.", details={"entity": entity, "fields": errors})
    return [{"field": name, "message": _field_error(field, values.get(name))}
            for name, field in FIELDS[entity].items()
            if name not in values and field["required"]]

# These joins are supported by the actual supplied contract. External criteria and
# native finance identities remain explicit external keys until their schema arrives.
RELATIONS = {
    "programme": {"source_edition_id": "source_edition", "fee_profile_id": "fee_profile"},
    "issuer_account": {"source_edition_id": "source_edition", "parent_account_key": "issuer_account"},
    "facility": {"issuer_account_key": "issuer_account", "source_edition_id": "source_edition", "fee_profile_id": "fee_profile"},
    "accreditation": {"issuer_account_key": "issuer_account", "programme_key": "programme",
                      "selected_scope_edition_id": "source_edition", "source_edition_id": "source_edition",
                      "facility_keys": "facility", "status_decision_id": "issuer_decision"},
    "scope_item": {"accreditation_key": "accreditation", "source_edition_id": "source_edition",
                   "facility_keys": "facility", "decision_id": "issuer_decision"},
    "document": {"programme_key": "programme", "accreditation_key": "accreditation",
                 "assessment_key": "assessment", "participant_key": "participant"},
    "assessment": {"accreditation_key": "accreditation", "lead_assessor_key": "participant",
                   "participant_keys": "participant", "source_edition_id": "source_edition"},
    "finding": {"assessment_key": "assessment", "source_edition_id": "source_edition"},
    "issuer_decision": {"accreditation_key": "accreditation", "assessment_key": "assessment", "source_edition_id": "source_edition"},
    "fee_profile": {"programme_key": "programme", "source_edition_id": "source_edition"},
    "charge_line": {"accreditation_key": "accreditation", "assessment_key": "assessment",
                    "facility_key": "facility", "fee_profile_id": "fee_profile", "credit_of_line_key": "charge_line"},
    "source_edition": {"supersedes_edition_id": "source_edition"}
}

def relation_issues(records):
    keys = {name: {record_key(name, row["values"] if "values" in row else row)
                   for row in records.get(name, [])} for name in ENTITIES}
    issues = []
    for entity, fields in RELATIONS.items():
        for row in records.get(entity, []):
            values = row.get("values", row)
            for field, target in fields.items():
                value = values.get(field)
                refs = value if isinstance(value, list) else [value] if value else []
                for reference in refs:
                    if reference not in keys[target]:
                        issues.append({"entity": entity, "key": record_key(entity, values),
                                       "field": field, "target_entity": target, "target_key": reference,
                                       "kind": "dangling_relation"})
    return issues

def package_bytes(files, manifest):
    """Freeze an exact portable inventory. All member bytes are supplied."""
    if len(files) + 1 > MAX_MEMBERS or sum(len(body) for body in files.values()) > MAX_PACKAGE_BYTES:
        raise WorkspaceError("The complete package exceeds the configured receiving capacity.")
    if "MANIFEST.json" in files:
        raise WorkspaceError("MANIFEST.json is reserved for the exact package inventory.")
    for name, data in files.items():
        safe_path(name)
        if not isinstance(data, bytes):
            raise WorkspaceError("Package members must contain actual bytes.")
    manifest = {**manifest, "members": [{"path": name, **digest(data)} for name, data in sorted(files.items())]}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted({**files, "MANIFEST.json": (dumps(manifest) + "\n").encode()}.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return output.getvalue(), manifest

def unpack(data, *, schema=None):
    if not isinstance(data, bytes) or len(data) > MAX_PACKAGE_BYTES:
        raise WorkspaceError("Read the original ZIP within the configured 512 MiB capacity.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(infos) > MAX_MEMBERS or len(names) != len(set(names)):
                raise WorkspaceError("The package has duplicate or excessive members.")
            if sum(info.file_size for info in infos) > MAX_PACKAGE_BYTES:
                raise WorkspaceError("The expanded package exceeds 512 MiB.")
            for info in infos:
                safe_path(info.filename)
                if info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16) or info.is_dir():
                    raise WorkspaceError("Only complete regular unencrypted package members are accepted.")
            if "MANIFEST.json" not in names:
                raise WorkspaceError("The package has no original MANIFEST.json.")
            manifest = loads(archive.read("MANIFEST.json"))
            if schema and manifest.get("schema") != schema:
                raise WorkspaceError("This is not the requested package type.", details={"schema": manifest.get("schema")})
            rows = manifest.get("members")
            if not isinstance(rows, list) or len({row["path"] for row in rows}) != len(rows):
                raise WorkspaceError("The member inventory is malformed.")
            if set(names) != {"MANIFEST.json", *(row["path"] for row in rows)}:
                raise WorkspaceError("The package and declared complete member inventory differ.")
            files = {}
            for row in rows:
                body = archive.read(row["path"])
                if digest(body) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                    raise WorkspaceError("A complete member differs from its original inventory: " + row["path"])
                files[row["path"]] = body
            return manifest, files
    except (zipfile.BadZipFile, KeyError, TypeError, RuntimeError) as error:
        raise WorkspaceError("Read a complete well-formed portable package: " + str(error)) from error
