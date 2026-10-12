"""Customer inventory migration through NetBox's original ScriptJob.

Upload this file as a NetBox custom script. The preparation and operator CLIs
import its standard-library contract without requiring a local NetBox install.
Supported source: NetBox v4.7.2, commit 251458b89a5eb2f5fe0d20ecd1140ba08f141a9c.
"""
from __future__ import annotations

import datetime
import decimal
import hashlib
import ipaddress
import json
import re
from urllib.parse import urlsplit, urlunsplit

SCHEMA = "tjlabs.netbox.inventory/v1"
REVIEW_SCHEMA = "tjlabs.netbox.inventory-review/v1"
RECEIPT_SCHEMA = "tjlabs.netbox.inventory-receipt/v1"
SOURCE_COMMIT = "251458b89a5eb2f5fe0d20ecd1140ba08f141a9c"
MAX_BYTES = 8 * 1024 * 1024
MAX_OBJECTS = 5000
MAX_RESULT_BYTES = 64 * 1024 * 1024
ORDER = ("sites", "racks", "devices", "interfaces", "ip_addresses")
FIELDS = {
    "sites": {"name": "text", "slug": "text", "status": "text", "description": "text"},
    "racks": {"name": "text", "status": "text", "u_height": "int", "width": "int",
              "starting_unit": "int", "desc_units": "bool", "description": "text", "facility_id": "text"},
    "devices": {"name": "text", "status": "text", "serial": "text", "asset_tag": "text",
                "position": "decimal", "face": "text", "description": "text"},
    "interfaces": {"name": "text", "type": "text", "enabled": "bool", "mgmt_only": "bool",
                   "description": "text", "mtu": "int", "speed": "int", "duplex": "text"},
    "ip_addresses": {"address": "ip", "status": "text", "role": "text",
                     "dns_name": "text", "description": "text"},
}
LINKS = {"sites": {}, "racks": {"site": "sites"},
         "devices": {"site": "sites", "rack": "racks"},
         "interfaces": {"device": "devices"},
         "ip_addresses": {"interface": "interfaces"}}
CATALOG = {"sites": (), "racks": ("location",), "devices": ("device_type", "role", "platform", "location"),
           "interfaces": (), "ip_addresses": ("vrf",)}
REQUIRED_NEW = {"sites": ("name", "slug"), "racks": ("name",),
                "devices": ("name",), "interfaces": ("name", "type"),
                "ip_addresses": ("address",)}
PRIMARY_MANAGER_NAMES = (
    "consoleporttemplates", "consoleserverporttemplates", "powerporttemplates",
    "poweroutlettemplates", "coolingintaketemplates", "coolingoutflowtemplates",
    "interfacetemplates", "rearporttemplates", "frontporttemplates",
    "modulebaytemplates", "devicebaytemplates", "inventoryitemtemplates",
)


class InventoryError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InventoryError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def load_json(raw, limit=MAX_BYTES):
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if not isinstance(raw, bytes) or len(raw) > limit:
        raise InventoryError("The selected JSON file exceeds its supported byte limit.")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=lambda value: (_ for _ in ()).throw(InventoryError("Non-finite JSON value.")))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InventoryError("Invalid UTF-8 inventory JSON: " + str(exc)) from exc


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def positive_id(value):
    return integer(value) and value > 0


def keys(value, permitted, where):
    if not isinstance(value, dict):
        raise InventoryError(where + " must be an object.")
    unknown = set(value) - set(permitted)
    if unknown:
        raise InventoryError(where + " has unsupported fields: " + ", ".join(sorted(unknown)))


def clean_scalar(value, kind):
    if value is None:
        return None
    if kind == "text":
        if not isinstance(value, str) or "\x00" in value:
            raise InventoryError("Expected text without NUL characters.")
        return value
    if kind == "bool":
        if not isinstance(value, bool):
            raise InventoryError("Expected a JSON boolean.")
        return value
    if kind == "int":
        if not integer(value):
            raise InventoryError("Expected a JSON integer.")
        return value
    if kind == "decimal":
        if not isinstance(value, str) or not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value):
            raise InventoryError("Expected an exact decimal string.")
        return format(decimal.Decimal(value).normalize(), "f")
    if kind == "ip":
        if not isinstance(value, str) or "/" not in value:
            raise InventoryError("An IP address must include its actual prefix length.")
        try:
            return str(ipaddress.ip_interface(value))
        except ValueError as exc:
            raise InventoryError(str(exc)) from exc
    raise InventoryError("Unknown scalar type.")


def validate_packet(packet):
    keys(packet, ("schema", "operation_id", "tenant_id", "netbox_url", "sources", "objects", "source_notes"), "Inventory")
    if packet.get("schema") != SCHEMA:
        raise InventoryError("Unsupported inventory schema.")
    if not isinstance(packet.get("operation_id"), str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}", packet["operation_id"]):
        raise InventoryError("operation_id must be a stable 8–128 character identifier.")
    url = urlsplit(str(packet.get("netbox_url", "")))
    if url.scheme not in ("https", "http") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise InventoryError("Retain the exact NetBox base URL without credentials, query or fragment.")
    packet["netbox_url"] = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/"), "", ""))
    if not positive_id(packet.get("tenant_id")):
        raise InventoryError("Select the existing NetBox tenant ID.")
    if not isinstance(packet.get("source_notes", ""), str):
        raise InventoryError("source_notes must be text.")
    sources = packet.get("sources")
    if not isinstance(sources, list) or not sources or len(sources) > 32:
        raise InventoryError("Retain one to 32 source-file identities.")
    seen_sources = set()
    for item in sources:
        keys(item, ("name", "sha256", "bytes", "rows"), "Source")
        if not isinstance(item.get("name"), str) or not item["name"] or "/" in item["name"] or "\\" in item["name"]:
            raise InventoryError("A source name must be a filename.")
        if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
            raise InventoryError("A source needs its exact SHA-256.")
        if not integer(item.get("bytes")) or item["bytes"] < 0 or not integer(item.get("rows")) or item["rows"] < 0:
            raise InventoryError("A source needs its exact byte and row counts.")
        if item["sha256"] in seen_sources:
            raise InventoryError("A source file identity is repeated.")
        seen_sources.add(item["sha256"])
    rows = packet.get("objects")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_OBJECTS:
        raise InventoryError("The inventory must contain one to 5,000 selected objects.")
    seen = {}
    for row in rows:
        keys(row, ("kind", "key", "match_id", "fields", "links", "catalog", "primary", "source"), "Object")
        kind, key = row.get("kind"), row.get("key")
        if kind not in ORDER or not isinstance(key, str) or not key or len(key) > 200 or "\x00" in key:
            raise InventoryError("Every row needs a supported kind and stable source key.")
        if (kind, key) in seen:
            raise InventoryError("Duplicate source key: " + kind + "/" + key)
        seen[kind, key] = row
        if "match_id" in row and not positive_id(row["match_id"]):
            raise InventoryError(kind + "/" + key + ": match_id must be a positive original NetBox ID.")
        fields = row.get("fields", {})
        keys(fields, FIELDS[kind], kind + "/" + key + " fields")
        for field, value in fields.items():
            fields[field] = clean_scalar(value, FIELDS[kind][field])
            if kind == "ip_addresses" and field == "dns_name" and isinstance(fields[field], str):
                fields[field] = fields[field].lower()
        links = row.get("links", {})
        keys(links, LINKS[kind], kind + "/" + key + " links")
        for field, target in links.items():
            if target is None:
                if field != "rack":
                    raise InventoryError("Only the optional rack link may be explicitly cleared.")
                continue
            keys(target, ("key", "id"), field + " link")
            if set(target) == {"id"} and positive_id(target["id"]):
                continue
            if set(target) == {"key"} and isinstance(target["key"], str) and target["key"]:
                continue
            raise InventoryError(field + " must name one source key or one original NetBox ID.")
        catalogue = row.get("catalog", {})
        keys(catalogue, CATALOG[kind], kind + "/" + key + " catalogue")
        for field, value in catalogue.items():
            if not positive_id(value) and not (value is None and field in ("platform", "vrf", "location")):
                raise InventoryError(field + " must be an existing NetBox ID.")
        if "primary" in row and (kind != "ip_addresses" or not isinstance(row["primary"], bool)):
            raise InventoryError("primary is a boolean option on an IP-address row.")
        provenance = row.get("source")
        keys(provenance, ("sha256", "row", "row_sha256"), "Row source")
        if provenance.get("sha256") not in seen_sources or not positive_id(provenance.get("row")):
            raise InventoryError("The original source-file identity and data-row number are required.")
        if not re.fullmatch(r"[0-9a-f]{64}", str(provenance.get("row_sha256", ""))):
            raise InventoryError("Retain the original data-row SHA-256.")
    for row in rows:
        for field, target in row.get("links", {}).items():
            if target and "key" in target and (LINKS[row["kind"]][field], target["key"]) not in seen:
                raise InventoryError(row["kind"] + "/" + row["key"] + ": missing " + field + " source key.")
    return packet


def scalar(value):
    if isinstance(value, decimal.Decimal):
        return format(value.normalize(), "f")
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, bool, float)):
        return value
    if isinstance(value, dict):
        return {str(key): scalar(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [scalar(item) for item in value]
    return str(value)


def _bindings():
    from dcim.models import Device, DeviceRole, DeviceType, Interface, Location, Platform, Rack, Site
    from extras.models import JournalEntry
    from ipam.models import IPAddress, VRF
    from tenancy.models import Tenant
    return ({"sites": Site, "racks": Rack, "devices": Device, "interfaces": Interface,
             "ip_addresses": IPAddress},
            {"device_type": DeviceType, "role": DeviceRole, "platform": Platform, "location": Location, "vrf": VRF},
            JournalEntry, Tenant)


def _allowed(user, model, action, obj=None, alias=None):
    permission = model._meta.app_label + "." + action + "_" + model._meta.model_name
    if user is None or not user.is_authenticated or not user.has_perm(permission):
        raise InventoryError("The current NetBox user lacks " + permission + ".")
    if obj is not None:
        query = model.objects.using(alias).restrict(user, action).filter(pk=obj.pk)
        if not query.exists():
            raise InventoryError("The selected " + model._meta.verbose_name + " is outside the user's " + action + " scope.")


def _one(model, alias, query, user, lock=False):
    objects = model.objects.using(alias).filter(**query)
    if lock:
        objects = objects.select_for_update()
    found = list(objects[:2])
    if len(found) > 1:
        raise InventoryError("The native match is ambiguous; record the intended original NetBox match_id.")
    if not found:
        return None
    _allowed(user, model, "view", found[0], alias)
    return found[0]


def _reference(row, field, originals, models, alias, user, lock=False):
    target = row.get("links", {}).get(field)
    if target is None:
        return None
    kind = LINKS[row["kind"]][field]
    if "key" in target:
        return originals.get((kind, target["key"]))
    value = _one(models[kind], alias, {"pk": target["id"]}, user, lock)
    if value is None:
        raise InventoryError("The original " + field + " ID no longer exists.")
    return value


def _lookup(row, originals, models, alias, user, lock=False):
    kind = row["kind"]
    model = models[kind]
    if "match_id" in row:
        result = _one(model, alias, {"pk": row["match_id"]}, user, lock)
        if result is None:
            raise InventoryError("The reviewed original match_id no longer exists.")
        return result
    fields = row.get("fields", {})
    if kind == "sites":
        if not fields.get("slug"):
            raise InventoryError("A site requires its slug or an explicit original match_id.")
        query = {"slug": fields["slug"]}
    elif kind in ("racks", "devices", "interfaces"):
        parent_field = "device" if kind == "interfaces" else "site"
        parent = _reference(row, parent_field, originals, models, alias, user, lock)
        if parent is None:
            return None
        if not fields.get("name"):
            raise InventoryError("A natural match requires a name or explicit original match_id.")
        query = {"name": fields["name"], parent_field: parent}
        if kind == "devices":
            query["tenant_id"] = row["_tenant_id"]
    else:
        if not fields.get("address"):
            raise InventoryError("An IP address requires its actual address or original match_id.")
        query = {"address": fields["address"], "vrf_id": row.get("catalog", {}).get("vrf")}
    return _one(model, alias, query, user, lock)


def _catalogue_context(model, obj):
    names = [field.attname for field in obj._meta.concrete_fields
             if field.name not in ("created", "last_updated") and not field.name.startswith("_")]
    result = {name: scalar(getattr(obj, name)) for name in names}
    if model._meta.label_lower == "dcim.devicetype":
        templates = {}
        for manager_name in PRIMARY_MANAGER_NAMES:
            manager = getattr(obj, manager_name)
            rows = []
            for item in manager.using(obj._state.db).select_for_update().order_by("pk"):
                names = [field.attname for field in item._meta.concrete_fields
                         if field.name not in ("created", "last_updated")
                         and not field.name.startswith("_")]
                rows.append({name: scalar(getattr(item, name)) for name in names})
            templates[manager_name] = rows
        result["component_templates"] = templates
        result["port_mappings"] = [
            {field.attname: scalar(getattr(item, field.attname)) for field in item._meta.concrete_fields
             if field.name not in ("created", "last_updated") and not field.name.startswith("_")}
            for item in obj.port_mappings.using(obj._state.db).select_for_update().order_by("pk")
        ]
    return result


def _native_value(obj, field, inverse):
    if field == "interface":
        value = obj.assigned_object
    else:
        value = getattr(obj, field)
    if value is not None and hasattr(value, "_meta"):
        key = inverse.get((value._meta.label_lower, value.pk))
        return {"key": key[1], "kind": key[0]} if key else {"id": value.pk, "model": value._meta.label_lower}
    return scalar(value)


def _managed_fields(row):
    result = set(row.get("fields", {})) | set(row.get("links", {})) | set(row.get("catalog", {}))
    if row["kind"] != "interfaces":
        result.add("tenant")
    if row["kind"] == "devices":
        result |= {"site", "rack", "location", "platform", "airflow", "cooling_method"}
    return sorted(result)


def _snapshot(row, obj, inverse):
    names = set(_managed_fields(row))
    if row["kind"] == "racks":
        names |= set(obj.RACKTYPE_FIELDS) | {"rack_type", "outer_unit"}
    return {name: _native_value(obj, name, inverse) for name in sorted(names)}


def _ordered_native_rows(rows, originals, alias):
    """Retain source ordering, with native bay parents before mapped children."""
    from dcim.models import DeviceBay
    by_id = {obj.pk: label for label, obj in originals.items() if label[0] == "devices" and obj is not None}
    parents = dict(DeviceBay.objects.using(alias).select_for_update().filter(
        installed_device_id__in=by_id).order_by("pk").values_list("installed_device_id", "device_id"))
    depths = {}
    def depth(pk, visiting):
        if pk in depths:
            return depths[pk]
        if pk in visiting:
            raise InventoryError("The original device-bay hierarchy contains a cycle.")
        parent = parents.get(pk)
        value = 1 + depth(parent, visiting | {pk}) if parent in by_id else 0
        depths[pk] = value
        return value
    for pk in by_id:
        depth(pk, set())
    return sorted(rows, key=lambda row: (
        ORDER.index(row["kind"]),
        depths.get(getattr(originals[(row["kind"], row["key"])], "pk", None), 0)
            if row["kind"] == "devices" else 0,
        row["key"],
    ))


def _track_native_children(device, models, alias, user, tracked, inverse):
    """Capture the ORIGINAL Device.save child propagation before it occurs."""
    from dcim.models import DeviceBay
    Device = models["devices"]
    pending, visited = [device.pk], set()
    while pending:
        parent_id = pending.pop()
        if parent_id in visited:
            raise InventoryError("The selected native device-bay hierarchy contains a cycle.")
        visited.add(parent_id)
        # Lock existing bays as well as children: installing/replacing a child
        # must not race the reviewed native Device.save traversal.
        list(DeviceBay.objects.using(alias).select_for_update().filter(device_id=parent_id).order_by("pk"))
        children = list(Device.objects.using(alias).select_for_update().filter(
            parent_bay__device_id=parent_id).order_by("pk"))
        for child in children:
            _allowed(user, Device, "view", child, alias)
            _allowed(user, Device, "change", child, alias)
            if child.pk not in tracked:
                tracked[child.pk] = {
                    "before": {name: _native_value(child, name, inverse) for name in ("site", "rack", "location")},
                    "name": child.name, "parent_id": parent_id,
                }
                if len(tracked) > MAX_OBJECTS:
                    raise InventoryError("The affected native child-device hierarchy exceeds 5,000 objects.")
            pending.append(child.pk)


def _finalize_native_children(models, alias, user, tracked, inverse):
    Device = models["devices"]
    effects = []
    for pk, captured in sorted(tracked.items()):
        child = Device.objects.using(alias).select_for_update().get(pk=pk)
        _allowed(user, Device, "change", child, alias)
        after = {name: _native_value(child, name, inverse) for name in ("site", "rack", "location")}
        changed = captured["before"] != after
        if changed:
            try:
                child.full_clean()
            except Exception as exc:
                raise InventoryError("Native child device " + str(pk) + ": " + str(exc)) from exc
        # A mapped child's final state appears in its own complete row.
        if ("dcim.device", pk) not in inverse:
            effects.append({
                "kind": "device_children", "key": str(pk),
                "action": "UPDATE" if changed else "KEEP",
                "device": {"id": pk, "name": captured["name"]},
                "parent_id": captured["parent_id"],
                "before": captured["before"], "after": after,
                "source": "Original NetBox Device.save child-device propagation",
            })
    return effects


def _generated_projection(created_devices, alias, inverse):
    """Review the ACTUAL components/defaults created by original Device.save."""
    collected = []
    for device_key, device in created_devices:
        for template_manager in PRIMARY_MANAGER_NAMES:
            manager_name = template_manager.removesuffix("templates") + "s"
            manager = getattr(device, manager_name)
            for obj in manager.using(alias).select_for_update().order_by("pk"):
                collected.append((device_key, manager_name, obj))
        for obj in device.port_mappings.using(alias).select_for_update().order_by("pk"):
            collected.append((device_key, "port_mappings", obj))
    components_by_id = {(obj._meta.label_lower, obj.pk): obj for _, _, obj in collected}
    identities = {}
    def identity(device_key, obj, visiting):
        native = (obj._meta.label_lower, obj.pk)
        if native in identities:
            return identities[native]
        if native in visiting:
            raise InventoryError("The generated native component hierarchy contains a cycle.")
        parent_field = next((field for field in obj._meta.concrete_fields if field.name == "parent" and field.is_relation), None)
        parent = getattr(obj, "parent", None) if parent_field else None
        parent_native = (parent._meta.label_lower, parent.pk) if parent is not None else None
        ancestor = identity(device_key, parent, visiting | {native}) if parent_native in components_by_id else None
        if hasattr(obj, "name"):
            local = {"name": obj.name, "parent": ancestor}
        else:
            # Original port mappings have a stable front/rear position identity.
            local = {name: _native_value(obj, name, inverse)
                     for name in ("front_port", "front_port_position", "rear_port", "rear_port_position")}
        key = canonical({"device": device_key, "model": obj._meta.label_lower, "component": local})
        identities[native] = key
        return key
    # All named components precede mappings so their generated IDs normalize.
    for device_key, family, obj in collected:
        if family == "port_mappings":
            continue
        key = identity(device_key, obj, set())
        inverse.setdefault((obj._meta.label_lower, obj.pk), ("generated/" + obj._meta.label_lower, key))
    output = {}
    seen = set()
    for device_key, family, obj in collected:
        key = identity(device_key, obj, set())
        marker = (obj._meta.label_lower, key)
        if marker in seen:
            raise InventoryError("The generated native component identity is ambiguous.")
        seen.add(marker)
        generic_fields = [field for field in obj._meta.private_fields
                          if isinstance(getattr(field, "ct_field", None), str)
                          and isinstance(getattr(field, "fk_field", None), str)]
        generic_storage = {name for field in generic_fields for name in (field.ct_field, field.fk_field)}
        fields = {
            field.name: _native_value(obj, field.name, inverse)
            for field in obj._meta.concrete_fields
            # Ltree path contains newly allocated database IDs. The native
            # parent relation and component identity retain the same hierarchy.
            if field.name not in ("id", "created", "last_updated", "path")
            and field.name not in generic_storage and not field.name.startswith("_")
        }
        for field in generic_fields:
            # Native InventoryItem.component_id can point to another generated
            # component. Bind that original GFK to its logical identity too.
            fields[field.name] = _native_value(obj, field.name, inverse)
        relations = {}
        for field in obj._meta.many_to_many:
            manager = getattr(obj, field.name)
            values = []
            for target in manager.all().using(alias).select_for_update().order_by("pk"):
                values.append({
                    "model": target._meta.label_lower, "id": target.pk,
                    "fields": {part.name: _native_value(target, part.name, inverse)
                               for part in target._meta.concrete_fields
                               if part.name not in ("created", "last_updated") and not part.name.startswith("_")},
                })
            relations[field.name] = values
        output.setdefault(device_key, []).append({
            "family": family, "model": obj._meta.label_lower, "key": key,
            "fields": fields, "many_to_many": relations,
        })
    return [{"device_key": key, "components": sorted(values, key=lambda row: (row["family"], row["key"])),
             "component_counts": {family: sum(row["family"] == family for row in values)
                                  for family in sorted({row["family"] for row in values})}}
            for key, values in sorted(output.items())]


REVIEW_FIELDS = ("operation_id", "payload_sha256", "netbox_url", "tenant", "database_schema",
                 "contract_source_commit", "netbox_version", "sources", "source_notes",
                 "changes", "catalogue", "generated_components")


def validate_native_result(value, operation_id, payload_sha256):
    if not isinstance(value, dict) or value.get("operation_id") != operation_id or value.get("payload_sha256") != payload_sha256:
        raise InventoryError("This native result belongs to another source operation.")
    if value.get("schema") not in (REVIEW_SCHEMA, RECEIPT_SCHEMA):
        raise InventoryError("Unsupported native inventory result.")
    try:
        review = {"schema": REVIEW_SCHEMA, **{key: value[key] for key in REVIEW_FIELDS}}
    except KeyError as exc:
        raise InventoryError("The complete original review is missing from the result.") from exc
    if digest(review) != value.get("review_digest"):
        raise InventoryError("The original native review digest does not match the retained result.")
    counts = {name: sum(change.get("action") == name for change in value["changes"])
              for name in ("CREATE", "UPDATE", "KEEP")}
    if value.get("counts") != counts:
        raise InventoryError("The native review counts differ from its complete changes.")
    if value["schema"] == RECEIPT_SCHEMA:
        if value.get("state") != "APPLIED":
            raise InventoryError("The journal does not contain an applied inventory receipt.")
        receipt = {key: item for key, item in value.items()
                   if key not in ("journal", "execution_reference", "receipt_sha256")}
        if digest(receipt) != value.get("receipt_sha256"):
            raise InventoryError("The original committed receipt bytes do not match their retained identity.")
    elif value.get("state") != "REVIEWED":
        raise InventoryError("The native result is not a completed review.")
    return value


def _receipt_prefix(operation_id):
    return "TJLabs inventory migration\nOperation: " + operation_id + "\n\n"


def _decode_receipt(entry, packet_hash, operation_id):
    prefix = _receipt_prefix(operation_id)
    try:
        receipt = load_json(entry.comments[len(prefix):], limit=MAX_RESULT_BYTES)
    except (InventoryError, IndexError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise InventoryError("The original migration journal entry requires operator review.") from exc
    if (receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("payload_sha256") != packet_hash
            or receipt.get("operation_id") != operation_id):
        raise InventoryError("This operation ID already belongs to another retained source inventory.")
    validate_native_result(receipt, operation_id, packet_hash)
    return {**receipt, "journal": {"id": entry.pk, "url": entry.get_absolute_url()}}


def migrate(script, packet, tenant, commit, review_digest):
    from django.conf import settings
    from django.contrib.contenttypes.models import ContentType
    from django.db import connections, router
    from django.utils import timezone
    from extras.choices import JournalEntryKindChoices
    from utilities.exceptions import AbortScript

    packet = validate_packet(packet)
    if packet["tenant_id"] != tenant.pk:
        raise InventoryError("The selected native tenant and retained inventory tenant differ.")
    models, catalogue_models, JournalEntry, Tenant = _bindings()
    aliases = {router.db_for_write(model) for model in (*models.values(), JournalEntry, Tenant)}
    if len(aliases) != 1:
        raise InventoryError("The selected inventory and native journal must share the same database transaction.")
    alias = aliases.pop()
    connection = connections[alias]
    if not connection.in_atomic_block:
        raise InventoryError("Run this inventory through NetBox's original ScriptJob transaction.")
    request = getattr(script, "request", None)
    user = getattr(request, "user", None)
    _allowed(user, Tenant, "view", tenant, alias)
    path = getattr(request, "path", "")
    markers = [marker for marker in ("/api/extras/scripts/", "/extras/scripts/") if marker in path]
    if not markers:
        raise InventoryError("Use the authenticated NetBox script web page or its original REST endpoint.")
    prefix = path.split(markers[0], 1)[0]
    actual_url = request.build_absolute_uri("/").rstrip("/") + prefix
    if actual_url != packet["netbox_url"]:
        raise InventoryError("This inventory is prepared for another NetBox base URL.")
    payload_hash = digest(packet)
    with connection.cursor() as cursor:
        lock_key = int.from_bytes(hashlib.sha256(("tjlabs.inventory/tenant/" + str(tenant.pk)).encode()).digest()[:8],
                                  "big", signed=True)
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (lock_key,))
        cursor.execute("SELECT current_schema()")
        database_schema = cursor.fetchone()[0]
    native_tenant = Tenant.objects.using(alias).select_for_update().get(pk=tenant.pk)
    content_type = ContentType.objects.get_for_model(Tenant)
    _allowed(user, JournalEntry, "view")
    entries = list(JournalEntry.objects.using(alias).select_for_update().filter(
        assigned_object_type_id=content_type.pk, assigned_object_id=tenant.pk,
        comments__startswith=_receipt_prefix(packet["operation_id"]))[:2])
    if len(entries) > 1:
        raise InventoryError("More than one native journal entry uses this operation ID; select the original with the operator.")
    if entries:
        _allowed(user, JournalEntry, "view", entries[0], alias)
        retained = _decode_receipt(entries[0], payload_hash, packet["operation_id"])
        script.log_success("Reopened the original committed inventory and its journal receipt.")
        return retained

    source_rows = sorted(packet["objects"], key=lambda row: (ORDER.index(row["kind"]), row["key"]))
    rows = [{**row, "_tenant_id": tenant.pk} for row in source_rows]
    originals, inverse, catalogues, original_snapshots = {}, {}, {}, {}
    used_native_ids = set()

    # Capture every pre-existing selected object before any model is changed.
    for row in rows:
        label = (row["kind"], row["key"])
        try:
            original = _lookup(row, originals, models, alias, user, lock=True)
            if original is not None:
                native_id = (original._meta.label_lower, original.pk)
                if native_id in used_native_ids:
                    raise InventoryError("Two source rows match the same original NetBox object.")
                used_native_ids.add(native_id)
                inverse[native_id] = label
            originals[label] = original
            if original is not None and row["kind"] == "racks" and original.rack_type_id:
                model = type(original.rack_type)
                identity = (model._meta.label_lower, original.rack_type_id)
                if identity not in catalogues:
                    value = _one(model, alias, {"pk": original.rack_type_id}, user, lock=True)
                    catalogues[identity] = (value, _catalogue_context(model, value))
            for field, pk in row.get("catalog", {}).items():
                if pk is None:
                    continue
                model = catalogue_models[field]
                identity = (model._meta.label_lower, pk)
                if identity not in catalogues:
                    value = _one(model, alias, {"pk": pk}, user, lock=True)
                    if value is None:
                        raise InventoryError("The selected " + field + " catalogue ID no longer exists.")
                    catalogues[identity] = (value, _catalogue_context(model, value))
        except InventoryError as exc:
            raise InventoryError(row["kind"] + "/" + row["key"] + ": " + str(exc)) from exc

    for row in rows:
        label = (row["kind"], row["key"])
        obj = originals[label]
        original_snapshots[label] = _snapshot(row, obj, inverse) if obj else None

    rows = _ordered_native_rows(rows, originals, alias)
    resolved = dict(originals)
    changes, results, primary_requests, generated = [], [], {}, []
    created_devices = []
    child_devices, intended_fields = {}, {}
    for row in rows:
        kind, key = row["kind"], row["key"]
        label = (kind, key)
        model = models[kind]
        original = originals[label]
        before = original_snapshots[label]
        try:
            # A newly created device may already have instantiated this interface
            # through its ORIGINAL DeviceType component templates.
            obj = original or _lookup(row, resolved, models, alias, user, lock=True)
            generated_component = bool(original is None and obj is not None)
            if obj is None:
                obj = model()
            if obj.pk:
                obj.refresh_from_db(using=alias)
            action = "change" if obj.pk else "add"
            _allowed(user, model, action, obj if obj.pk else None, alias)
            if obj.pk:
                obj.snapshot()
            if kind != "interfaces":
                obj.tenant = native_tenant
            for field, value in row.get("fields", {}).items():
                if FIELDS[kind][field] == "decimal" and value is not None:
                    value = decimal.Decimal(value)
                setattr(obj, field, value)
            for field, target in row.get("links", {}).items():
                linked = _reference(row, field, resolved, models, alias, user, lock=True)
                if target is not None and linked is None:
                    raise InventoryError("The selected " + field + " has no prepared original object.")
                if field == "interface":
                    obj.assigned_object = linked
                else:
                    setattr(obj, field, linked)
            for field, pk in row.get("catalog", {}).items():
                setattr(obj, field, None if pk is None else catalogues[
                    (catalogue_models[field]._meta.label_lower, pk)][0])
            # Native Device.save derives location from a located rack. Derive
            # that same value BEFORE Device.clean checks location/site/rack.
            if kind == "devices" and obj.rack_id and obj.rack.location_id:
                target_id = obj.rack.location_id
                if "location" in row.get("catalog", {}) and obj.location_id != target_id:
                    raise InventoryError("The explicitly selected location differs from the native rack location.")
                model_location = catalogue_models["location"]
                identity = (model_location._meta.label_lower, target_id)
                if identity not in catalogues:
                    value = _one(model_location, alias, {"pk": target_id}, user, lock=True)
                    if value is None:
                        raise InventoryError("The native rack location no longer exists.")
                    catalogues[identity] = (value, _catalogue_context(model_location, value))
                obj.location = catalogues[identity][0]
            if original is None:
                for name in REQUIRED_NEW[kind]:
                    if not getattr(obj, name, None):
                        raise InventoryError("A new native object requires " + name + ".")
            obj.full_clean()
            provisional = _snapshot(row, obj, inverse)
            intended_fields[label] = {field: provisional[field] for field in (
                set(row.get("fields", {})) | set(row.get("links", {})) | set(row.get("catalog", {})))}
            if original is None or before != provisional:
                obj._changelog_message = "Inventory migration " + packet["operation_id"] + ": " + kind + "/" + key
                if kind == "devices" and obj.pk:
                    _track_native_children(obj, models, alias, user, child_devices, inverse)
                obj.save(using=alias)
                _allowed(user, model, action, obj, alias)
            resolved[label] = obj
            inverse[obj._meta.label_lower, obj.pk] = label
            after = _snapshot(row, obj, inverse)
            explicit = set(row.get("fields", {})) | set(row.get("links", {})) | set(row.get("catalog", {}))
            for field in explicit:
                if after[field] != provisional[field]:
                    raise InventoryError("The native model resolved " + field
                                         + " differently from the source mapping; review its catalogue/default.")
            change = "CREATE" if original is None else ("UPDATE" if before != after else "KEEP")
            changes.append({"kind": kind, "key": key, "action": change,
                            "original_id": original.pk if original else None,
                            "before": before, "after": after, "source": row["source"],
                            "template_component": generated_component})
            results.append({"kind": kind, "key": key, "id": obj.pk, "url": obj.get_absolute_url()})
            if kind == "devices" and original is None:
                created_devices.append((key, obj))
            if kind == "ip_addresses" and row.get("primary"):
                interface = obj.assigned_object
                if not interface or interface._meta.label_lower != "dcim.interface":
                    raise InventoryError("A primary address must be assigned to a physical device interface.")
                device = interface.device
                family = obj.family
                primary_key = (device.pk, family)
                if primary_key in primary_requests:
                    raise InventoryError("Two source addresses request the same device's primary IPv" + str(family) + ".")
                primary_requests[primary_key] = (device, obj, label)
        except InventoryError:
            raise
        except Exception as exc:
            message = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            raise InventoryError(kind + "/" + key + ": " + canonical(scalar(message))) from exc

    for (_device_id, family), (device, address, label) in sorted(primary_requests.items()):
        model = models["devices"]
        device = model.objects.using(alias).select_for_update().get(pk=device.pk)
        _allowed(user, model, "change", device, alias)
        field = "primary_ip" + str(family)
        before = _native_value(device, field, inverse)
        device.snapshot()
        setattr(device, field, address)
        device.full_clean()
        after = _native_value(device, field, inverse)
        if before != after:
            device._changelog_message = "Inventory migration " + packet["operation_id"] + ": primary address"
            _track_native_children(device, models, alias, user, child_devices, inverse)
            device.save(using=alias)
            _allowed(user, model, "change", device, alias)
        identity = inverse.get(("dcim.device", device.pk))
        changes.append({"kind": "primary_ip", "key": label[1],
                        "device": {"key": identity[1]} if identity else {"id": device.pk},
                        "field": field, "action": "UPDATE" if before != after else "KEEP",
                        "before": before, "after": after})


    generated = _generated_projection(created_devices, alias, inverse)

    # Later parent-device saves can update an earlier mapped child. Compare the
    # final original inventory, and reject a native side effect that overwrote
    # any explicit source value.
    by_label = {(row["kind"], row["key"]): row for row in rows}
    for change in changes:
        label = (change["kind"], change["key"])
        if label not in by_label:
            continue
        obj = resolved[label]
        obj.refresh_from_db(using=alias)
        after = _snapshot(by_label[label], obj, inverse)
        for field, intended in intended_fields[label].items():
            if after[field] != intended:
                raise InventoryError(change["kind"] + "/" + change["key"] + ": the final native "
                                     + field + " differs from the explicit source mapping.")
        change["after"] = after
        change["action"] = ("CREATE" if originals[label] is None else
                            ("UPDATE" if original_snapshots[label] != after else "KEEP"))
    changes.extend(_finalize_native_children(models, alias, user, child_devices, inverse))

    catalogue_report = [{"model": model, "id": pk, "data": value[1]}
                        for (model, pk), value in sorted(catalogues.items())]
    review = {"schema": REVIEW_SCHEMA, "operation_id": packet["operation_id"],
              "payload_sha256": payload_hash, "netbox_url": packet["netbox_url"], "tenant": {"id": tenant.pk, "name": native_tenant.name},
              "database_schema": database_schema, "contract_source_commit": SOURCE_COMMIT,
              "netbox_version": str(settings.VERSION),
              "sources": packet["sources"], "source_notes": packet.get("source_notes", ""),
              "changes": changes, "catalogue": catalogue_report, "generated_components": generated}
    review["review_digest"] = digest(review)
    counts = {name: sum(change["action"] == name for change in changes) for name in ("CREATE", "UPDATE", "KEEP")}
    if not commit:
        script.log_success("Review complete: " + canonical(counts) + ". Copy the review digest for this exact source.")
        return {**review, "counts": counts, "state": "REVIEWED"}
    if review_digest != review["review_digest"]:
        raise InventoryError("The retained review differs from the current source or native objects. Review this inventory again.")
    receipt = {**review, "schema": RECEIPT_SCHEMA, "state": "APPLIED",
               "counts": counts, "recorded_at": timezone.now().isoformat(),
               "recorded_by": {"id": user.pk, "username": user.get_username()},
               "resolved": results}
    receipt["receipt_sha256"] = digest(receipt)
    if len(canonical(receipt).encode("utf-8")) > MAX_RESULT_BYTES:
        raise InventoryError("The complete native review exceeds the 64 MiB retained result limit.")
    _allowed(user, JournalEntry, "add")
    entry = JournalEntry(assigned_object=native_tenant, created_by=user,
                         kind=JournalEntryKindChoices.KIND_INFO,
                         comments=_receipt_prefix(packet["operation_id"]) + canonical(receipt))
    entry.full_clean()
    entry.save(using=alias)
    _allowed(user, JournalEntry, "add", entry, alias)
    script.log_success("Applied " + packet["operation_id"] + " and retained its original tenant journal entry.", entry)
    return {**receipt, "journal": {"id": entry.pk, "url": entry.get_absolute_url()}}


# NetBox loads the ordinary custom-script class. Standard Python importers can
# still use the packet/compiler contract without installing Django or NetBox.
try:
    from django.conf import settings as _django_settings
except ModuleNotFoundError:
    _native_environment = False
else:
    _native_environment = _django_settings.configured

if _native_environment:
    from extras.scripts import FileVar, ObjectVar, Script, StringVar
    from tenancy.models import Tenant

    class InventoryMigration(Script):
        class Meta:
            name = "Customer inventory migration"
            description = "Review retained source data, apply the same inventory, and reopen its native journal receipt."
            field_order = ("tenant", "inventory", "review_digest", "execution_reference")
            commit_default = False
            scheduling_enabled = False
            job_timeout = 600

        tenant = ObjectVar(model=Tenant, description="The customer tenant selected in the retained inventory.")
        inventory = FileVar(description="The original prepared request.json from the inventory workspace.")
        review_digest = StringVar(required=False, description="Copy the exact review_digest from the completed review output.")

        execution_reference = StringVar(required=False, description="Retained execution reference supplied by the operator CLI.")

        def run(self, data, commit):
            from utilities.exceptions import AbortScript
            execution_reference = data.get("execution_reference", "")
            try:
                if execution_reference and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}", execution_reference):
                    raise InventoryError("Invalid retained execution reference.")
                raw = data["inventory"].read(MAX_BYTES + 1)
                result = migrate(self, load_json(raw), data["tenant"], commit, data.get("review_digest", ""))
                return json.dumps({**result, "execution_reference": execution_reference},
                                  ensure_ascii=False, indent=2, allow_nan=False)
            except InventoryError as exc:
                self.output = json.dumps({"schema": REVIEW_SCHEMA, "state": "CORRECTION_REQUIRED",
                                          "error": str(exc), "execution_reference": execution_reference},
                                         ensure_ascii=False, indent=2)
                raise AbortScript(str(exc)) from exc
            except Exception as exc:
                self.output = json.dumps({"schema": REVIEW_SCHEMA, "state": "ERROR",
                                          "error": str(exc), "execution_reference": execution_reference},
                                         ensure_ascii=False, indent=2)
                raise
