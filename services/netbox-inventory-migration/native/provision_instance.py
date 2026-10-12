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
    if action in {"identity", "identity-read"}:
        intent_path = root / "api-identity-intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent.get("operation_id") != OPERATION:
                raise InventoryError("The retained API identity belongs to another operation.")
        else:
            if action == "identity-read":
                raise InventoryError("Retain the original API identity intent for this instance.")
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
                if action == "identity-read":
                    raise InventoryError("The original receiving user is missing.")
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
                if action == "identity-read":
                    raise InventoryError("The original receiving token is missing.")
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
    elif action == "network-script-status":
        # The v1 install receipt identifies the SAME native module and Script row.
        # This action observes and retains bytes; the original REST update owns
        # replacement and its native ScriptModule/Script synchronization.
        previous = read_json(root / "script-install-status.json")
        if (previous.get("schema") != "tjlabs.netbox.native-script-install/v1"
                or previous.get("operation_id") != OPERATION or not previous.get("installed")
                or previous.get("expected_sha256") != previous.get("sha256")
                or len(previous.get("scripts", [])) != 1
                or previous["scripts"][0].get("name") != "InventoryMigration"):
            raise InventoryError("Retain the original completed native script installation.")
        path = source / "inventory_migration.py"
        expected_content = path.read_bytes()
        if not 0 < len(expected_content) <= 2 * 1024 * 1024:
            raise InventoryError("The selected reviewed native script exceeds the receiving limit.")
        expected = hashlib.sha256(expected_content).hexdigest()
        selected = list(ScriptModule.objects.filter(file_root="scripts",
                                                      file_path="inventory_migration.py")[:2])
        if len(selected) != 1 or selected[0].pk != previous["module_id"]:
            raise InventoryError("The original native script module identity changed.")
        module = selected[0]
        scripts = list(module.scripts.order_by("id").values("id", "name"))
        if scripts != previous["scripts"]:
            raise InventoryError("The original native Script identity or class changed.")
        with module.storage.open(module.full_path, "rb") as stream:
            content = stream.read(2 * 1024 * 1024 + 1)
        if len(content) > 2 * 1024 * 1024:
            raise InventoryError("The installed native script exceeds the receiving limit.")
        actual = hashlib.sha256(content).hexdigest()
        state = ("TARGET" if actual == expected else "ORIGINAL" if actual == previous["sha256"]
                 else "TARGET_PREFIX" if expected_content.startswith(content) else "OTHER")
        upgrade = root / "network-source-upgrade"
        upgrade.mkdir(mode=0o700, exist_ok=True)
        if not upgrade.is_dir() or upgrade.is_symlink():
            raise InventoryError("Use this original private source replacement directory.")
        prior_file = upgrade / "original-inventory_migration.py"
        if actual == previous["sha256"]:
            write_atomic(prior_file, content, immutable=True)
        if prior_file.exists():
            prior_content = prior_file.read_bytes()
            if hashlib.sha256(prior_content).hexdigest() != previous["sha256"]:
                raise InventoryError("The retained original source replacement preimage changed.")
        class_loaded = False
        if state in {"ORIGINAL", "TARGET"}:
            native_script = module.scripts.get(pk=scripts[0]["id"])
            native_class = native_script.python_class
            class_loaded = native_class is not None and native_class.__name__ == "InventoryMigration"
        result = {"schema": "tjlabs.netbox.native-source-upgrade-observation/v1",
                  "operation_id": OPERATION, "state": state,
                  "module_id": module.pk, "scripts": scripts,
                  "previous_sha256": previous["sha256"], "expected_sha256": expected,
                  "sha256": actual, "bytes": len(content), "class_loaded": class_loaded}
        write_atomic(upgrade / "status.json", json_bytes(result))
        print(json.dumps({"state": state, "module_id": module.pk, "scripts": scripts,
                          "sha256": actual, "class_loaded": class_loaded}))
    else:
        raise InventoryError("Select identity, identity-read, script-status or network-script-status in this original receiver.")
