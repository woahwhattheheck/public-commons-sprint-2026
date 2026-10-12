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
