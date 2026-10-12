"""Provision only this receiving operation through NetBox's original Django models.

Executed by the selected NetBox 4.7.2 shell command. Configuration, API token
material and the actual script readback remain in the private receiving directory.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from extras.models import ScriptModule
from users.models import Token

source = Path(os.environ["NETBOX_MIGRATION_SOURCE"]).resolve()
sys.path.insert(0, str(source))
from inventory_migration import InventoryError
from prepare_inventory import json_bytes, read_json, workspace_lock, write_atomic

OPERATION = "NETBOX-INVENTORY-RECEIVING-20261012-B9D2"
root = Path(os.environ["NETBOX_NATIVE_DIRECTORY"]).resolve()
action = os.environ.get("NETBOX_NATIVE_PROVISION_ACTION", "identity")
if str(settings.VERSION) != "4.7.2":
    raise InventoryError("Select the original NetBox 4.7.2 application.")
with workspace_lock(root / "provision"):
    if action == "identity":
        intent_path = root / "api-identity-intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent.get("operation_id") != OPERATION:
                raise InventoryError("The retained API identity belongs to another operation.")
        else:
            intent = {"schema": "tjlabs.netbox.native-identity-intent/v1",
                      "operation_id": OPERATION, "username": "b9d2-native-receiver",
                      "key": Token.generate_key(), "plaintext": Token.generate()}
            write_atomic(intent_path, json_bytes(intent), immutable=True)
        with transaction.atomic():
            User = get_user_model()
            users = list(User.objects.filter(username=intent["username"])[:2])
            if len(users) > 1:
                raise InventoryError("The native receiving user is ambiguous.")
            if users:
                user = users[0]
                if not (user.is_active and user.is_staff and user.is_superuser
                        and not user.has_usable_password()):
                    raise InventoryError("The existing user differs from this private receiver's identity.")
            else:
                user = User(username=intent["username"], is_active=True,
                            is_staff=True, is_superuser=True)
                user.set_unusable_password()
                user.full_clean()
                user.save()
            tokens = list(Token.objects.filter(key=intent["key"])[:2])
            if len(tokens) > 1:
                raise InventoryError("The retained original native token key is ambiguous.")
            if tokens:
                token = tokens[0]
                if not (token.user_id == user.pk and token.version == 2
                        and token.enabled and token.write_enabled
                        and token.validate(intent["plaintext"])):
                    raise InventoryError("The original saved API token changed.")
            else:
                token = Token(user=user, version=2, key=intent["key"],
                              token=intent["plaintext"], enabled=True, write_enabled=True,
                              description=OPERATION, allowed_ips=["127.0.0.1/32"])
                token.full_clean()
                token.save()
            header = token.get_auth_header_prefix() + intent["plaintext"]
            if not header.startswith("Bearer "):
                raise InventoryError("The original receiver requires the native v2 Bearer token.")
            identity = {"schema": "tjlabs.netbox.native-api-identity/v1", "operation_id": OPERATION,
                        "user_id": user.pk, "token_id": token.pk, "authorization": header}
        # A lost reply after COMMIT recovers from the immutable key/plaintext above.
        write_atomic(root / "api-identity.json", json_bytes(identity), immutable=True)
        print(json.dumps({"state": "IDENTITY_READY", "user_id": user.pk,
                          "token_id": token.pk, "version": str(settings.VERSION)}))
    elif action == "script-status":
        path = source / "inventory_migration.py"
        expected = hashlib.sha256(path.read_bytes()).hexdigest()
        modules = list(ScriptModule.objects.filter(file_root="scripts",
                                                   file_path="inventory_migration.py")[:2])
        if len(modules) > 1:
            raise InventoryError("The native script module is ambiguous.")
        result = {"schema": "tjlabs.netbox.native-script-install/v1",
                  "operation_id": OPERATION, "expected_sha256": expected, "installed": False}
        if modules:
            module = modules[0]
            with module.storage.open(module.full_path, "rb") as stream:
                content = stream.read()
            actual = hashlib.sha256(content).hexdigest()
            if actual != expected:
                raise InventoryError("The original installed script has another source hash.")
            scripts = list(module.scripts.values("id", "name"))
            if [item["name"] for item in scripts] != ["InventoryMigration"]:
                raise InventoryError("The native script module exposes another class.")
            result.update(installed=True, module_id=module.pk, sha256=actual,
                          bytes=len(content), scripts=scripts)
        write_atomic(root / "script-install-status.json", json_bytes(result))
        print(json.dumps({"state": "SCRIPT_READY" if result["installed"] else "SCRIPT_ABSENT",
                          "module_id": result.get("module_id"), "sha256": result.get("sha256")}))
    else:
        raise InventoryError("Select identity or script-status in this original receiver.")
