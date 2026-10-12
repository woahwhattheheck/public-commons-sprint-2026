"""Versioned field bindings and complete native receiving comparisons."""
from __future__ import annotations
import csv
import io
from collections import Counter, defaultdict
from fractions import Fraction
from schema import (ENTITIES, FIELDS, RELATIONS, WorkspaceError, copy, digest, dumps, fraction,
                    identity, loads, record_key, relation_issues, utc_value, validate_record)

OMIT = object()

def staging_profile(source_edition_ids):
    fields = [{"entity": name, "source_field": field["name"], "target_entity": name,
               "target_field": field["name"], "mode": "copy"}
              for name, entity in ENTITIES.items() for field in entity["fields"]]
    return {
        "mapping_id": "ianz-arahono-staging-v1", "version": 1,
        "source_edition_ids": sorted(source_edition_ids), "field_maps": fields,
        "identity_maps": [], "enum_maps": [], "unit_maps": [], "blank_policies": [],
        "date_policies": [], "review": {"purpose": "Canonical staging with original field names", "decisions": []},
        "native_import_profile": {"format": "ianz.native-import/v1", "kind": "canonical_staging",
                                  "array_policies": [], "schema_file_id": None,
                                  "tables": [{"entity": name, "target_entity": name,
                                              "external_key": entity["key"]} for name, entity in ENTITIES.items()]}
    }

def validate_native_schema(value):
    if not isinstance(value, dict) or value.get("schema") != "ianz.native-schema/v1":
        raise WorkspaceError("Receive a complete ianz.native-schema/v1 descriptor with its original metadata file.")
    for name in ["product", "environment_id", "version"]:
        if not isinstance(value.get(name), str) or not value[name].strip():
            raise WorkspaceError("The target descriptor must retain its actual " + name + ".")
    tables = value.get("entities")
    if not isinstance(tables, list) or not tables or len(tables) > 1000:
        raise WorkspaceError("Receive the target's exact table and field metadata.")
    if len({row.get("name") for row in tables}) != len(tables):
        raise WorkspaceError("The target descriptor has duplicate tables.")
    for table in tables:
        if not isinstance(table.get("name"), str) or not table["name"]:
            raise WorkspaceError("The target table has no native name.")
        fields = table.get("fields")
        if not isinstance(fields, list) or len({field.get("name") for field in fields}) != len(fields):
            raise WorkspaceError("Target fields must be complete and uniquely named.")
        names = {field["name"] for field in fields}
        if not table.get("external_key") or any(name not in names for name in table["external_key"]):
            raise WorkspaceError("Select actual native external key fields for " + table["name"] + ".")
        for field in fields:
            if not isinstance(field.get("name"), str) or not isinstance(field.get("type"), str):
                raise WorkspaceError("Retain each actual native field name and type.")
    return copy(value)

def local_schema():
    return {"schema": "ianz.native-schema/v1", "product": "Ara Hono local receiving store",
            "environment_id": "local-reference-receiver", "version": "1",
            "import_contract": {"format": "ianz.native-import/v1", "request_identity": "request_id",
                                "external_key_upsert": True, "references": "two_pass_external_keys"},
            "document_model": {"identity": ["document_key", "document_edition_id"],
                               "content": "actual_complete_bytes", "access": "canonical_visibility"},
            "entities": [{"name": name, "external_key": entity["key"], "native_id_field": "_native_id",
                          "fields": [{"name": field["name"], "type": field["type"],
                                      "required": field["required"], "generated": False}
                                     for field in entity["fields"]]} for name, entity in ENTITIES.items()]}

def bind_matching_fields(profile, native_schema, schema_file_id, *, actor, reviewed_at):
    """A visible starting map; names are bound only where actually received."""
    native_schema = validate_native_schema(native_schema)
    result = copy(profile)
    result["mapping_id"] = "ianz-arahono-" + identity([native_schema["product"], native_schema["environment_id"]])[:12]
    result["version"] = 1
    result.update(target_product=native_schema["product"], target_environment_id=native_schema["environment_id"],
                  target_schema_version=native_schema["version"])
    tables = {row["name"]: row for row in native_schema["entities"]}
    result["field_maps"] = []
    result["native_import_profile"] = {
        "format": "ianz.native-import/v1", "kind": "received_native_schema",
        "schema_file_id": schema_file_id, "schema": native_schema, "array_policies": [],
        "tables": [{"entity": name, "target_entity": name, "external_key": tables[name]["external_key"]}
                   for name in ENTITIES if name in tables]}
    for name, entity in ENTITIES.items():
        target_fields = {field["name"] for field in tables.get(name, {}).get("fields", [])}
        for field in entity["fields"]:
            matched = name in tables and field["name"] in target_fields
            result["field_maps"].append({"entity": name, "source_field": field["name"],
                                        "target_entity": name if name in tables else None,
                                        "target_field": field["name"] if matched else None,
                                        "mode": "copy" if matched else "unmapped"})
    result["review"] = {"reviewed_by": actor, "reviewed_at": reviewed_at,
                        "purpose": "Received schema; exact equal names proposed for review", "decisions": []}
    return result

def validate_profile(profile):
    validate_record("mapping_profile", profile, complete=True)
    seen = set()
    targets = set()
    native = profile.get("native_import_profile") or {}
    native_schema = native.get("schema")
    tables = {}
    if native_schema:
        validate_native_schema(native_schema)
        if (profile.get("target_product") != native_schema["product"] or
                profile.get("target_environment_id") != native_schema["environment_id"] or
                profile.get("target_schema_version") != native_schema["version"]):
            raise WorkspaceError("The selected mapping and actual target schema identity differ.")
        tables = {row["name"]: row for row in native_schema["entities"]}
    for mapping in profile["field_maps"]:
        entity, field = mapping.get("entity"), mapping.get("source_field")
        if entity not in FIELDS or field not in FIELDS[entity]:
            raise WorkspaceError("Map an actual canonical field.", details=mapping)
        if (entity, field) in seen:
            raise WorkspaceError("A source field appears more than once in this mapping.", details=mapping)
        seen.add((entity, field))
        if mapping.get("mode") == "omit":
            if field in ENTITIES[entity]["key"] or FIELDS[entity][field]["required"]:
                raise WorkspaceError("Required source fields and original keys cannot be omitted.")
            if not isinstance(mapping.get("reason"), str) or not mapping["reason"].strip():
                raise WorkspaceError("A field omission needs its specific saved scope decision.")
            continue
        if mapping.get("mode") == "unmapped":
            continue
        if mapping.get("mode") != "copy" or not mapping.get("target_entity") or not mapping.get("target_field"):
            raise WorkspaceError("Select an explicit copy, reviewed omission or unresolved binding.", details=mapping)
        target = (mapping["target_entity"], mapping["target_field"])
        if target in targets:
            raise WorkspaceError("Two canonical fields target the same native field; resolve that mapping explicitly.", details=mapping)
        targets.add(target)
        if tables and (target[0] not in tables or target[1] not in {f["name"] for f in tables[target[0]]["fields"]}):
            raise WorkspaceError("The field binding is absent from the received target metadata.", details=mapping)
    expected = {(name, field) for name, fields in FIELDS.items() for field in fields}
    if seen != expected:
        raise WorkspaceError("Retain a mapping decision for every canonical field.",
                             details={"missing": sorted(expected - seen)})
    for name in ["enum_maps", "unit_maps", "blank_policies", "date_policies"]:
        keys = [(row.get("entity"), row.get("field")) for row in profile[name]]
        if len(keys) != len(set(keys)) or any(entity not in FIELDS or field not in FIELDS[entity] for entity, field in keys):
            raise WorkspaceError("The " + name + " contain duplicate or unknown fields.")
    for policy in profile["blank_policies"]:
        if policy.get("policy") not in {"preserve", "clear", "reject"}:
            raise WorkspaceError("Blank policy must preserve, clear or reject.")
    for policy in profile["date_policies"]:
        if policy.get("policy") not in {"preserve", "utc"}:
            raise WorkspaceError("Date policy must preserve source precision or convert an actual timestamp to UTC.")
        if policy["policy"] == "utc" and FIELDS[policy["entity"]][policy["field"]]["type"] != "datetime":
            raise WorkspaceError("UTC conversion applies only to complete timestamps.")
    for policy in profile["unit_maps"]:
        factor = Fraction(int(policy.get("numerator", "1")), int(policy.get("denominator", "1")))
        if not factor:
            raise WorkspaceError("A unit conversion cannot erase a value with a zero factor.")
        if FIELDS[policy["entity"]][policy["field"]]["type"] != "decimal-string":
            raise WorkspaceError("Unit conversion applies to an exact decimal field.")
    return profile

def decimal_text(value):
    value = Fraction(value)
    denominator = value.denominator
    twos = fives = 0
    while denominator % 2 == 0:
        denominator //= 2
        twos += 1
    while denominator % 5 == 0:
        denominator //= 5
        fives += 1
    if denominator != 1:
        raise WorkspaceError("This conversion has no finite decimal representation; receive a native rational or rounding contract.")
    scale = max(twos, fives)
    scaled = value.numerator * (10 ** scale // value.denominator)
    negative = "-" if scaled < 0 else ""
    digits = str(abs(scaled)).rjust(scale + 1, "0")
    return negative + (digits[:-scale] + "." + digits[-scale:] if scale else digits)

def _policies(profile, name):
    return {(row["entity"], row["field"]): row for row in profile.get(name, [])}

def _native_type(value, field):
    if value is None:
        if field.get("required"):
            raise WorkspaceError("The actual target requires a value for " + field["name"])
        return
    kind = field["type"]
    if kind in {"string", "foreign-key", "uri", "relative-path", "sha256", "enum", "date", "date-or-month", "month", "datetime", "decimal-string"}:
        if not isinstance(value, str):
            raise WorkspaceError("The target expects text for " + field["name"])
    if kind == "decimal-string":
        fraction(value)
    if kind == "integer" and type(value) is not int:
        raise WorkspaceError("The target expects an integer for " + field["name"])
    if kind == "boolean" and type(value) is not bool:
        raise WorkspaceError("The target expects a boolean for " + field["name"])
    if kind == "array" and not isinstance(value, list):
        raise WorkspaceError("The target expects a complete array for " + field["name"])
    if kind == "object" and not isinstance(value, dict):
        raise WorkspaceError("The target expects an object for " + field["name"])
    if field.get("values") is not None and value not in field["values"]:
        raise WorkspaceError("The value is outside the received target enumeration.", details={"field": field["name"], "value": value})

def export_dataset(records, profile):
    validate_profile(profile)
    maps = {(row["entity"], row["source_field"]): row for row in profile["field_maps"]}
    blank, enums, units, dates = [_policies(profile, name) for name in ["blank_policies", "enum_maps", "unit_maps", "date_policies"]]
    identities = {(row["entity"], row["source_key"]): row["target_key"] for row in profile["identity_maps"]}
    native = profile.get("native_import_profile") or {}
    target_schema = native.get("schema")
    target_fields = {table["name"]: {field["name"]: field for field in table["fields"]}
                     for table in (target_schema or {}).get("entities", [])}
    output, omissions, issues, relationships = [], [], [], []
    selected = set(profile["source_edition_ids"])
    selected_records = {}
    for entity, rows in records.items():
        selected_records[entity] = []
        for record in rows:
            values = record["values"]
            source = values.get("source_edition_id")
            # Scope editions are individually selected; source and programme/rate
            # support rows remain complete to resolve original references.
            if entity == "scope_item" and source not in selected:
                continue
            if entity in {"mapping_profile", "receiving_run"}:
                continue
            selected_records[entity].append(record)
    for entity, rows in selected_records.items():
        for record in rows:
            source = record["values"]
            key = record_key(entity, source)
            try:
                validate_record(entity, source, complete=True)
            except WorkspaceError as error:
                issues.append({"entity": entity, "key": key, **error.as_dict()})
                continue
            native_values = {}
            target_entity = None
            for field in ENTITIES[entity]["fields"]:
                name = field["name"]
                mapping = maps[(entity, name)]
                mode = mapping["mode"]
                has_value = name in source
                value = source.get(name)
                if mode == "omit":
                    omissions.append({"entity": entity, "key": key, "field": name,
                                      "value": value, "reason": mapping["reason"], "kind": "reviewed_omission"})
                    continue
                if mode == "unmapped":
                    if has_value and value is not None and value != "":
                        issues.append({"entity": entity, "key": key, "field": name, "kind": "unmapped_field"})
                    continue
                target_entity = target_entity or mapping["target_entity"]
                if target_entity != mapping["target_entity"]:
                    raise WorkspaceError("One canonical entity must map to one native table in this receiving profile.")
                choice = blank.get((entity, name), {}).get("policy", "reject" if field["required"] else "preserve")
                if not has_value or value is None or value == "":
                    if choice == "reject":
                        issues.append({"entity": entity, "key": key, "field": name, "kind": "rejected_blank"})
                    elif choice == "preserve":
                        omissions.append({"entity": entity, "key": key, "field": name,
                                          "source_present": has_value, "value": value, "kind": "preserve_target_blank"})
                    else:
                        native_values[mapping["target_field"]] = None
                    continue
                if (entity, name) in enums:
                    pairs = enums[(entity, name)].get("values", [])
                    matches = [pair for pair in pairs if pair["source"] == value]
                    if len(matches) != 1:
                        issues.append({"entity": entity, "key": key, "field": name, "value": value, "kind": "unmapped_enum"})
                        continue
                    value = matches[0]["target"]
                if (entity, name) in units:
                    rule = units[(entity, name)]
                    value = decimal_text(fraction(value) * Fraction(int(rule["numerator"]), int(rule["denominator"])))
                if dates.get((entity, name), {}).get("policy") == "utc":
                    import datetime
                    value = utc_value(value).astimezone(datetime.timezone.utc).isoformat()
                reference_entity = RELATIONS.get(entity, {}).get(name)
                if reference_entity:
                    original_refs = value if isinstance(value, list) else [value]
                    transformed = [identities.get((reference_entity, ref), ref) for ref in original_refs]
                    value = transformed if isinstance(value, list) else transformed[0]
                    relationships.extend({"entity": entity, "key": key, "field": name,
                                          "target_entity": reference_entity, "target_key": ref} for ref in original_refs)
                target_field = mapping["target_field"]
                if target_entity in target_fields:
                    _native_type(value, target_fields[target_entity][target_field])
                native_values[target_field] = value
            if target_entity:
                actual_fields = target_fields.get(target_entity, {})
                for target_name, specification in actual_fields.items():
                    if specification.get("required") and not specification.get("generated") and target_name not in native_values:
                        issues.append({"entity": entity, "key": key, "target_field": target_name, "kind": "missing_target_required_field"})
                output.append({"entity": entity, "key": key, "source_edition_id": source.get("source_edition_id"),
                               "record_edition_id": record["edition_id"], "target_entity": target_entity,
                               "external_key": identities.get((entity, key), key), "values": native_values})
    issues.extend(relation_issues(selected_records))
    expected_keys = [(row["target_entity"], dumps(row["external_key"])) for row in output]
    if len(expected_keys) != len(set(expected_keys)):
        issues.append({"kind": "duplicate_target_external_key"})
    return {"schema": "ianz.native-dataset/v1", "records": output, "omissions": omissions,
            "relationships": relationships, "issues": issues,
            "canonical_records": {entity: rows for entity, rows in selected_records.items() if rows}}

def csv_members(dataset, profile):
    """CSV is a readable target projection; typed JSON is the lossless companion."""
    tables = defaultdict(list)
    for row in dataset["records"]:
        tables[row["target_entity"]].append(row)
    result = {}
    for index, (table, rows) in enumerate(sorted(tables.items()), 1):
        fields = list(dict.fromkeys(field for row in rows for field in row["values"]))
        out = io.StringIO(newline="")
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow(["_original_entity", "_original_key", "_external_key"] + fields)
        for row in rows:
            def cell(field):
                if field not in row["values"]:
                    return ""
                value = row["values"][field]
                if isinstance(value, (dict, list, bool)) or value is None:
                    return dumps(value)
                return str(value)
            writer.writerow([row["entity"], row["key"], dumps(row["external_key"])] + [cell(field) for field in fields])
        result["native/" + str(index).zfill(2) + ".csv"] = out.getvalue().encode()
    return result

def _equal(expected, returned, field, policy=None):
    if type(expected) is not type(returned):
        return False
    if field and field.get("type") == "decimal-string" and expected is not None:
        try:
            return fraction(expected) == fraction(returned)
        except WorkspaceError:
            return False
    if isinstance(expected, list) and policy == "set":
        return {dumps(item) for item in expected} == {dumps(item) for item in returned}
    return expected == returned

def reconcile(dataset, profile, returned, expected_documents, returned_documents):
    if not isinstance(returned, dict) or returned.get("schema") != "ianz.native-return/v1":
        raise WorkspaceError("Receive the actual complete ianz.native-return/v1 extraction.")
    records = returned.get("records")
    if not isinstance(records, list):
        raise WorkspaceError("The returned extract has no record collection.")
    if returned.get("complete") is not True:
        raise WorkspaceError("The target extract must declare its complete selected cohort and any actual exclusions.")
    for name in ["target_product", "target_environment_id", "target_schema_version"]:
        if returned.get(name) != profile.get(name):
            raise WorkspaceError("The returned target identity differs from the selected mapping.", details={"field": name})
    differences = []
    def add(kind, **values):
        item = {"kind": kind, **values}
        item["difference_id"] = identity(item)
        differences.append(item)
    expected = {(row["target_entity"], dumps(row["external_key"])): row for row in dataset["records"]}
    observed = defaultdict(list)
    native_ids = defaultdict(list)
    for position, row in enumerate(records):
        if not isinstance(row, dict) or not isinstance(row.get("target_entity"), str) or "external_key" not in row or not isinstance(row.get("values"), dict):
            raise WorkspaceError("Each target row must retain its table, exact external key and full typed values.", details={"position": position})
        token = (row["target_entity"], dumps(row["external_key"]))
        observed[token].append(row)
        if row.get("native_id") is None:
            add("missing_native_id", target_entity=row["target_entity"], external_key=row["external_key"])
        else:
            native_ids[(row["target_entity"], dumps(row["native_id"]))].append(row["external_key"])
    for (table, native_id), keys in native_ids.items():
        if len(keys) > 1:
            add("duplicate_native_id", target_entity=table, native_id=loads(native_id), external_keys=keys)
    mapping = {(row["target_entity"], row["target_field"]): row for row in profile["field_maps"] if row.get("mode") == "copy"}
    arrays = {(row["entity"], row["field"]): row["policy"]
              for row in profile.get("native_import_profile", {}).get("array_policies", [])}
    matched = 0
    for token, source in expected.items():
        received = observed.get(token, [])
        if not received:
            add("missing_record", entity=source["entity"], key=source["key"], target_entity=token[0])
            continue
        if len(received) > 1:
            add("duplicate_return_key", entity=source["entity"], key=source["key"], count=len(received))
            continue
        row = received[0]
        matched += 1
        for target_field, original_value in source["values"].items():
            bound = mapping.get((source["target_entity"], target_field))
            field = FIELDS[bound["entity"]][bound["source_field"]] if bound else None
            if target_field not in row["values"]:
                add("missing_field", entity=source["entity"], key=source["key"], target_field=target_field,
                    source_field=bound["source_field"] if bound else None, expected=original_value)
            elif not _equal(original_value, row["values"][target_field], field,
                            arrays.get((bound["entity"], bound["source_field"])) if bound else None):
                add("field_difference", entity=source["entity"], key=source["key"], target_field=target_field,
                    source_field=bound["source_field"] if bound else None, expected=original_value,
                    returned=row["values"][target_field])
    for token, received in observed.items():
        if token not in expected:
            for row in received:
                add("extra_return_record", target_entity=row["target_entity"], external_key=row["external_key"],
                    native_id=row.get("native_id"))
    # Associations are native receipts from the actual second pass, separate
    # from a copied source foreign-key value.
    relation_tokens = {(r["entity"], r["key"], r["field"], r["target_entity"], r["target_key"])
                       for r in dataset["relationships"]}
    received_relations = returned.get("relationships", [])
    actual_relations = set()
    for relation in received_relations:
        token = tuple(relation.get(field) for field in ["entity", "key", "field", "target_entity", "target_key"])
        if token in actual_relations:
            add("duplicate_relation", relation=relation)
        actual_relations.add(token)
        if not relation.get("source_native_id") or not relation.get("target_native_id"):
            add("unresolved_native_relation", relation=relation)
    for relation in sorted(relation_tokens - actual_relations):
        add("missing_native_relation", relation=list(relation))
    for relation in sorted(actual_relations - relation_tokens, key=str):
        add("extra_native_relation", relation=list(relation))
    from documents import compare_documents
    document_comparison = compare_documents(expected_documents, returned_documents)
    for difference in document_comparison.get("differences", []):
        add("document_" + difference.get("kind", "difference"), document=difference)
    summary = {"expected_records": len(expected), "returned_records": len(records), "matched_records": matched,
               "expected_relationships": len(relation_tokens), "returned_relationships": len(received_relations),
               "difference_count": len(differences), "kinds": dict(Counter(row["kind"] for row in differences)),
               "omitted_fields": len(dataset["omissions"])}
    return {"schema": "ianz.reconciliation/v1", "differences": differences, "summary": summary,
            "documents": document_comparison, "omissions": dataset["omissions"],
            "returned_control_totals": returned.get("control_totals", {})}
