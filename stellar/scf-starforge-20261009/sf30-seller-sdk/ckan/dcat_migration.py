"""MIT. Catalog migration review around the unchanged, pinned GSA converter.

The caller owns file custody, operation revisions, acceptance and publication.
This module receives original bytes, performs a read-only domain operation, and
returns complete validation, conservation and field changes for that operation.
GSA source and its CC0 license remain unchanged in vendor/gsa-dcat-us/.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import copy
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import platform
import sys
import tomllib
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

SCHEMA = "migration-review.v1"
SOURCE_REPOSITORY = "GSA/dcat-us"
SOURCE_COMMIT = "4996591483b52f4ccc0cb72c42e4ec3fe59a4b06"
SOURCE_MANIFEST_SHA256 = "92cf6f2ef0667455314e159f6286541cbcb383bb28cdfbe37c44e2a972793acf"
DEFAULT_ORIGINAL_ROOT = Path(__file__).resolve().parent / "vendor" / "gsa-dcat-us"
PROFILE_IDS = {
    "1.1": "https://project-open-data.cio.gov/v1.1/schema/catalog.json",
    "3.0": "https://resources.data.gov/dcat-us/3.0.0/definitions/catalog",
}
RECORD_SCHEMA_IDS = {
    "1.1": "https://project-open-data.cio.gov/v1.1/schema/non-federal_dataset.json",
    "3.0": "https://resources.data.gov/dcat-us/3.0.0/definitions/dataset",
    "series": "https://resources.data.gov/dcat-us/3.0.0/definitions/datasetseries",
}
MISSING = object()


class MigrationError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.details = details

    def as_dict(self):
        result = {"code": self.code, "message": str(self)}
        if self.details is not None:
            result["details"] = self.details
        return result


def _decimal_canonical(value):
    """Compare decimal values without binary rounding or context precision."""
    if not value.is_finite():
        raise ValueError("Non-JSON numeric constant: " + str(value))
    sign, digits, exponent = value.as_tuple()
    coefficient = "".join(str(digit) for digit in digits).lstrip("0")
    if not coefficient:
        return "-0e0" if sign else "0e0"
    trimmed = coefficient.rstrip("0")
    exponent += len(coefficient) - len(trimmed)
    return ("-" if sign else "") + trimmed + "e" + str(exponent)


def _json_exact(value, *, canonical=False):
    """Write retained Decimal values as JSON numbers, keeping other JSON types."""
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Non-JSON numeric constant: " + str(value))
        rendered = str(value)
        return _decimal_canonical(value) if canonical else (
            rendered if any(marker in rendered for marker in ".eE") else rendered + "e0")
    if canonical and isinstance(value, int) and not isinstance(value, bool):
        # JSON has one numeric type: the browser may render 1e0 as 1.
        return _decimal_canonical(Decimal(value))
    if canonical and isinstance(value, float):
        return _decimal_canonical(Decimal(str(value)))
    if isinstance(value, dict):
        keys = sorted(value) if canonical else value
        if any(not isinstance(key, str) for key in keys):
            raise TypeError("JSON object keys must be strings")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" +
            _json_exact(value[key], canonical=canonical) for key in keys) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_json_exact(item, canonical=canonical) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _canonical(value):
    return _json_exact(value, canonical=True)


def encode_review(result):
    """Serialize a callable review result without rounding its Decimal values."""
    return _json_exact(result)


def _sha256(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def _pointer_token(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def _join(path, value):
    return path + "/" + _pointer_token(value)


def _pointer(parts):
    return "".join("/" + _pointer_token(part) for part in parts)


def _strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Repeated JSON object key: " + key)
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("Non-JSON numeric constant: " + value)


def _parse_bytes(value, label):
    if not isinstance(value, (bytes, bytearray)):
        raise MigrationError("INVALID_INPUT", label + " must contain original bytes")
    raw = bytes(value)
    try:
        text = raw.decode("utf-8-sig")
        encoding = "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8"
    except UnicodeDecodeError:
        # This is the same fallback used by the original GSA fetcher.
        text = raw.decode("cp1252")
        encoding = "cp1252"
    text = text.lstrip("\ufeff")
    try:
        catalog = json.loads(text, object_pairs_hook=_strict_object,
                             parse_constant=_reject_constant)
    except (ValueError, RecursionError) as error:
        raise MigrationError("INVALID_JSON", label + ": " + str(error)) from error
    if not isinstance(catalog, dict):
        raise MigrationError("INVALID_CATALOG", label + " must have an object root")
    return catalog, {"sha256": _sha256(raw), "bytes": len(raw), "encoding": encoding}, text


def _comparison_integer(value):
    return Decimal(value) if value == "-0" else int(value)


def _comparison_inventory(text, profile):
    # Converter/validator input remains the original Python JSON model. Review
    # values independently follow the exact decimal values in the retained bytes.
    catalog = json.loads(text, object_pairs_hook=_strict_object,
                         parse_float=Decimal, parse_int=_comparison_integer,
                         parse_constant=_reject_constant)
    return _inventory(catalog, profile)


def _validation_inventory(catalog, profile, retained):
    # Original validator bodies, exact retained identifiers for displayed rows.
    return {**retained, "_bodies": _inventory(catalog, profile)["_bodies"]}


def _declared_profile(catalog):
    value = catalog.get("conformsTo")
    if isinstance(value, dict):
        value = value.get("identifier", value.get("@id"))
    if not isinstance(value, str):
        return None
    value = value.rstrip("/")
    if value == "https://project-open-data.cio.gov/v1.1/schema":
        return "1.1"
    if value in ("https://resources.data.gov/dcat-us/3.0.0",
                 "https://resources.data.gov/dcat-us/3.0"):
        return "3.0"
    return None


def _select_profile(catalog, requested, label):
    if requested not in ("auto", "1.1", "3.0"):
        raise MigrationError("INVALID_PROFILE", label + " profile must be auto, 1.1 or 3.0")
    declared = _declared_profile(catalog)
    selected = declared if requested == "auto" else requested
    if selected is None:
        raise MigrationError("PROFILE_REQUIRED",
                             "Select the schema version for " + label,
                             {"conforms_to": catalog.get("conformsTo")})
    return selected, declared


def _identity(value):
    """Keep structured identifiers, using only their actual identity fields."""
    result = {"value": copy.deepcopy(value), "key": None, "kind": "missing",
              "fingerprint": _sha256(_canonical(value)), "usable": False}
    if isinstance(value, str) and value.strip():
        result.update(key="id:" + value.strip(), kind="string", usable=True)
    elif isinstance(value, dict):
        iri = value.get("@id")
        notation = value.get("notation")
        if isinstance(iri, str) and iri.strip():
            result.update(key="id:" + iri.strip(), kind="iri", usable=True)
        elif isinstance(notation, str) and notation.strip():
            scheme = {key: value[key] for key in
                      ("schemaAgency", "creator", "version") if key in value}
            result.update(key="notation:" + _canonical([notation.strip(), scheme]),
                          kind="notation", usable=True)
        else:
            result["kind"] = "unresolved_object"
    return result


def _inventory(catalog, profile):
    records, catalogs, issues, bodies = [], [], [], {}

    def add_record(node, path, scope, role, parent_path=None):
        is_series = role == "dataset_series"
        field = "@id" if is_series else "identifier"
        raw_identifier = node.get(field) if isinstance(node, dict) else None
        identity = _identity(raw_identifier)
        row = {
            "path": path, "catalog_path": scope["path"], "scope_key": scope["scope_key"],
            "role": role, "parent_path": parent_path, "identifier_field": field,
            "identifier": copy.deepcopy(raw_identifier), "identity": identity,
            "title": node.get("title") if isinstance(node, dict) else None,
            "record_sha256": _sha256(_canonical(node)),
        }
        row["match_key"] = (_canonical([scope["scope_key"], identity["key"]])
                            if identity["usable"] else None)
        records.append(row)
        bodies[path] = node
        if not isinstance(node, dict):
            issues.append({"code": "INVALID_RECORD", "path": path,
                           "message": "This catalog entry is not an object."})
        if not identity["usable"]:
            issues.append({"code": "UNRESOLVED_IDENTIFIER", "path": _join(path, field),
                           "message": "This entry has no usable unique identifier.",
                           "identifier": copy.deepcopy(raw_identifier)})
        return row

    def collection(node, key, path):
        value = node.get(key, [])
        if value is None:
            return []
        if not isinstance(value, list):
            issues.append({"code": "INVALID_COLLECTION", "path": _join(path, key),
                           "message": "The catalog collection must be an array."})
            return []
        return value

    def visit(node, path, inherited_profile):
        selected = inherited_profile if path == "" else (_declared_profile(node) or inherited_profile)
        catalog_identifier = _identity(node.get("@id", node.get("identifier")))
        scope_key = ("root" if path == "" else
                     "catalog:" + catalog_identifier["key"] if catalog_identifier["usable"]
                     else "catalog-path:" + path)
        scope = {"path": path, "scope_key": scope_key, "profile": selected,
                 "identifier": catalog_identifier, "title": node.get("title")}
        catalogs.append(scope)
        bodies[path] = node
        for index, item in enumerate(collection(node, "dataset", path)):
            add_record(item, _join(_join(path, "dataset"), index), scope, "dataset")
        for index, series in enumerate(collection(node, "datasetSeries", path)):
            series_path = _join(_join(path, "datasetSeries"), index)
            add_record(series, series_path, scope, "dataset_series")
            if isinstance(series, dict):
                for member_index, member in enumerate(collection(series, "seriesMember", series_path)):
                    add_record(member, _join(_join(series_path, "seriesMember"), member_index),
                               scope, "series_member", series_path)
        # Catalog.hasPart contains Catalog, whereas Dataset.hasPart remains an
        # owned field of its dataset and is fully checked/diffed there.
        for field in ("catalog", "hasPart"):
            for index, child in enumerate(collection(node, field, path)):
                child_path = _join(_join(path, field), index)
                if isinstance(child, dict):
                    visit(child, child_path, selected)
                else:
                    issues.append({"code": "INVALID_NESTED_CATALOG", "path": child_path,
                                   "message": "The nested catalog is not an object."})

    visit(catalog, "", profile)
    groups = defaultdict(list)
    for row in records:
        if row["match_key"] is not None:
            groups[row["match_key"]].append(row["path"])
    duplicates = [{"key": key, "paths": paths}
                  for key, paths in sorted(groups.items()) if len(paths) > 1]
    return {"records": records, "catalogs": catalogs, "issues": issues,
            "duplicates": duplicates,
            "unidentified": [row for row in records if not row["identity"]["usable"]],
            "_bodies": bodies}


def _public_inventory(inventory):
    return {key: value for key, value in inventory.items() if key != "_bodies"}


class _OriginalRuntime:
    def __init__(self, original_root, *, runtime_profile="original"):
        self.root = Path(original_root).resolve()
        manifest_path = self.root / "source-manifest.json"
        try:
            raw_manifest = manifest_path.read_bytes()
        except OSError as error:
            raise MigrationError("ORIGINAL_SOURCE_UNAVAILABLE",
                                 "The installed GSA source manifest is unavailable.") from error
        if _sha256(raw_manifest) != SOURCE_MANIFEST_SHA256:
            raise MigrationError("ORIGINAL_SOURCE_CHANGED", "The GSA source manifest changed.")
        manifest = json.loads(raw_manifest)
        if (manifest.get("repository") != SOURCE_REPOSITORY or
                manifest.get("commit") != SOURCE_COMMIT or len(manifest.get("files", {})) != 37):
            raise MigrationError("ORIGINAL_SOURCE_CHANGED", "The GSA source selection changed.")
        for relative, expected in manifest["files"].items():
            target = self.root / relative
            if target.resolve().is_relative_to(self.root) is False:
                raise MigrationError("ORIGINAL_SOURCE_CHANGED", "Invalid source member path.")
            try:
                body = target.read_bytes()
            except OSError as error:
                raise MigrationError("ORIGINAL_SOURCE_UNAVAILABLE",
                                     "Missing original GSA source: " + relative) from error
            if len(body) != expected["bytes"] or _sha256(body) != expected["sha256"]:
                raise MigrationError("ORIGINAL_SOURCE_CHANGED",
                                     "Original GSA source changed: " + relative)
        for directory in ("jsonschema/definitions", "jsonschema/v1.1_definitions"):
            expected = {relative for relative in manifest["files"]
                        if str(Path(relative).parent) == directory and relative.endswith(".json")}
            actual = {path.relative_to(self.root).as_posix()
                      for path in (self.root / directory).glob("*.json")}
            if actual != expected:
                raise MigrationError("ORIGINAL_SOURCE_CHANGED",
                                     "The original schema registry selection changed.",
                                     {"directory": directory, "unexpected": sorted(actual - expected),
                                      "missing": sorted(expected - actual)})
        if runtime_profile == "original":
            if not ((3, 13) <= sys.version_info < (4, 0)):
                raise MigrationError("PYTHON_VERSION_REQUIRED",
                                     "The original GSA package requires Python 3.13 or newer.",
                                     {"actual": platform.python_version(), "required": ">=3.13,<4.0"})
        elif runtime_profile == "portable-python312":
            if not ((3, 12) <= sys.version_info < (3, 13)):
                raise MigrationError("PYTHON_VERSION_REQUIRED",
                                     "The selected portable profile requires Python 3.12.",
                                     {"actual": platform.python_version(), "required": ">=3.12,<3.13",
                                      "runtime_profile": runtime_profile,
                                      "upstream_required": ">=3.13,<4.0"})
        else:
            raise MigrationError("INVALID_RUNTIME_PROFILE",
                                 "Select original or portable-python312.")
        try:
            from jsonschema import Draft202012Validator
            import referencing
            import click
            import curl_cffi
            import dateutil
            import langcodes
            from packaging.requirements import Requirement
        except ImportError as error:
            raise MigrationError("DEPENDENCY_UNAVAILABLE",
                                 "Install the original GSA dependency lock.",
                                 {"exception": str(error)}) from error
        project = tomllib.loads((self.root / "jsonschema" / "pyproject.toml").read_text(encoding="utf-8"))
        for text in project["project"]["dependencies"]:
            requirement = Requirement(text)
            if requirement.name.lower() not in {"jsonschema", "click", "curl-cffi", "langcodes"}:
                continue
            actual = importlib.metadata.version(requirement.name)
            if actual not in requirement.specifier:
                raise MigrationError("DEPENDENCY_VERSION_REQUIRED",
                                     "The converter dependency differs from its original supported versions.",
                                     {"dependency": requirement.name, "actual": actual,
                                      "required": str(requirement.specifier)})
        self.validator_class = Draft202012Validator
        self.format_checker = Draft202012Validator.FORMAT_CHECKER
        formats = set()

        def collect_formats(value):
            if not isinstance(value, dict):
                return
            if isinstance(value.get("format"), str):
                formats.add(value["format"])
            for key in ("properties", "patternProperties", "$defs", "definitions", "dependentSchemas"):
                if isinstance(value.get(key), dict):
                    for item in value[key].values():
                        collect_formats(item)
            for key in ("allOf", "anyOf", "oneOf", "prefixItems", "items"):
                items = value.get(key)
                if isinstance(items, list):
                    for item in items:
                        collect_formats(item)
                elif isinstance(items, dict):
                    collect_formats(items)
            for key in ("additionalItems", "additionalProperties", "contains", "propertyNames",
                        "if", "then", "else", "not", "unevaluatedProperties", "unevaluatedItems"):
                collect_formats(value.get(key))

        for relative in manifest["files"]:
            if relative.endswith(".json"):
                collect_formats(json.loads((self.root / relative).read_text(encoding="utf-8")))
        missing_formats = sorted(formats - set(self.format_checker.checkers))
        if missing_formats:
            raise MigrationError("FORMAT_CHECKER_UNAVAILABLE",
                                 "Install jsonschema with the original format dependencies.",
                                 {"missing_formats": missing_formats})
        self.original = self._load_converter()
        self.registries = {
            "1.1": self.original.load_schema_registry(self.root / "jsonschema" / "v1.1_definitions"),
            "3.0": self.original.load_schema_registry(self.root / "jsonschema" / "definitions"),
        }
        dependencies = {}
        for name in ("jsonschema", "referencing", "click", "curl-cffi",
                     "python-dateutil", "langcodes", "language-data", "rfc3987"):
            try:
                dependencies[name] = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                dependencies[name] = None
        lock = tomllib.loads((self.root / "jsonschema" / "poetry.lock").read_text(encoding="utf-8"))
        locked = {item["name"]: item["version"] for item in lock.get("package", [])
                  if item["name"] in dependencies}
        self.metadata = {
            "source_repository": SOURCE_REPOSITORY, "source_commit": SOURCE_COMMIT,
            "source_manifest_sha256": SOURCE_MANIFEST_SHA256,
            "python": platform.python_version(), "dependencies": dependencies,
            "locked_dependencies": locked,
            "lock_matches": all(dependencies.get(name) == version for name, version in locked.items()),
            "checked_formats": sorted(formats),
        }
        if runtime_profile == "portable-python312":
            self.metadata["runtime_profile"] = {
                "id": "portable-python312.v1",
                "required_python": ">=3.12,<3.13",
                "upstream_required_python": project["project"]["requires-python"],
            }

    def _load_converter(self):
        """Load unchanged files without shadowing the installed jsonschema package."""
        jsonschema_root = self.root / "jsonschema"
        saved_transforms = sys.modules.get("transforms", MISSING)
        saved_bytecode = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        try:
            transform_spec = importlib.util.spec_from_file_location(
                "_merchant_dcat_original_transforms", jsonschema_root / "transforms.py")
            transforms = importlib.util.module_from_spec(transform_spec)
            transform_spec.loader.exec_module(transforms)
            sys.modules["transforms"] = transforms
            spec = importlib.util.spec_from_file_location(
                "_merchant_dcat_original_converter", jsonschema_root / "convert_dcat_1_1_to_3_0.py")
            converter = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(converter)
            return converter
        except ImportError as error:
            raise MigrationError("DEPENDENCY_UNAVAILABLE",
                                 "The original GSA converter could not load its dependencies.",
                                 {"exception": str(error)}) from error
        finally:
            sys.dont_write_bytecode = saved_bytecode
            if saved_transforms is MISSING:
                sys.modules.pop("transforms", None)
            else:
                sys.modules["transforms"] = saved_transforms

    def validator(self, schema_id, profile):
        return self.validator_class({"$ref": schema_id}, registry=self.registries[profile],
                                    format_checker=self.format_checker)

    def validate(self, catalog, profile, inventory):
        errors, exception, original_call_failed = [], None, False
        try:
            # Keep the original catalog-level outcome separate from its CLI exit.
            self.original.validate_catalog(PROFILE_IDS[profile], self.registries[profile], catalog)
        except self.original.CatalogValidationException as error:
            exception = {"type": type(error).__name__, "message": str(error)}
        except Exception as error:
            original_call_failed = True
            exception = {"type": type(error).__name__, "message": str(error)}
        try:
            errors = [self._validation_error(error)
                      for error in self.validator(PROFILE_IDS[profile], profile).iter_errors(catalog)]
            records = []
            for row in inventory["records"]:
                # Nested declared versions are validated in their own catalog scope.
                scope = next(item for item in inventory["catalogs"]
                             if item["path"] == row["catalog_path"])
                record_profile = scope["profile"]
                schema_id = (RECORD_SCHEMA_IDS["series"] if row["role"] == "dataset_series"
                             else RECORD_SCHEMA_IDS[record_profile])
                registry_profile = "3.0" if row["role"] == "dataset_series" else record_profile
                record_errors = [self._validation_error(error, row["path"])
                                 for error in self.validator(schema_id, registry_profile).iter_errors(
                                     inventory["_bodies"][row["path"]])]
                records.append({"path": row["path"], "identifier": row["identifier"],
                                "role": row["role"], "schema_id": schema_id,
                                "valid": not record_errors, "errors": record_errors})
            catalog_results = []
            for scope in inventory["catalogs"]:
                if scope["path"] == "":
                    continue
                scope_profile = scope["profile"]
                scope_errors = [self._validation_error(error, scope["path"])
                                for error in self.validator(PROFILE_IDS[scope_profile], scope_profile)
                                .iter_errors(inventory["_bodies"][scope["path"]])]
                catalog_results.append({"path": scope["path"], "profile": scope_profile,
                                        "valid": not scope_errors, "errors": scope_errors})
            observed_errors = bool(errors) or any(not row["valid"] for row in records) \
                or any(not row["valid"] for row in catalog_results)
            valid = None if original_call_failed and not observed_errors else exception is None and not observed_errors
            state = "UNAVAILABLE" if valid is None else "VALID" if valid else "INVALID"
            return {"valid": valid, "state": state,
                    "schema_id": PROFILE_IDS[profile], "errors": errors,
                    "exception": exception, "records": records, "catalogs": catalog_results}
        except Exception as error:
            return {"valid": None, "state": "UNAVAILABLE", "schema_id": PROFILE_IDS[profile],
                    "errors": errors,
                    "exception": {"type": type(error).__name__, "message": str(error),
                                  "catalog_validation": exception},
                    "records": []}

    def _validation_error(self, error, prefix=""):
        return {
            "path": prefix + _pointer(error.absolute_path),
            "schema_path": _pointer(error.absolute_schema_path),
            "validator": error.validator, "message": error.message,
            "context": [self._validation_error(child, prefix) for child in error.context],
        }

    def convert(self, catalog, profile, normalize_v3):
        messages, transformed, preserved = io.StringIO(), [], []

        def visit(node, path, inherited_profile):
            selected = inherited_profile if path == "" else (_declared_profile(node) or inherited_profile)
            should_convert = selected == "1.1" or normalize_v3
            if not should_convert:
                preserved.append(path)
                return copy.deepcopy(node)
            # The official converter owns direct dataset transforms and new
            # series. Existing series and nested catalogs have separate custody.
            source = copy.deepcopy(node)
            original_series = source.pop("datasetSeries", MISSING)
            result = self.original.convert_dcat_catalog(source)
            generated_series = result.pop("datasetSeries", [])
            if original_series is not MISSING:
                if isinstance(original_series, list):
                    result["datasetSeries"] = copy.deepcopy(original_series) + generated_series
                elif generated_series:
                    raise MigrationError("INVALID_SERIES_COLLECTION",
                                         "Existing datasetSeries must be corrected before normalization.",
                                         {"path": _join(path, "datasetSeries")})
                else:
                    result["datasetSeries"] = copy.deepcopy(original_series)
                preserved.append(_join(path, "datasetSeries"))
            elif generated_series:
                result["datasetSeries"] = generated_series
            for field in ("catalog", "hasPart"):
                if isinstance(node.get(field), list):
                    result[field] = [
                        visit(child, _join(_join(path, field), index), selected)
                        if isinstance(child, dict) else copy.deepcopy(child)
                        for index, child in enumerate(node[field])
                    ]
            transformed.append(path)
            return result

        try:
            with contextlib.redirect_stdout(messages), contextlib.redirect_stderr(messages):
                converted = visit(catalog, "", profile)
            return converted, {"state": "COMPLETE", "messages": messages.getvalue().splitlines(),
                               "error": None, "transformed_catalogs": transformed,
                               "preserved_structures": preserved}
        except Exception as error:
            return None, {"state": "FAILED", "messages": messages.getvalue().splitlines(),
                          "error": {"type": type(error).__name__, "message": str(error)},
                          "transformed_catalogs": transformed, "preserved_structures": preserved}


def _change_classification(path, kind, before, after):
    names = path.split("/")
    if any(name in ("identifier", "@id") for name in names):
        return "identifier"
    if "isPartOf" in names:
        return "relationship"
    if any(name in ("modified", "issued", "temporal", "accrualPeriodicity") for name in names):
        return "date_or_periodicity"
    if "language" in names:
        return "language"
    if "license" in names:
        return "license"
    if kind == "remove":
        return "removed"
    return "added" if kind == "add" else "representation"


def _field_changes(before, after, source_path, target_path, identifier, path=""):
    changes = []
    if before is MISSING and after is MISSING:
        return changes
    if before is not MISSING and after is not MISSING and _canonical(before) == _canonical(after):
        return changes
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            changes.extend(_field_changes(before.get(key, MISSING), after.get(key, MISSING),
                                          source_path, target_path, identifier, _join(path, key)))
        return changes
    if isinstance(before, list) and isinstance(after, list):
        for index in range(max(len(before), len(after))):
            changes.extend(_field_changes(before[index] if index < len(before) else MISSING,
                                          after[index] if index < len(after) else MISSING,
                                          source_path, target_path, identifier, _join(path, index)))
        return changes
    kind = "add" if before is MISSING else "remove" if after is MISSING else "replace"
    change = {"source_path": source_path, "target_path": target_path,
              "identifier": copy.deepcopy(identifier), "path": path,
              "source_pointer": source_path + path if source_path is not None else None,
              "target_pointer": target_path + path if target_path is not None else None,
              "kind": kind, "before_present": before is not MISSING,
              "after_present": after is not MISSING,
              "classification": _change_classification(path, kind, before, after)}
    if before is not MISSING:
        change["before"] = copy.deepcopy(before)
    if after is not MISSING:
        change["after"] = copy.deepcopy(after)
    changes.append(change)
    return changes


def _record_fields(value, role):
    if role == "dataset_series" and isinstance(value, dict):
        return {key: item for key, item in value.items() if key != "seriesMember"}
    return value


def _catalog_fields(value):
    return {key: item for key, item in value.items()
            if key not in ("dataset", "datasetSeries", "catalog", "hasPart")}


def _collection_changes(before, after, fields, source_path, target_path, identifier):
    changes = []
    for field in fields:
        old, new = before.get(field, MISSING), after.get(field, MISSING)
        # Member rows already describe changes within two retained arrays.
        if isinstance(old, list) and isinstance(new, list):
            continue
        changes.extend(_field_changes(old, new, source_path, target_path,
                                      identifier, _join("", field)))
    return changes


def _catalog_changes(source, target):
    changes = []
    source_groups, target_groups = defaultdict(list), defaultdict(list)
    for row in source["catalogs"]:
        source_groups[row["scope_key"]].append(row)
    for row in target["catalogs"]:
        target_groups[row["scope_key"]].append(row)
    for scope_key in sorted(set(source_groups) | set(target_groups)):
        before = source_groups.get(scope_key, [])
        after = target_groups.get(scope_key, [])
        if len(before) == len(after) == 1:
            old, new = before[0], after[0]
            changes.extend(_field_changes(
                _catalog_fields(source["_bodies"][old["path"]]),
                _catalog_fields(target["_bodies"][new["path"]]),
                old["path"], new["path"], old["identifier"]["value"]))
            changes.extend(_collection_changes(
                source["_bodies"][old["path"]], target["_bodies"][new["path"]],
                ("dataset", "datasetSeries", "catalog", "hasPart"),
                old["path"], new["path"], old["identifier"]["value"]))
        else:
            # Duplicate catalog identities cannot be silently paired.
            for row in before:
                changes.extend(_field_changes(
                    _catalog_fields(source["_bodies"][row["path"]]), MISSING,
                    row["path"], None, row["identifier"]["value"]))
            for row in after:
                changes.extend(_field_changes(
                    MISSING, _catalog_fields(target["_bodies"][row["path"]]),
                    None, row["path"], row["identifier"]["value"]))
    return changes


def _validate_explicit_mappings(mappings, source_by_path, target_by_path):
    if not isinstance(mappings, list):
        raise MigrationError("INVALID_IDENTITY_MAPPING", "identity_mappings must be an array")
    paired, used_source, used_target = [], set(), set()
    allowed = {"source_path", "target_path", "source_identifier", "target_identifier"}
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict) or set(mapping) != allowed:
            raise MigrationError("INVALID_IDENTITY_MAPPING",
                                 "Each identity mapping needs both exact paths and both identifier values.",
                                 {"index": index, "fields": sorted(allowed)})
        old_path, new_path = mapping["source_path"], mapping["target_path"]
        if not isinstance(old_path, str) or not isinstance(new_path, str):
            raise MigrationError("INVALID_IDENTITY_MAPPING", "Mapping paths must be JSON pointers")
        old, new = source_by_path.get(old_path), target_by_path.get(new_path)
        if old is None or new is None:
            raise MigrationError("STALE_IDENTITY_MAPPING",
                                 "An identity mapping does not name records in these editions.",
                                 {"index": index, "source_path": old_path, "target_path": new_path})
        if old_path in used_source or new_path in used_target:
            raise MigrationError("DUPLICATE_IDENTITY_MAPPING",
                                 "Each original and candidate record can be mapped only once.",
                                 {"index": index})
        if (_canonical(old["identifier"]) != _canonical(mapping["source_identifier"]) or
                _canonical(new["identifier"]) != _canonical(mapping["target_identifier"])):
            raise MigrationError("STALE_IDENTITY_MAPPING",
                                 "An identity mapping differs from the exact edition identifiers.",
                                 {"index": index, "source_path": old_path, "target_path": new_path})
        if not new["identity"]["usable"]:
            raise MigrationError("INVALID_IDENTITY_MAPPING",
                                 "The corrected candidate identifier must provide a usable identity.",
                                 {"index": index, "target_path": new_path})
        paired.append((old, new, "explicit"))
        used_source.add(old_path)
        used_target.add(new_path)
    return paired, used_source, used_target


def _relationship_changes(source, target, paired):
    """Track the original parent links through the same per-record mapping."""
    by_source_path = {old["path"]: new for old, new, _ in paired}
    parent_lookup = defaultdict(list)
    target_by_path = {row["path"]: row for row in target["records"]}
    for row in source["records"]:
        if row["identity"]["usable"]:
            parent_lookup[(row["scope_key"], row["identity"]["key"])].append(row)
    changes = []
    for old in source["records"]:
        body = source["_bodies"][old["path"]]
        if not isinstance(body, dict):
            continue
        legacy_parent = body.get("isPartOf")
        if old["role"] == "series_member":
            parents = [row for row in source["records"] if row["path"] == old["parent_path"]]
            source_parent = parents[0] if parents else None
        elif isinstance(legacy_parent, str) and legacy_parent.strip():
            parents = parent_lookup.get((old["scope_key"], "id:" + legacy_parent.strip()), [])
            source_parent = parents[0] if len(parents) == 1 else None
        else:
            continue
        new = by_source_path.get(old["path"])
        target_parent = target_by_path.get(new["parent_path"]) if new is not None else None
        expected_parent = by_source_path.get(source_parent["path"]) if source_parent is not None else None
        same = (new is not None and target_parent is not None and expected_parent is not None
                and target_parent["path"] == expected_parent["path"])
        # A preserved legacy relationship is also conserved in a directly
        # received 3.0 edition that still contains that retained field.
        if not same and new is not None and source_parent is not None:
            new_body = target["_bodies"][new["path"]]
            retained_parent = new_body.get("isPartOf") if isinstance(new_body, dict) else None
            same = (expected_parent is not None and isinstance(retained_parent, str)
                    and _identity(retained_parent)["key"] == expected_parent["identity"]["key"])
        changes.append({
            "source_path": old["path"], "target_path": new["path"] if new else None,
            "source_parent_path": source_parent["path"] if source_parent else None,
            "source_parent_identifier": source_parent["identifier"] if source_parent else legacy_parent,
            "expected_parent_path": expected_parent["path"] if expected_parent else None,
            "target_parent_path": target_parent["path"] if target_parent else None,
            "target_parent_identifier": target_parent["identifier"] if target_parent else None,
            "conserved": same,
        })
    return changes


def compare_catalogs(source_inventory, target_inventory, identity_mappings=None):
    """Compare catalog member identities and every owned nested metadata field."""
    source_by_path = {row["path"]: row for row in source_inventory["records"]}
    target_by_path = {row["path"]: row for row in target_inventory["records"]}
    paired, used_source, used_target = _validate_explicit_mappings(
        identity_mappings or [], source_by_path, target_by_path)
    source_groups, target_groups = defaultdict(list), defaultdict(list)
    for row in source_inventory["records"]:
        if row["path"] not in used_source and row["match_key"] is not None:
            source_groups[row["match_key"]].append(row)
    for row in target_inventory["records"]:
        if row["path"] not in used_target and row["match_key"] is not None:
            target_groups[row["match_key"]].append(row)
    for key in sorted(set(source_groups) & set(target_groups)):
        old, new = source_groups[key], target_groups[key]
        if len(old) == len(new) == 1:
            paired.append((old[0], new[0], "identity"))
            used_source.add(old[0]["path"])
            used_target.add(new[0]["path"])
    paired.sort(key=lambda item: item[0]["path"])
    mappings, changes = [], []
    for old, new, via in paired:
        old_body = source_inventory["_bodies"][old["path"]]
        new_body = target_inventory["_bodies"][new["path"]]
        both_series = old["role"] == new["role"] == "dataset_series"
        row_changes = _field_changes(
            _record_fields(old_body, old["role"]) if both_series else old_body,
            _record_fields(new_body, new["role"]) if both_series else new_body,
            old["path"], new["path"], old["identifier"])
        if both_series and isinstance(old_body, dict) and isinstance(new_body, dict):
            row_changes.extend(_collection_changes(old_body, new_body, ("seriesMember",),
                                                   old["path"], new["path"], old["identifier"]))
        changed = bool(row_changes)
        relocated = (old["path"] != new["path"] or old["role"] != new["role"])
        mappings.append({
            "source_path": old["path"], "target_path": new["path"],
            "source_identifier": old["identifier"], "target_identifier": new["identifier"],
            "source_role": old["role"], "target_role": new["role"],
            "source_catalog_path": old["catalog_path"], "target_catalog_path": new["catalog_path"],
            "via": via, "changed": changed, "relocated": relocated,
            "field_change_count": len(row_changes),
        })
        changes.extend(row_changes)
    missing = [row for row in source_inventory["records"] if row["path"] not in used_source]
    added = [row for row in target_inventory["records"] if row["path"] not in used_target]
    for row in missing:
        changes.extend(_field_changes(
            _record_fields(source_inventory["_bodies"][row["path"]], row["role"]),
            MISSING, row["path"], None, row["identifier"]))
    for row in added:
        changes.extend(_field_changes(
            MISSING, _record_fields(target_inventory["_bodies"][row["path"]], row["role"]),
            None, row["path"], row["identifier"]))
    relationships = _relationship_changes(source_inventory, target_inventory, paired)
    # A missing/ambiguous original identifier can be resolved explicitly against
    # its exact bytes and path; the corrected candidate must still be unique.
    unresolved_source_issues = []
    for issue in source_inventory["issues"]:
        source_path = issue["path"].rsplit("/", 1)[0] if issue["code"] == "UNRESOLVED_IDENTIFIER" else issue["path"]
        explicit = any(old["path"] == source_path and via == "explicit" for old, _, via in paired)
        if not explicit:
            unresolved_source_issues.append(issue)
    valid = (not missing and not added and not target_inventory["duplicates"]
             and not target_inventory["unidentified"]
             and not unresolved_source_issues and not target_inventory["issues"])
    conservation = {
        "valid": valid, "source_count": len(source_inventory["records"]),
        "target_count": len(target_inventory["records"]), "matched_count": len(paired),
        "changed_count": sum(row["changed"] for row in mappings),
        "unchanged_count": sum(not row["changed"] for row in mappings),
        "relocated_count": sum(row["relocated"] for row in mappings),
        "missing": missing, "added": added,
        "duplicates": {"source": source_inventory["duplicates"], "candidate": target_inventory["duplicates"]},
        "unidentified": {"source": source_inventory["unidentified"], "candidate": target_inventory["unidentified"]},
        "mappings": mappings, "relationships": relationships,
        "relationship_change_count": sum(not row["conserved"] for row in relationships),
        "inventory_issues": {"source": source_inventory["issues"],
                             "candidate": target_inventory["issues"]},
    }
    return {"conservation": conservation, "field_changes": changes,
            "catalog_changes": _catalog_changes(source_inventory, target_inventory)}


def _edition_comparison(source_inventory, target_inventory, source_sha256, target_sha256,
                        identity_mappings=None):
    result = compare_catalogs(source_inventory, target_inventory, identity_mappings)
    result.update(source_sha256=source_sha256, comparison_sha256=target_sha256)
    return result


def _unavailable_validation(message):
    return {"valid": None, "state": "UNAVAILABLE", "schema_id": PROFILE_IDS["3.0"],
            "errors": [], "exception": {"type": "ConversionUnavailable", "message": message},
            "records": [], "catalogs": []}


def review_catalog(source_bytes, *, source_profile="auto", comparison_bytes=None,
                   comparison_profile="auto", candidate_bytes=None, identity_mappings=None,
                   normalize_v3=False, original_root=None, runtime_profile="original"):
    """Review complete editions without modifying or publishing a caller's files.

    Explicit mappings bind the source and corrected candidate by exact JSON
    pointer and raw identifier values. Acceptance/publication uses the returned
    review_sha256 in the existing application operation and revision store.
    """
    if not isinstance(normalize_v3, bool):
        raise MigrationError("INVALID_OPTIONS", "normalize_v3 must be a boolean")
    if identity_mappings is not None and not isinstance(identity_mappings, list):
        raise MigrationError("INVALID_IDENTITY_MAPPING", "identity_mappings must be an array")
    source_catalog, source, source_text = _parse_bytes(source_bytes, "source")
    selected, declared = _select_profile(source_catalog, source_profile, "source")
    source.update(profile=selected, declared_profile=declared,
                  conforms_to=copy.deepcopy(source_catalog.get("conformsTo")))
    source_inventory = _comparison_inventory(source_text, selected)
    runtime = _OriginalRuntime(original_root or DEFAULT_ORIGINAL_ROOT,
                               runtime_profile=runtime_profile)
    source_validation = runtime.validate(
        source_catalog, selected, _validation_inventory(source_catalog, selected, source_inventory))
    comparison, comparison_catalog, comparison_inventory, comparison_validation = None, None, None, None
    if comparison_bytes is not None:
        comparison_catalog, comparison, comparison_text = _parse_bytes(comparison_bytes, "comparison")
        compare_selected, compare_declared = _select_profile(
            comparison_catalog, comparison_profile, "comparison")
        comparison.update(profile=compare_selected, declared_profile=compare_declared,
                          conforms_to=copy.deepcopy(comparison_catalog.get("conformsTo")))
        comparison_inventory = _comparison_inventory(comparison_text, compare_selected)
        comparison_validation = runtime.validate(
            comparison_catalog, compare_selected,
            _validation_inventory(comparison_catalog, compare_selected, comparison_inventory))
    baseline_catalog, baseline_bytes = None, None
    if selected == "3.0" and not normalize_v3:
        baseline_catalog, baseline_bytes = copy.deepcopy(source_catalog), bytes(source_bytes)
        conversion = {"state": "PRESERVED", "messages": [], "error": None,
                      "transformed_catalogs": [], "preserved_structures": [""]}
        mode = "preserve_3_0"
    else:
        baseline_catalog, conversion = runtime.convert(source_catalog, selected, normalize_v3)
        if baseline_catalog is not None:
            # Match the original export_converted_catalog JSON serialization.
            baseline_bytes = json.dumps(baseline_catalog, indent=2, ensure_ascii=False,
                                        allow_nan=False).encode("utf-8")
        mode = "normalize_3_0" if selected == "3.0" else "convert_1_1"
    candidate, candidate_catalog, candidate_text, candidate_inventory = None, None, None, None
    if candidate_bytes is not None:
        candidate_catalog, candidate, candidate_text = _parse_bytes(candidate_bytes, "candidate")
        candidate_raw = bytes(candidate_bytes)
        candidate.update(profile="3.0", declared_profile=_declared_profile(candidate_catalog),
                         origin="operator")
        mode = "review_candidate"
    elif baseline_bytes is not None:
        candidate_raw = baseline_bytes
        candidate_catalog, candidate, candidate_text = _parse_bytes(candidate_raw, "candidate")
        candidate.update(profile="3.0", declared_profile=_declared_profile(candidate_catalog),
                         origin="preserved" if conversion["state"] == "PRESERVED" else "converter")
    else:
        candidate_raw = None
    if candidate_catalog is not None:
        candidate_inventory = _comparison_inventory(candidate_text, "3.0")
        candidate_validation = runtime.validate(
            candidate_catalog, "3.0", _validation_inventory(candidate_catalog, "3.0", candidate_inventory))
        changes = compare_catalogs(source_inventory, candidate_inventory, identity_mappings)
    else:
        if identity_mappings:
            raise MigrationError("CANDIDATE_REQUIRED", "Identity mappings require an exact candidate edition.")
        candidate_validation = _unavailable_validation(
            conversion["error"]["message"] if conversion.get("error") else "No candidate was produced.")
        empty_inventory = _inventory({"dataset": []}, "3.0")
        changes = compare_catalogs(source_inventory, empty_inventory)
        changes["conservation"]["valid"] = False
    comparison_changes = None
    if comparison_inventory is not None:
        comparison_changes = _edition_comparison(
            source_inventory, comparison_inventory, source["sha256"], comparison["sha256"])
        comparison_changes["candidate_to_comparison"] = (
            _edition_comparison(candidate_inventory, comparison_inventory,
                                candidate["sha256"], comparison["sha256"])
            if candidate_inventory is not None else None)
    converter_output, operator_changes = None, None
    if baseline_bytes is not None:
        baseline_sha = _sha256(baseline_bytes)
        converter_output = {"sha256": baseline_sha, "bytes": len(baseline_bytes),
                            "origin": "preserved" if conversion["state"] == "PRESERVED" else "converter"}
        if candidate_bytes is not None:
            converter_output["base64"] = base64.b64encode(baseline_bytes).decode("ascii")
            converter_output["text"] = _parse_bytes(baseline_bytes, "converter output")[2]
            baseline_inventory = _comparison_inventory(converter_output["text"], "3.0")
            source_baseline = compare_catalogs(source_inventory, baseline_inventory)
            baseline_paths = {row["source_path"]: row["target_path"]
                              for row in source_baseline["conservation"]["mappings"]}
            baseline_by_path = {row["path"]: row for row in baseline_inventory["records"]}
            translated = []
            for mapping in identity_mappings or []:
                path = baseline_paths.get(mapping["source_path"], mapping["source_path"])
                old = baseline_by_path.get(path)
                if (mapping["source_path"] not in baseline_paths and old is not None
                        and _canonical(old["identifier"]) != _canonical(mapping["source_identifier"])):
                    old = None
                if old is not None:
                    translated.append({"source_path": path, "target_path": mapping["target_path"],
                                       "source_identifier": old["identifier"],
                                       "target_identifier": mapping["target_identifier"]})
            operator_changes = _edition_comparison(
                baseline_inventory, candidate_inventory, baseline_sha, candidate["sha256"], translated)
    issues = []
    if declared is not None and declared != selected:
        issues.append({"severity": "review", "code": "PROFILE_OVERRIDE", "path": "/conformsTo",
                       "message": "The selected source schema differs from its declaration.",
                       "declared_profile": declared, "selected_profile": selected})
    if source_validation["valid"] is not True:
        issues.append({"severity": "review", "code": "SOURCE_VALIDATION", "path": "",
                       "message": "The original source has validation exceptions retained in this review."})
    if conversion["state"] == "FAILED":
        issues.append({"severity": "review" if candidate_catalog is not None else "error",
                       "code": "CONVERSION_FAILED", "path": "",
                       "message": conversion["error"]["message"]})
    if candidate_validation["valid"] is not True:
        issues.append({"severity": "error", "code": "CANDIDATE_VALIDATION", "path": "",
                       "message": "The exact candidate must satisfy the original 3.0 validator."})
    if not changes["conservation"]["valid"]:
        issues.append({"severity": "error", "code": "IDENTIFIER_CONSERVATION", "path": "",
                       "message": "Resolve the unmatched, duplicated or unidentified candidate records."})
    for relationship in changes["conservation"]["relationships"]:
        if not relationship["conserved"]:
            issues.append({"severity": "review", "code": "RELATIONSHIP_CHANGE",
                           "path": relationship["source_path"],
                           "message": "The original parent relationship changed or has no unambiguous target.",
                           "relationship": relationship})
    if comparison_validation is not None and comparison_validation["valid"] is not True:
        issues.append({"severity": "review", "code": "COMPARISON_VALIDATION", "path": "",
                       "message": "The comparison edition has its own retained validation exceptions."})
    can_receive = candidate_validation["valid"] is True and changes["conservation"]["valid"]
    requires_review = bool(changes["field_changes"] or changes["catalog_changes"] or issues
                           or identity_mappings or normalize_v3)
    if comparison_changes is not None:
        requires_review = requires_review or bool(comparison_changes["field_changes"]
                                                  or comparison_changes["catalog_changes"])
    result = {
        "schema": SCHEMA, "mode": mode, "engine": runtime.metadata,
        "numeric_comparison": "exact-decimal.v1",
        "source": source, "candidate": candidate, "comparison": comparison,
        "candidate_text": candidate_text,
        "candidate_base64": base64.b64encode(candidate_raw).decode("ascii") if candidate_raw is not None else None,
        "conversion": conversion, "converter_output": converter_output,
        "validation": {"source": source_validation, "candidate": candidate_validation,
                       "comparison": comparison_validation},
        "conservation": changes["conservation"],
        "field_changes": changes["field_changes"], "catalog_changes": changes["catalog_changes"],
        "comparison_changes": comparison_changes, "operator_changes": operator_changes,
        "source_inventory": _public_inventory(source_inventory),
        "candidate_inventory": _public_inventory(candidate_inventory) if candidate_inventory is not None else None,
        "comparison_inventory": _public_inventory(comparison_inventory) if comparison_inventory is not None else None,
        "identity_mappings": copy.deepcopy(identity_mappings or []),
        "issues": issues, "can_receive": can_receive, "requires_review": requires_review,
        "summary": {
            "source_records": len(source_inventory["records"]),
            "candidate_records": len(candidate_inventory["records"]) if candidate_inventory is not None else 0,
            "matched_records": changes["conservation"]["matched_count"],
            "missing_records": len(changes["conservation"]["missing"]),
            "added_records": len(changes["conservation"]["added"]),
            "changed_records": changes["conservation"]["changed_count"],
            "relocated_records": changes["conservation"]["relocated_count"],
            "field_change_count": len(changes["field_changes"]),
            "catalog_change_count": len(changes["catalog_changes"]),
            "catalog_validation_errors": len(candidate_validation["errors"]),
            "invalid_records": sum(not row["valid"] for row in candidate_validation["records"]),
            "relationship_changes": changes["conservation"]["relationship_change_count"],
        },
    }
    result["review_sha256"] = _sha256(_canonical(result))
    return result


def process_request(request, *, original_root=None, runtime_profile="original"):
    if not isinstance(request, dict):
        raise MigrationError("INVALID_REQUEST", "The engine request must be an object")
    allowed = {"source_base64", "source_profile", "comparison_base64", "comparison_profile",
               "candidate_base64", "identity_mappings", "normalize_v3"}
    unexpected = sorted(set(request) - allowed)
    if unexpected:
        raise MigrationError("INVALID_REQUEST", "Unexpected engine request fields.",
                             {"fields": unexpected})

    def decode(name, required=False):
        value = request.get(name)
        if value is None and not required:
            return None
        if not isinstance(value, str):
            raise MigrationError("INVALID_REQUEST", name + " must contain original base64 bytes")
        try:
            return base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as error:
            raise MigrationError("INVALID_REQUEST", name + " is not valid base64") from error

    return review_catalog(
        decode("source_base64", True),
        source_profile=request.get("source_profile", "auto"),
        comparison_bytes=decode("comparison_base64"),
        comparison_profile=request.get("comparison_profile", "auto"),
        candidate_bytes=decode("candidate_base64"),
        identity_mappings=request.get("identity_mappings", []),
        normalize_v3=request.get("normalize_v3", False),
        original_root=original_root,
        runtime_profile=runtime_profile,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Review complete DCAT catalog editions using the original GSA converter.")
    parser.add_argument("--original-root", type=Path, default=DEFAULT_ORIGINAL_ROOT,
                        help="Installed pinned GSA source directory")
    parser.add_argument("--check-runtime", action="store_true",
                        help="Verify the original source and dependency/format runtime")
    parser.add_argument("--runtime-profile", choices=("original", "portable-python312"),
                        default="original",
                        help="Select the original Python requirement or the explicit Python3.12 profile")
    options = parser.parse_args(argv)
    try:
        if options.check_runtime:
            result = {"schema": "migration-runtime.v1", "ok": True,
                      "runtime": _OriginalRuntime(
                          options.original_root, runtime_profile=options.runtime_profile).metadata}
        else:
            try:
                request = json.load(sys.stdin, object_pairs_hook=_strict_object,
                                    parse_float=Decimal, parse_int=_comparison_integer,
                                    parse_constant=_reject_constant)
            except (ValueError, RecursionError) as error:
                raise MigrationError("INVALID_REQUEST", "The engine request is invalid JSON: " + str(error)) from error
            result = process_request(request, original_root=options.original_root,
                                     runtime_profile=options.runtime_profile)
        print(encode_review(result))
        return 0 if result.get("can_receive", result.get("ok", False)) else 2
    except MigrationError as error:
        print(json.dumps({"schema": "migration-error.v1", "error": error.as_dict()},
                         ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 3
    except Exception as error:
        print(json.dumps({"schema": "migration-error.v1",
                          "error": {"code": "ENGINE_ERROR", "type": type(error).__name__,
                                    "message": str(error)}},
                         ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
