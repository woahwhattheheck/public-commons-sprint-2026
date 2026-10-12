"""Create this operation's native receiving inputs inside an actual NetBox shell.

NETBOX_NATIVE_DIRECTORY selects the retained shared output directory.
NETBOX_NATIVE_URL is the actual API origin used by the receiving operator.
NETBOX_MIGRATION_SOURCE selects the exact published product source directory.
Run with NetBox's original manage.py shell after its normal migrations.
"""
import csv
import io
import json
import os
from pathlib import Path
import sys

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from dcim.models import (
    Device, DeviceBay, DeviceBayTemplate, DeviceRole, DeviceType, Interface, InterfaceTemplate,
    InventoryItem, InventoryItemTemplate, Location, Manufacturer, ModuleBay, ModuleBayTemplate,
    ModuleBayType, Rack, Site,
)
from extras.models import CustomField
from ipam.models import VRF
from tenancy.models import Tenant

source = Path(os.environ["NETBOX_MIGRATION_SOURCE"]).resolve()
sys.path.insert(0, str(source))
from inventory_migration import SOURCE_COMMIT, InventoryError
from prepare_inventory import json_bytes, read_json, workspace_lock, write_atomic

OPERATION = "NETBOX-INVENTORY-RECEIVING-20261012-B9D2"
PREFIX = "b9d2-nbx-20261012"
base = os.environ["NETBOX_NATIVE_URL"].rstrip("/")
if os.environ.get("NETBOX_NATIVE_IPAM", "") not in ("", "1"):
    raise InventoryError("NETBOX_NATIVE_IPAM must be omitted or explicitly set to 1.")
if str(settings.VERSION) != "4.7.2":
    raise InventoryError("This receiving packet requires actual NetBox4.7.2; observed " + str(settings.VERSION))


def owned(model, lookup, values):
    found = list(model.objects.filter(**lookup)[:2])
    if len(found) > 1:
        raise InventoryError("Ambiguous original fixture object: " + model._meta.label_lower)
    if found:
        return found[0]
    obj = model(**lookup, **values)
    obj.full_clean()
    obj.save()
    return obj


def csv_file(root, name, rows):
    header = list(rows[0])
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=header, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    write_atomic(root / name, output.getvalue().encode("utf-8"), immutable=True)


with workspace_lock(os.environ["NETBOX_NATIVE_DIRECTORY"]) as root:
    existing = root / "fixture.json"
    if os.environ.get("NETBOX_NATIVE_IPAM") == "1" and (not existing.is_file() or existing.is_symlink()):
        raise InventoryError("Select the original completed inventory fixture before network continuation.")
    if existing.exists():
        result = read_json(existing)
        if result["operation_id"] != OPERATION or result["netbox_url"] != base:
            raise InventoryError("The original receiving directory belongs to another operation or server.")
        if not Tenant.objects.filter(pk=result["tenant_id"], slug=PREFIX).exists():
            raise InventoryError("The retained native fixture tenant no longer exists.")
        print(json.dumps(result, indent=2))
    else:
        with transaction.atomic():
            tenant = owned(Tenant, {"slug": PREFIX}, {"name": PREFIX, "description": OPERATION})
            manufacturer = owned(Manufacturer, {"slug": PREFIX}, {"name": PREFIX})
            role = owned(DeviceRole, {"slug": PREFIX}, {"name": PREFIX, "color": "808080"})
            parent_type = owned(DeviceType, {"slug": PREFIX + "-parent"},
                                {"manufacturer": manufacturer, "model": PREFIX + "-parent",
                                 "u_height": 2, "subdevice_role": "parent"})
            child_type = owned(DeviceType, {"slug": PREFIX + "-child"},
                               {"manufacturer": manufacturer, "model": PREFIX + "-child",
                                "u_height": 0, "is_full_depth": False, "subdevice_role": "child"})
            switch_type = owned(DeviceType, {"slug": PREFIX + "-switch"},
                                {"manufacturer": manufacturer, "model": PREFIX + "-switch", "u_height": 1})
            owned(DeviceBayTemplate, {"device_type": parent_type, "name": "Bay1"}, {})
            interface_template = owned(InterfaceTemplate, {"device_type": switch_type, "name": "eth0"},
                                       {"type": "1000base-t", "enabled": True})
            bay_type = owned(ModuleBayType, {"manufacturer": manufacturer, "slug": PREFIX},
                             {"name": PREFIX, "color": "808080"})
            module_template = owned(ModuleBayTemplate, {"device_type": switch_type, "name": "Slot1"},
                                    {"position": "1", "enabled": True})
            module_template.module_bay_types.add(bay_type)
            assembly = owned(InventoryItemTemplate, {"device_type": switch_type, "name": "Assembly", "parent": None},
                             {"manufacturer": manufacturer})
            owned(InventoryItemTemplate, {"device_type": switch_type, "name": "Transceiver", "parent": assembly},
                  {"manufacturer": manufacturer, "component": interface_template, "part_id": "NATIVE-001"})
            custom_field = owned(CustomField, {"name": "b9d2_nbx_fixture_source"},
                                 {"type": "text", "default": "original-native-default"})
            custom_field.object_types.add(*(ContentType.objects.get_for_model(model)
                                             for model in (Interface, InventoryItem, ModuleBay)))
            site_a = owned(Site, {"slug": PREFIX + "-a"}, {"name": PREFIX + "-a", "tenant": tenant})
            site_b = owned(Site, {"slug": PREFIX + "-b"}, {"name": PREFIX + "-b", "tenant": tenant})
            location_a = owned(Location, {"site": site_a, "slug": "room-a"}, {"name": "RoomA"})
            location_b = owned(Location, {"site": site_b, "slug": "room-b"}, {"name": "RoomB"})
            rack_a = owned(Rack, {"site": site_a, "name": "RackA"},
                           {"tenant": tenant, "location": location_a, "u_height": 42, "width": 19})
            rack_b = owned(Rack, {"site": site_b, "name": "RackB"},
                           {"tenant": tenant, "location": location_b, "u_height": 42, "width": 19})
            parent = owned(Device, {"name": PREFIX + "-parent", "tenant": tenant},
                           {"site": site_a, "rack": rack_a, "location": location_a,
                            "device_type": parent_type, "role": role, "position": 1, "face": "front"})
            child = owned(Device, {"name": PREFIX + "-child", "tenant": tenant},
                          {"site": site_a, "rack": rack_a, "location": location_a,
                           "device_type": child_type, "role": role})
            bay = DeviceBay.objects.get(device=parent, name="Bay1")
            if bay.installed_device_id not in (None, child.pk):
                raise InventoryError("The original receiving bay already houses another device.")
            if bay.installed_device_id is None:
                bay.installed_device = child
                bay.full_clean()
                bay.save()
            vrf = owned(VRF, {"name": PREFIX}, {"tenant": tenant, "enforce_unique": True})
            result = {"schema": "tjlabs.netbox.native-fixture/v1", "operation_id": OPERATION,
                      "netbox_url": base, "contract_source_commit": SOURCE_COMMIT,
                      "actual_netbox_version": str(settings.VERSION),
                      "tenant_id": tenant.pk, "custom_field_id": custom_field.pk,
                      "custom_field_name": custom_field.name, "module_bay_type_id": bay_type.pk,
                      "parent_id": parent.pk, "child_id": child.pk, "vrf_id": vrf.pk,
                      "target": {"site_id": site_b.pk, "rack_id": rack_b.pk, "location_id": location_b.pk},
                      "baseline": {"site_id": site_a.pk, "rack_id": rack_a.pk, "location_id": location_a.pk},
                      "new_device_name": PREFIX + "-switch",
                      "baseline_device_ids": sorted(Device.objects.filter(tenant=tenant).values_list("pk", flat=True))}
            # All source rows use actual IDs returned by these original models.
            mapping = json.loads((source / "examples" / "mapping.json").read_text())
            mapping.update(netbox_url=base, tenant_id=tenant.pk,
                           source_notes=OPERATION + ": original native catalogue/defaults, located parent/child move and retained correction.")
            rows = {
                "sites.csv": [
                    {"source_key": "site-a", "match_id": site_a.pk, "name": site_a.name, "slug": site_a.slug, "status": "active"},
                    {"source_key": "site-b", "match_id": site_b.pk, "name": site_b.name, "slug": site_b.slug, "status": "active"}],
                "racks.csv": [
                    {"source_key": "rack-a", "match_id": rack_a.pk, "name": rack_a.name, "site_key": "site-a",
                     "location_id": location_a.pk, "u_height": 42, "width": 19, "status": "active"},
                    {"source_key": "rack-b", "match_id": rack_b.pk, "name": rack_b.name, "site_key": "site-b",
                     "location_id": location_b.pk, "u_height": 42, "width": 19, "status": "active"}],
                "devices.csv": [
                    {"source_key": "existing-chassis", "match_id": parent.pk, "name": parent.name, "site_key": "site-b",
                     "rack_key": "rack-b", "location_id": location_b.pk, "device_type_id": parent_type.pk, "role_id": role.pk,
                     "platform_id": "", "position": "1", "face": "front", "status": "active", "serial": "NATIVE-PARENT",
                     "description": "Move the original located parent and its installed child"},
                    {"source_key": "new-switch", "match_id": "", "name": result["new_device_name"], "site_key": "site-b",
                     "rack_key": "rack-b", "location_id": location_b.pk, "device_type_id": switch_type.pk, "role_id": role.pk,
                     "platform_id": "", "position": "4", "face": "front", "status": "active", "serial": "NATIVE-SWITCH",
                     "description": "Original source edition"}],
                "interfaces.csv": [
                    {"source_key": "switch-eth0", "match_id": "", "name": "eth0", "device_key": "new-switch",
                     "type": "1000base-t", "enabled": "true", "mgmt_only": "true", "description": "Original management interface"}],
                "ip_addresses.csv": [
                    {"source_key": "switch-v4", "match_id": "", "address": "192.0.2.10/24", "interface_key": "switch-eth0",
                     "vrf_id": vrf.pk, "status": "active", "dns_name": "switch.example.invalid", "primary": "true"},
                    {"source_key": "switch-v6", "match_id": "", "address": "2001:db8::10/64", "interface_key": "switch-eth0",
                     "vrf_id": vrf.pk, "status": "active", "dns_name": "switch.example.invalid", "primary": "true"}],
            }
        inputs = root / "input"
        inputs.mkdir(mode=0o700, exist_ok=True)
        for name, records in rows.items():
            csv_file(inputs, name, records)
        write_atomic(inputs / "mapping.json", json_bytes(mapping), immutable=True)
        write_atomic(root / "connection.json", json_bytes({
            "schema": "tjlabs.netbox.connection/v1", "netbox_url": base,
            "script": "inventory_migration.InventoryMigration", "token_env": "NETBOX_TOKEN",
            "authorization_scheme": "Bearer", "timeout_seconds": 60}), immutable=True)
        write_atomic(existing, json_bytes(result), immutable=True)
        print(json.dumps(result, indent=2))


# Explicit successor of the already accepted v1 inventory, on the same native
# instance. The default invocation above remains the original five-file fixture.
def network_fixture():
    import hashlib
    from extras.models import JournalEntry
    from ipam.models import IPAddress
    from inventory_migration import _decode_receipt, validate_native_result
    from prepare_inventory import compile_mapping, read_bytes

    receipt_name = os.environ.get("NETBOX_NATIVE_IPAM_RECEIPT")
    if not receipt_name:
        raise InventoryError("Select the existing applied v1 receipt with NETBOX_NATIVE_IPAM_RECEIPT.")
    receipt_path = Path(receipt_name).resolve()
    receipt_raw = read_bytes(receipt_path)
    receipt = json.loads(receipt_raw)
    validate_native_result(receipt, receipt.get("operation_id"), receipt.get("payload_sha256"))
    if receipt.get("state") != "APPLIED" or receipt.get("netbox_version") != "4.7.2":
        raise InventoryError("The network continuation requires the original applied NetBox4.7.2 inventory.")
    code_sha = hashlib.sha256((source / "inventory_migration.py").read_bytes()).hexdigest()
    original_raw = read_bytes(Path(os.environ["NETBOX_NATIVE_DIRECTORY"]) / "fixture.json")
    original_fixture = json.loads(original_raw)
    binding = {
        "operation_id": OPERATION, "phase": "network-commissioning-v1",
        "netbox_url": base, "tenant_id": original_fixture["tenant_id"],
        "inventory_operation_id": receipt["operation_id"],
        "inventory_receipt_sha256": receipt["receipt_sha256"],
        "inventory_receipt_file_sha256": hashlib.sha256(receipt_raw).hexdigest(),
        "inventory_fixture_sha256": hashlib.sha256(original_raw).hexdigest(),
        "migration_source_sha256": code_sha, "contract_source_commit": SOURCE_COMMIT,
    }
    if receipt.get("netbox_url") != base or receipt.get("tenant", {}).get("id") != binding["tenant_id"]:
        raise InventoryError("The original applied receipt selects another native server or tenant.")
    resolved = {(row["kind"], row["key"]): row["id"] for row in receipt["resolved"]}

    with workspace_lock(os.environ["NETBOX_NATIVE_DIRECTORY"]) as root:
        published = root / "ipam-fixture.json"
        if published.exists():
            saved = read_json(published)
            if saved.get("binding") != binding:
                raise InventoryError("The retained network fixture belongs to another exact source or applied inventory.")
            for item in saved["files"]:
                raw = (root / item["path"]).read_bytes()
                if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                    raise InventoryError("A retained original network source changed: " + item["path"])
            for item in saved["peers"].values():
                if not Interface.objects.filter(pk=item["id"], device_id=item["device_id"], name=item["name"]).exists():
                    raise InventoryError("An original network peer identity no longer exists.")
            print(json.dumps(saved, indent=2))
            return saved

        with transaction.atomic():
            tenant = Tenant.objects.select_for_update().get(pk=binding["tenant_id"], slug=PREFIX)
            journal_id = receipt.get("journal", {}).get("id")
            if type(journal_id) is not int or journal_id <= 0:
                raise InventoryError("The applied inventory must retain its original tenant JournalEntry.")
            journal = JournalEntry.objects.select_for_update().get(
                pk=journal_id, assigned_object_type=ContentType.objects.get_for_model(Tenant),
                assigned_object_id=tenant.pk)
            opened = _decode_receipt(journal, receipt["payload_sha256"], receipt["operation_id"])
            if opened["receipt_sha256"] != receipt["receipt_sha256"]:
                raise InventoryError("The selected native journal differs from the original applied receipt.")

            def selected(model, kind, key):
                native_id = resolved.get((kind, key))
                if type(native_id) is not int or native_id <= 0:
                    raise InventoryError("The original receipt has no committed identity for " + kind + "/" + key)
                return model.objects.select_for_update().get(pk=native_id)

            site_a = selected(Site, "sites", "site-a")
            site_b = selected(Site, "sites", "site-b")
            rack_a = selected(Rack, "racks", "rack-a")
            rack_b = selected(Rack, "racks", "rack-b")
            parent = selected(Device, "devices", "existing-chassis")
            switch = selected(Device, "devices", "new-switch")
            management = selected(Interface, "interfaces", "switch-eth0")
            address4 = selected(IPAddress, "ip_addresses", "switch-v4")
            address6 = selected(IPAddress, "ip_addresses", "switch-v6")
            if (any(item.tenant_id != tenant.pk for item in
                    (site_a, site_b, rack_a, rack_b, parent, switch, address4, address6))
                    or management.device_id != switch.pk or switch.site_id != site_b.pk
                    or parent.site_id != site_b.pk or rack_a.site_id != site_a.pk
                    or rack_b.site_id != site_b.pk or parent.rack_id != rack_b.pk
                    or switch.rack_id != rack_b.pk
                    or address4.assigned_object_id != management.pk
                    or address6.assigned_object_id != management.pk):
                raise InventoryError("The existing v1 inventory no longer has its reviewed native tenant/device/site binding.")
            channel_parent = owned(
                Interface, {"device": switch, "name": PREFIX + "-channel"},
                {"type": "100gbase-x-qsfp28", "channels": 4, "enabled": True,
                 "description": "Existing channelized parent for native rename continuation"})
            channel_child = owned(
                Interface, {"device": switch, "name": channel_parent.name + ":1"},
                {"type": "channel", "parent": channel_parent, "channel_id": 1, "enabled": True,
                 "description": "Original convention-named native channel child"})
            channel = {"parent_id": channel_parent.pk, "child_id": channel_child.pk,
                       "device_id": switch.pk, "original_parent_name": channel_parent.name,
                       "original_child_name": channel_child.name,
                       "target_parent_name": PREFIX + "-channel-renamed",
                       "target_child_name": PREFIX + "-channel-renamed:1"}
            peers = {}
            for side in ("a", "b"):
                peer = owned(Interface, {"device": parent, "name": PREFIX + "-peer-" + side},
                             {"type": "1000base-t", "enabled": True,
                              "description": OPERATION + " existing native endpoint " + side.upper()})
                if peer.cable_id is not None:
                    raise InventoryError("The first network source capture requires its original unused peer " + side)
                peers[side] = {"id": peer.pk, "name": peer.name, "device_id": parent.pk}

            mapping = json.loads((source / "examples/network-mapping.json").read_text())
            mapping.update(netbox_url=base, tenant_id=tenant.pk,
                           source_notes=OPERATION + ": selected network continuation of " + receipt["operation_id"])
            definitions = {item["kind"]: item for item in mapping["sources"]}
            if len(definitions) != 10:
                raise InventoryError("Select the complete ten-family network mapping shipped with this source.")
            definitions["cables"]["links"]["b_interface"] = {"column": "b_interface_id", "by": "id"}
            data = {}
            data["sites"] = [
                {"source_key": key, "match_id": obj.pk, "name": obj.name, "slug": obj.slug, "status": obj.status}
                for key, obj in (("site-a", site_a), ("site-b", site_b))]
            data["racks"] = [
                {"source_key": key, "match_id": obj.pk, "name": obj.name,
                 "site_key": "site-a" if obj.site_id == site_a.pk else "site-b",
                 "location_id": obj.location_id or "", "u_height": obj.u_height,
                 "width": obj.width, "status": obj.status}
                for key, obj in (("rack-a", rack_a), ("rack-b", rack_b))]
            data["devices"] = [
                {"source_key": key, "match_id": obj.pk, "name": obj.name, "site_key": "site-b",
                 "rack_key": "rack-b", "location_id": obj.location_id or "",
                 "device_type_id": obj.device_type_id, "role_id": obj.role_id,
                 "platform_id": obj.platform_id or "", "position": str(obj.position) if obj.position is not None else "",
                 "face": obj.face or "", "status": obj.status, "serial": obj.serial or "",
                 "description": obj.description or ""}
                for key, obj in (("existing-chassis", parent), ("new-switch", switch))]
            data["route_targets"] = [
                {"source_key": "rt-prod", "match_id": "", "name": "64512:210",
                 "description": PREFIX + " production route target"},
                {"source_key": "rt-guest", "match_id": "", "name": "64512:220",
                 "description": PREFIX + " guest route target"}]
            data["vrfs"] = [
                {"source_key": "vrf-prod", "match_id": "", "name": PREFIX + "-production",
                 "rd": "64512:210", "enforce_unique": "true",
                 "description": "Production routing table",
                 "import_targets_keys": "rt-prod;rt-guest", "export_targets_keys": "rt-prod"},
                {"source_key": "vrf-guest", "match_id": "", "name": PREFIX + "-guest",
                 "rd": "64512:220", "enforce_unique": "true",
                 "description": "Guest routing table with overlapping address space",
                 "import_targets_keys": "rt-guest", "export_targets_keys": "rt-guest"}]
            data["vlans"] = [
                {"source_key": key, "match_id": "", "name": PREFIX + "-" + suffix, "vid": vid,
                 "site_key": "site-b", "group_id": "", "ipam_role_id": "", "status": "active",
                 "description": description}
                for key, suffix, vid, description in
                (("vlan-prod", "production", 210, "Production access VLAN"),
                 ("vlan-guest", "guest", 220, "Guest access VLAN"),
                 ("vlan-transit", "transit", 230, "Uplink native VLAN"))]
            data["prefixes"] = [
                {"source_key": key, "match_id": "", "prefix": prefix, "vrf_key": vrf,
                 "vlan_key": vlan, "scope_site_key": "site-b", "ipam_role_id": "",
                 "status": "active", "is_pool": "false", "mark_utilized": "false",
                 "description": description}
                for key, prefix, vrf, vlan, description in
                (("prefix-prod-parent", "192.0.2.99/24", "vrf-prod", "vlan-prod", "Canonical production parent"),
                 ("prefix-prod-leaf", "192.0.2.11/28", "vrf-prod", "vlan-prod", "Most specific management prefix"),
                 ("prefix-prod-v6", "2001:db8::99/64", "vrf-prod", "vlan-prod", "Production IPv6"),
                 ("prefix-guest", "192.0.2.99/24", "vrf-guest", "vlan-guest", "Same IPv4 interval in the guest VRF"))]
            data["interfaces"] = [
                {"source_key": key, "match_id": native_id, "name": name, "device_key": "new-switch",
                 "type": "1000base-t", "enabled": "true", "mgmt_only": mgmt, "mode": mode,
                 "vrf_key": vrf, "untagged_vlan_key": untagged, "tagged_vlans_keys": tagged,
                 "description": description}
                for key, native_id, name, mgmt, mode, vrf, untagged, tagged, description in
                (("switch-eth0", management.pk, management.name, "true", "access", "vrf-prod",
                  "vlan-prod", "", "Existing management interface"),
                 ("switch-uplink", "", PREFIX + "-uplink", "false", "tagged", "vrf-prod",
                  "vlan-transit", "vlan-prod;vlan-guest", "Customer uplink"),
                 ("switch-guest", "", PREFIX + "-guest", "false", "access", "vrf-guest",
                  "vlan-guest", "", "Guest access interface"))]
            data["interfaces"].append(
                {"source_key": "switch-channel", "match_id": channel_parent.pk,
                 "name": channel_parent.name, "device_key": "new-switch", "type": channel_parent.type,
                 "enabled": "true", "mgmt_only": "false", "mode": "access",
                 "vrf_key": "vrf-prod", "untagged_vlan_key": "vlan-prod", "tagged_vlans_keys": "",
                 "description": "Existing original channelized parent"})
            data["ip_addresses"] = [
                {"source_key": key, "match_id": native_id, "address": address,
                 "interface_key": interface_key, "vrf_key": vrf, "status": "active",
                 "dns_name": dns, "primary": primary}
                for key, native_id, address, interface_key, vrf, dns, primary in
                (("switch-v4", address4.pk, str(address4.address), "switch-eth0", "vrf-prod", "switch.example.invalid", "true"),
                 ("switch-v6", address6.pk, str(address6.address), "switch-eth0", "vrf-prod", "switch.example.invalid", "true"),
                 ("guest-v4", "", "192.0.2.10/24", "switch-guest", "vrf-guest", "guest.example.invalid", "false"),
                 ("uplink-v4", "", "192.0.2.250/24", "switch-uplink", "vrf-prod", "uplink.example.invalid", "false"))]
            data["cables"] = [{"source_key": "uplink-cable", "match_id": "", "label": PREFIX + "-uplink",
                               "type": "cat6", "status": "connected", "color": "808080", "length": "2",
                               "length_unit": "m", "description": "Reviewed production uplink",
                               "a_interface_key": "switch-uplink", "b_interface_id": peers["a"]["id"]}]
            expected_counts = {kind: len(rows) for kind, rows in data.items()}
            existing_ids = [{"kind": kind, "key": row["source_key"], "id": row["match_id"]}
                            for kind, rows in data.items() for row in rows if row["match_id"] != ""]

        # Exact original source files are published before the final fixture.
        # If interrupted here, the same native peers and immutable bytes reopen.
        inputs = root / "ipam-input"
        inputs.mkdir(mode=0o700, exist_ok=True)
        for definition in mapping["sources"]:
            csv_file(inputs, definition["file"], data[definition["kind"]])
        mapping_path = inputs / "network-mapping.json"
        write_atomic(mapping_path, json_bytes(mapping), immutable=True)
        packet, captures, errors = compile_mapping(mapping, mapping_path, OPERATION + "-NETWORK-SOURCE")
        if errors:
            raise InventoryError("The native network source mapping needs correction: " + json.dumps(errors))
        write_atomic(root / "ipam-expected-source.json", json_bytes(packet), immutable=True)
        paths = [inputs / item["file"] for item in mapping["sources"]]
        paths += [mapping_path, root / "ipam-expected-source.json"]
        files = []
        for path in paths:
            raw = path.read_bytes()
            files.append({"path": path.relative_to(root).as_posix(), "bytes": len(raw),
                          "sha256": hashlib.sha256(raw).hexdigest()})
        saved = {"schema": "tjlabs.netbox.native-network-fixture/v1", "binding": binding,
                 "operation_id": OPERATION, "phase": "network-commissioning-v1",
                 "actual_netbox_version": str(settings.VERSION), "tenant_id": tenant.pk,
                 "tenant_name": tenant.name, "files": files, "mapping": mapping,
                 "expected_source": "ipam-expected-source.json", "counts": expected_counts,
                 "expected_creates": sum(len(rows) for rows in data.values()) - len(existing_ids),
                 "existing_ids": existing_ids, "peers": peers, "channel": channel,
                 "existing_inventory": receipt["resolved"],
                 "expected": {"management_prefix": "192.0.2.0/28", "uplink_prefix": "192.0.2.0/24",
                              "guest_prefix": "192.0.2.0/24", "ipv6_prefix": "2001:db8::/64",
                              "corrected_cable_peer": peers["b"]["id"]}}
        write_atomic(published, json_bytes(saved), immutable=True)
        print(json.dumps(saved, indent=2))
        return saved


if os.environ.get("NETBOX_NATIVE_IPAM") == "1":
    network_fixture()
