"""Institutional identity and delegated administration in the audit workspace.

Provider/account/rule/delegation editions use the original immutable record
store. Verified institutional identities become original grants; audit records,
audience projections, operation replay and encrypted recovery keep one authority.
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

from .store import (
    Conflict, Forbidden, ROLES, encoded, fingerprint, identifier, now,
)

KINDS = frozenset({
    "identity_provider", "identity_rule", "identity_account",
    "identity_delegation", "identity_attestation",
})
SCOPED_ROLES = frozenset({"unit_leadership", "it_leadership", "medicine_it_leadership"})
DELEGABLE_ROLES = SCOPED_ROLES | {"advisory"}
ACCESS_FIELDS = ("role", "unit_ids", "recipient_unit_ids", "selected_record_ids")
_ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}")
_CLAIM = re.compile(r"[A-Za-z_][A-Za-z0-9_.:/-]{0,127}")
RESERVED_CLAIMS = frozenset({
    "iss", "sub", "aud", "exp", "iat", "nbf", "nonce", "auth_time",
    "azp", "at_hash", "c_hash", "access_token", "refresh_token", "id_token",
    "client_secret", "authorization", "password",
})


def text(value, label, maximum=512, *, optional=False):
    if optional and value in (None, ""):
        return ""
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum
            or any(ord(c) < 32 and c not in "\n\t" or ord(c) == 127 for c in value)):
        raise ValueError(label + " must be nonempty text of at most " + str(maximum) + " characters.")
    return value.strip()


def literal(value, label, maximum=512):
    if (not isinstance(value, str) or not value or len(value) > maximum
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise ValueError(label + " must be the original nonempty identifier.")
    return value


def integer(value, label, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(label + " is outside its supported range.")
    return value


def flag(value, label):
    if type(value) is not bool:
        raise ValueError(label + " must be a boolean.")
    return value


def identifiers(value, label, maximum=1000):
    if (not isinstance(value, list) or len(value) > maximum
            or any(not isinstance(v, str) or not v or len(v) > 180
                   or any(ord(c) < 32 or ord(c) == 127 for c in v) for v in value)):
        raise ValueError(label + " must be an explicit list of identifiers.")
    return sorted(set(value))


def timestamp(value, label, *, optional=True):
    if optional and value in (None, ""):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            raise ValueError()
    except (AttributeError, TypeError, ValueError):
        raise ValueError(label + " requires a timestamp with its timezone.") from None
    return moment.astimezone(timezone.utc).isoformat(timespec="microseconds")


def access(value):
    if not isinstance(value, dict):
        raise ValueError("Choose an original audit role and scope.")
    if set(value) - set(ACCESS_FIELDS):
        raise ValueError("This access assignment contains unsupported fields.")
    role = value.get("role")
    if role not in ROLES:
        raise ValueError("Choose an original audit reporting role.")
    answer = {"role": role}
    for key in ACCESS_FIELDS[1:]:
        answer[key] = identifiers(value.get(key, []), key)
    if role in SCOPED_ROLES and not answer["unit_ids"]:
        raise ValueError("This reporting role requires its explicit unit scope.")
    if role == "advisory" and (
        not answer["recipient_unit_ids"] or not answer["selected_record_ids"]
        or not set(answer["recipient_unit_ids"]).issubset(answer["unit_ids"])
    ):
        raise ValueError("Advisory access requires selected memos and recipient units within the unit scope.")
    if role != "advisory" and (answer["recipient_unit_ids"] or answer["selected_record_ids"]):
        raise ValueError("Selected memos and recipient units belong to advisory access.")
    return answer


def account_id(issuer, subject):
    return "institution-" + fingerprint([issuer, subject])[:40]


def _deadline(minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(timespec="microseconds")


class InstitutionalAccess:
    def __init__(self, store):
        self.store = store
        with store.lock:
            store.db.executescript("""
                CREATE TABLE IF NOT EXISTS identity_logins(
                    state_sha256 TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS identity_session_details(
                    token_sha256 TEXT PRIMARY KEY
                      REFERENCES sessions(token_sha256) ON DELETE CASCADE,
                    id TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS identity_rate(
                    context TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,
                    PRIMARY KEY(context,bucket));
            """)
            with store.db:
                store.db.execute(
                    "INSERT OR IGNORE INTO settings VALUES('identity_epoch',?)",
                    (secrets.token_hex(24),))
        store.institutional_access = self

    def _get(self, kind, rid, *, missing=False):
        try:
            return self.store.get(kind, identifier(rid))
        except KeyError:
            if missing:
                return None
            raise

    def _rows(self, kind):
        return self.store.records(kind)

    def _save(self, kind, rid, payload, expected, actor):
        if kind not in KINDS:
            raise ValueError("Choose an institutional operating record.")
        previous = self._get(kind, rid, missing=True)
        current = previous["revision"] if previous else 0
        if type(expected) is not int or expected != current:
            raise Conflict("This institutional record changed. Reopen its current edition.")
        stamp = now()
        record = {
            "kind": kind, "id": identifier(rid), "revision": current + 1,
            "source": {
                "namespace": "institutional-identity:" + self.store.setting("workspace_id"),
                "id": rid, "revision": str(current + 1),
                "locator": {"application": "commons-audit-operator", "authority": "workspace access"},
            },
            "payload": copy.deepcopy(payload),
            "created_at": previous["created_at"] if previous else stamp,
            "updated_at": stamp,
        }
        return self.store._insert_record(record, current, actor)

    def _grant(self, rid):
        row = self.store.db.execute("SELECT body FROM grants WHERE id=?", (rid,)).fetchone()
        return json.loads(row["body"]) if row else None

    def _transient(self, work):
        """Join an existing original transaction, or own just this metadata write."""
        with self.store.lock:
            owned = not self.store.db.in_transaction
            if owned:
                self.store.db.execute("BEGIN IMMEDIATE")
            try:
                result = work()
                if owned:
                    self.store.db.commit()
                return result
            except BaseException:
                if owned:
                    self.store.db.rollback()
                raise

    def current_actor(self, supplied):
        if not isinstance(supplied, dict) or not supplied.get("id"):
            raise Forbidden("Use a current authenticated workspace account.")
        actor = self._grant(supplied["id"])
        if not actor or not actor.get("active") or actor.get("expires_at") and actor["expires_at"] <= now():
            raise Forbidden("This workspace account is no longer active.")
        identity = actor.get("institutional")
        if identity:
            provider = self._get("identity_provider", identity["provider_id"], missing=True)
            account = self._get("identity_account", actor["id"], missing=True)
            if (not provider or not provider["payload"]["enabled"]
                    or provider["payload"].get("activation_epoch") != self.store.setting("identity_epoch")
                    or not account or account["payload"]["status"] != "active"
                    or provider["revision"] != identity["provider_revision"]):
                raise Forbidden("The institutional access configuration changed. Sign in again.")
        return actor

    def _delegation(self, actor):
        if actor.get("admin"):
            return {"owner": True, "roles": sorted(ROLES), "unit_ids": [], "delegation_ids": [], "units_by_role": {}}
        answer = {"owner": False, "roles": [], "unit_ids": [], "delegation_ids": [], "units_by_role": {}}
        epoch = self.store.setting("identity_epoch")
        for record in self._rows("identity_delegation"):
            p = record["payload"]
            if (p["grantee_id"] == actor["id"] and p["active"] and p["epoch"] == epoch
                    and p["expires_at"] > now()):
                answer["roles"].extend(p["roles"])
                answer["unit_ids"].extend(p["unit_ids"])
                answer["delegation_ids"].append(record["id"])
                for role in p["roles"]:
                    answer["units_by_role"].setdefault(role, []).extend(p["unit_ids"])
        answer["roles"] = sorted(set(answer["roles"]))
        answer["unit_ids"] = sorted(set(answer["unit_ids"]))
        answer["units_by_role"] = {role: sorted(set(units)) for role, units in answer["units_by_role"].items()}
        return answer

    def capabilities(self, actor):
        with self.store.lock:
            current = self.current_actor(actor)
            scope = self._delegation(current)
            return {**scope, "can_administer": scope["owner"] or bool(scope["delegation_ids"])}

    def _owner(self, actor):
        current = self.current_actor(actor)
        if not current.get("admin"):
            raise Forbidden("The workspace owner maintains institutional provider and privileged access configuration.")
        return current

    def _access_allowed(self, actor, assignment):
        caps = self._delegation(self.current_actor(actor))
        if caps["owner"]:
            return True
        return (
            assignment["role"] in caps["roles"]
            and bool(assignment["unit_ids"])
            and set(assignment["unit_ids"]).issubset(caps["units_by_role"].get(assignment["role"], []))
            and set(assignment["recipient_unit_ids"]).issubset(caps["units_by_role"].get(assignment["role"], []))
        )

    def _account_visible(self, actor, record):
        if actor.get("admin") or record["id"] == actor["id"]:
            return True
        assignment = record["payload"].get("current_access")
        return bool(assignment and self._access_allowed(actor, assignment))

    def _invalidate_provider(self, provider_id, actor, reason):
        revoked = []
        for grant in self.store.grants():
            if grant.get("institutional", {}).get("provider_id") != provider_id:
                continue
            grant.update(active=False, access_change_reason=reason, access_changed_at=now())
            self.store.db.execute("UPDATE grants SET body=? WHERE id=?", (encoded(grant), grant["id"]))
            self.store.db.execute("DELETE FROM sessions WHERE grant_id=?", (grant["id"],))
            revoked.append(grant["id"])
        for row in self.store.db.execute("SELECT state_sha256,body FROM identity_logins").fetchall():
            if json.loads(row["body"])["provider_id"] == provider_id:
                self.store.db.execute("DELETE FROM identity_logins WHERE state_sha256=?", (row["state_sha256"],))
        self.store._event(actor, "institutional_sessions_invalidated", provider_id,
                          {"reason": reason, "accounts": revoked})
        return revoked

    @staticmethod
    def _provider_config(p, callback):
        allowed = {
            "label", "issuer", "client_id", "client_secret_env", "ca_bundle_env",
            "allowed_endpoint_origins", "scopes", "claim_names", "max_age",
            "session_minutes", "idle_minutes", "owners", "technical_contact",
            "enrollment_reference", "support_notes", "required_acr_values",
        }
        if not isinstance(p, dict) or set(p) - allowed:
            raise ValueError("The provider configuration contains unsupported fields.")
        result = {
            "label": text(p.get("label"), "Provider label", 120),
            "issuer": literal(p.get("issuer"), "Registered issuer", 4096),
            "client_id": literal(p.get("client_id"), "Registered client ID", 1024),
            "redirect_uri": callback,
            "client_secret_env": p.get("client_secret_env"),
            "ca_bundle_env": p.get("ca_bundle_env") or None,
            "allowed_endpoint_origins": p.get("allowed_endpoint_origins", []),
            "scopes": p.get("scopes", ["openid", "profile"]),
            "claim_names": p.get("claim_names", ["name", "email", "preferred_username", "groups"]),
            "max_age": integer(p.get("max_age", 300), "Authentication age", 0, 3600),
            "session_minutes": integer(p.get("session_minutes", 480), "Session minutes", 5, 480),
            "idle_minutes": integer(p.get("idle_minutes", 30), "Idle minutes", 1, 60),
            "technical_contact": text(p.get("technical_contact"), "Technical contact", 512, optional=True),
            "enrollment_reference": text(p.get("enrollment_reference"), "Enrollment reference", 1024, optional=True),
            "support_notes": text(p.get("support_notes"), "Support notes", 8000, optional=True),
            "required_acr_values": p.get("required_acr_values", []),
        }
        if result["idle_minutes"] > result["session_minutes"]:
            raise ValueError("Idle expiry cannot exceed the absolute session duration.")
        for key in ("client_secret_env", "ca_bundle_env"):
            v = result[key]
            if (key == "client_secret_env" or v is not None) and (not isinstance(v, str) or not _ENV.fullmatch(v)):
                raise ValueError("Use the environment variable name for the private " + key + ".")
        owners = p.get("owners", [])
        if not isinstance(owners, list) or len(owners) > 10:
            raise ValueError("Enter the institutional integration owners.")
        result["owners"] = []
        for owner in owners:
            if not isinstance(owner, dict) or set(owner) - {"name", "email", "affiliation"}:
                raise ValueError("An institutional owner needs a name, email and affiliation.")
            result["owners"].append({
                "name": text(owner.get("name"), "Owner name", 120),
                "email": text(owner.get("email"), "Owner email", 254).casefold(),
                "affiliation": text(owner.get("affiliation"), "Owner affiliation", 120),
            })
        owner_emails = [owner["email"] for owner in result["owners"]]
        if (len(set(owner_emails)) != len(owner_emails)
                or any(not re.fullmatch(r"[^@\s]+@[^@\s]+", email) for email in owner_emails)):
            raise ValueError("Record distinct institutional owners with their individual email addresses.")
        for key, maximum in (("scopes", 16), ("claim_names", 32), ("required_acr_values", 16)):
            values = result[key]
            if (not isinstance(values, list) or len(values) > maximum
                    or any(not isinstance(v, str) or not v or len(v) > 256
                           or any(ord(c) < 33 or ord(c) == 127 for c in v) for v in values)
                    or len(set(values)) != len(values)):
                raise ValueError(key + " must be an explicit, unique list.")
        if "openid" not in result["scopes"]:
            raise ValueError("Institutional authentication requires the openid scope.")
        if any(not _CLAIM.fullmatch(v) or v in RESERVED_CLAIMS for v in result["claim_names"]):
            raise ValueError("Choose explicitly released additional claim names.")
        from . import identity_oidc
        identity_oidc._config(result)
        return result

    def save_provider(self, actor, p, callback):
        self._owner(actor)
        rid = identifier(p.get("id") or "provider-" + secrets.token_hex(12))
        previous = self._get("identity_provider", rid, missing=True)
        config = self._provider_config(p.get("configuration"), callback)
        old = previous["payload"] if previous else {}
        protocol_keys = {
            "issuer", "client_id", "redirect_uri", "client_secret_env", "ca_bundle_env",
            "allowed_endpoint_origins", "scopes", "claim_names", "max_age",
            "session_minutes", "idle_minutes", "required_acr_values",
        }
        changed = any(config.get(k) != old.get("configuration", {}).get(k) for k in protocol_keys)
        payload = {
            "configuration": config,
            "enabled": bool(old.get("enabled")) and not changed,
            "metadata": copy.deepcopy(old.get("metadata")) if not changed else None,
            "metadata_sha256": old.get("metadata_sha256") if not changed else None,
            "metadata_checked_at": old.get("metadata_checked_at") if not changed else None,
            "activation_epoch": old.get("activation_epoch") if not changed else None,
            "activation_note": old.get("activation_note", ""),
            "changed_by": actor["id"], "change_note": text(p.get("note"), "Configuration change note", 4000),
        }
        record = self._save("identity_provider", rid, payload, p.get("expected_revision", 0), actor["id"])
        # Provider revision is itself the session binding, including ownership edits.
        revoked = self._invalidate_provider(rid, actor["id"], "provider edition changed")
        return {"record": record, "revoked_accounts": revoked}

    def inspect_provider(self, actor, p):
        """Network work occurs before the original atomic configuration adoption."""
        with self.store.lock:
            self._owner(actor)
            record = copy.deepcopy(self._get("identity_provider", p["id"]))
            if p.get("expected_revision") != record["revision"]:
                raise Conflict("Reopen the current provider before inspecting it.")
        from . import identity_oidc
        metadata = identity_oidc.discover(record["payload"]["configuration"])
        return {"id": record["id"], "expected_revision": record["revision"],
                "metadata": metadata, "metadata_sha256": fingerprint(metadata), "checked_at": now()}

    def adopt_inspection(self, actor, prepared):
        self._owner(actor)
        previous = self._get("identity_provider", prepared["id"])
        if previous["revision"] != prepared["expected_revision"]:
            raise Conflict("The provider changed while its metadata was being read.")
        payload = copy.deepcopy(previous["payload"])
        payload.update(metadata=prepared["metadata"], metadata_sha256=prepared["metadata_sha256"],
                       metadata_checked_at=prepared["checked_at"], enabled=False,
                       activation_epoch=None)
        saved = self._save(previous["kind"], previous["id"], payload, previous["revision"], actor["id"])
        revoked = self._invalidate_provider(saved["id"], actor["id"], "provider metadata reviewed")
        return {"record": saved, "revoked_accounts": revoked}

    def activate_provider(self, actor, p, callback):
        self._owner(actor)
        record = self._get("identity_provider", p["id"])
        if p.get("expected_revision") != record["revision"]:
            raise Conflict("Reopen the current provider edition.")
        payload = copy.deepcopy(record["payload"])
        enabled = flag(p.get("enabled"), "Provider enabled")
        note = text(p.get("note"), "Activation or closure note", 4000)
        config = payload["configuration"]
        if enabled:
            if config["redirect_uri"] != callback:
                raise Conflict("Save this provider against the receiving host's current callback.")
            from . import identity_oidc
            identity_oidc._metadata(config, payload.get("metadata"))
            if payload.get("metadata_sha256") != fingerprint(payload["metadata"]):
                raise ValueError("Inspect and retain the original provider metadata before activation.")
            if len({owner["email"].strip().casefold() for owner in config["owners"]}) < 2:
                raise ValueError("Record the two accountable institutional integration owners.")
            if not config["enrollment_reference"]:
                raise ValueError("Record the provider enrollment or private practice registration reference.")
        payload.update(enabled=enabled, activation_epoch=self.store.setting("identity_epoch") if enabled else None,
                       activation_note=note, activated_by=actor["id"], activated_at=now())
        saved = self._save(record["kind"], record["id"], payload, record["revision"], actor["id"])
        revoked = self._invalidate_provider(record["id"], actor["id"], "provider activation changed")
        return {"record": saved, "revoked_accounts": revoked}

    def save_rule(self, actor, p):
        self._owner(actor)
        provider = self._get("identity_provider", p["provider_id"])
        conditions = p.get("conditions")
        if not isinstance(conditions, list) or not 1 <= len(conditions) <= 16:
            raise ValueError("A mapping needs one or more explicit verified-claim conditions.")
        allowed = set(provider["payload"]["configuration"]["claim_names"]) | {"sub"}
        normalized = []
        for condition in conditions:
            if (not isinstance(condition, dict) or set(condition) != {"claim", "comparison", "value"}
                    or condition["claim"] not in allowed
                    or condition["comparison"] not in {"equals", "contains"}):
                raise ValueError("Use a declared released claim and an equals or contains condition.")
            normalized.append({
                "claim": condition["claim"], "comparison": condition["comparison"],
                "value": literal(condition["value"], "Exact required claim value", 512),
            })
        payload = {
            "provider_id": provider["id"], "label": text(p.get("label"), "Mapping name", 120),
            "enabled": flag(p.get("enabled", True), "Mapping enabled"),
            "conditions": normalized, "access": access(p.get("access")),
            "expires_at": timestamp(p.get("expires_at"), "Mapping expiry"),
            "note": text(p.get("note"), "Mapping review note", 4000), "reviewed_by": actor["id"],
        }
        rid = identifier(p.get("id") or "mapping-" + secrets.token_hex(12))
        old = self._get("identity_rule", rid, missing=True)
        if old and old["payload"]["provider_id"] != provider["id"]:
            raise ValueError("Create a new mapping when selecting another provider.")
        saved = self._save("identity_rule", rid, payload, p.get("expected_revision", 0), actor["id"])
        revoked = self._invalidate_provider(provider["id"], actor["id"], "authorization mapping changed")
        return {"record": saved, "revoked_accounts": revoked}

    def _rule_access(self, provider_id, claims):
        matches = []
        for record in self._rows("identity_rule"):
            p = record["payload"]
            if (p["provider_id"] != provider_id or not p["enabled"]
                    or p["expires_at"] and p["expires_at"] <= now()):
                continue
            matched = True
            for condition in p["conditions"]:
                value = claims.get(condition["claim"])
                if condition["comparison"] == "equals":
                    ok = isinstance(value, str) and value == condition["value"]
                else:
                    ok = (isinstance(value, list) and all(isinstance(v, str) for v in value)
                          and condition["value"] in value)
                if not ok:
                    matched = False
                    break
            if matched:
                matches.append(record)
        if len(matches) != 1:
            return None, "No reviewed mapping matches." if not matches else "Several reviewed mappings match; resolve their overlap."
        record = matches[0]
        return {"access": copy.deepcopy(record["payload"]["access"]), "rule_id": record["id"],
                "rule_revision": record["revision"], "expires_at": record["payload"]["expires_at"]}, None

    def save_account(self, actor, p):
        current = self.current_actor(actor)
        provider = self._get("identity_provider", p["provider_id"])
        issuer = provider["payload"]["configuration"]["issuer"]
        subject = literal(p.get("subject"), "Original provider subject", 255)
        if not subject.isascii():
            raise ValueError("The OIDC subject must retain its original ASCII value.")
        rid = account_id(issuer, subject)
        previous = self._get("identity_account", rid, missing=True)
        if previous and previous["payload"]["provider_id"] != provider["id"]:
            raise Conflict("This issuer and subject already belong to another saved provider. Reconcile that original provider.")
        if previous and not self._account_visible(current, previous):
            raise Forbidden("This account is outside the delegated administration scope.")
        status = p.get("status", "active")
        mode = p.get("mode", "manual")
        if status not in {"active", "pending", "disabled"} or mode not in {"manual", "rules"}:
            raise ValueError("Choose an account lifecycle state and an access assignment method.")
        assignment = access(p.get("access")) if mode == "manual" else None
        if not current.get("admin"):
            if mode != "manual" or not assignment or not self._access_allowed(current, assignment):
                raise Forbidden("A delegate can assign only its declared roles and unit scope.")
            if previous and previous["payload"]["mode"] != "manual":
                raise Forbidden("The owner reviews a rule-managed account before delegating its manual assignment.")
        old = previous["payload"] if previous else {}
        payload = {
            "provider_id": provider["id"], "issuer": issuer, "subject": subject,
            "label": text(p.get("label", old.get("label", subject)), "Account label", 120),
            "email": text(p.get("email", old.get("email", "")), "Account email", 254, optional=True),
            "mode": mode, "status": status, "manual_access": assignment,
            "current_access": assignment if mode == "manual" else old.get("current_access"),
            "expires_at": timestamp(p.get("expires_at"), "Account expiry"),
            "note": text(p.get("note"), "Account lifecycle note", 4000),
            "changed_by": current["id"], "last_authenticated_at": old.get("last_authenticated_at"),
            "last_verified_claims": old.get("last_verified_claims", {}),
            "last_authentication": old.get("last_authentication"),
            "access_basis": old.get("access_basis"), "access_message": "",
        }
        saved = self._save("identity_account", rid, payload, p.get("expected_revision", 0), current["id"])
        self._invalidate_account(rid, current["id"], "account assignment changed")
        return {"record": saved, "requires_new_sign_in": True}

    def _invalidate_account(self, rid, actor, reason):
        grant = self._grant(rid)
        if grant:
            grant.update(active=False, access_change_reason=reason, access_changed_at=now())
            self.store.db.execute("UPDATE grants SET body=? WHERE id=?", (encoded(grant), rid))
            self.store.db.execute("DELETE FROM sessions WHERE grant_id=?", (rid,))
        self.store._event(actor, "institutional_account_access_changed", rid, {"reason": reason})

    def save_delegation(self, actor, p):
        self._owner(actor)
        grantee = self._grant(identifier(p["grantee_id"]))
        account = self._get("identity_account", p["grantee_id"], missing=True)
        if p["grantee_id"] == "owner" or not grantee and not account:
            raise ValueError("Choose an existing named account or access-link holder other than the owner.")
        roles = p.get("roles")
        if (not isinstance(roles, list) or not roles or len(set(roles)) != len(roles)
                or any(v not in DELEGABLE_ROLES for v in roles)):
            raise ValueError("Delegate explicit unit leadership, IT leadership, Medicine IT or advisory administration.")
        units = identifiers(p.get("unit_ids"), "Delegated unit IDs")
        if not units:
            raise ValueError("Delegated administration requires an explicit unit scope.")
        expires = timestamp(p.get("expires_at"), "Delegation expiry", optional=False)
        if expires <= now() or expires > (datetime.now(timezone.utc) + timedelta(days=366)).isoformat():
            raise ValueError("A delegation must expire within the next 366 days.")
        rid = identifier(p.get("id") or "delegation-" + secrets.token_hex(12))
        old = self._get("identity_delegation", rid, missing=True)
        if old and old["payload"]["grantee_id"] != p["grantee_id"]:
            raise ValueError("Create a new delegation for a different administrator.")
        payload = {
            "grantee_id": p["grantee_id"], "roles": sorted(roles), "unit_ids": units,
            "active": flag(p.get("active", True), "Delegation active"),
            "expires_at": expires, "epoch": self.store.setting("identity_epoch"),
            "note": text(p.get("note"), "Delegation review note", 4000),
            "granted_by": actor["id"],
        }
        saved = self._save("identity_delegation", rid, payload, p.get("expected_revision", 0), actor["id"])
        self.store._event(actor["id"], "access_administration_changed", p["grantee_id"],
                          {"delegation": rid, "revision": saved["revision"],
                           "active": payload["active"], "roles": payload["roles"], "unit_ids": units})
        return {"record": saved}

    def _configuration_basis(self, provider_id):
        provider = self._get("identity_provider", provider_id)
        rules = self._rows("identity_rule")
        accounts = self._rows("identity_account")
        delegations = self._rows("identity_delegation")
        account_ids = {r["id"] for r in accounts if r["payload"]["provider_id"] == provider_id}
        basis = {
            "provider": {"id": provider["id"], "revision": provider["revision"],
                         "sha256": fingerprint(provider)},
            "rules": [{"id": r["id"], "revision": r["revision"], "sha256": fingerprint(r)}
                      for r in rules if r["payload"]["provider_id"] == provider_id],
            "accounts": [{
                "id": r["id"],
                "access_sha256": fingerprint({k: r["payload"].get(k) for k in (
                    "provider_id", "issuer", "subject", "mode", "status",
                    "manual_access", "current_access", "expires_at")}),
            } for r in accounts if r["id"] in account_ids],
            "delegations": [{"id": r["id"], "revision": r["revision"], "sha256": fingerprint(r)}
                            for r in delegations if r["payload"]["grantee_id"] in account_ids],
        }
        return basis

    def preview_attestation(self, actor, provider_id):
        with self.store.lock:
            self._owner(actor)
            basis = self._configuration_basis(provider_id)
            return {"basis": basis, "basis_sha256": fingerprint(basis)}

    def save_attestation(self, actor, p):
        self._owner(actor)
        basis = self._configuration_basis(p["provider_id"])
        if p.get("basis_sha256") != fingerprint(basis):
            raise Conflict("Provider or access configuration changed during review. Reopen the current review.")
        outcome = p.get("outcome")
        if outcome not in {"approved", "changes_required"}:
            raise ValueError("Record the review outcome.")
        review_date = timestamp(p.get("reviewed_at"), "Review date", optional=False)
        next_review = timestamp(p.get("next_review_at"), "Next review date", optional=False)
        if next_review <= review_date:
            raise ValueError("The next review date must follow this review.")
        payload = {
            "provider_id": p["provider_id"], "basis": basis, "basis_sha256": fingerprint(basis),
            "outcome": outcome, "reviewed_at": review_date, "next_review_at": next_review,
            "reviewer_name": text(p.get("reviewer_name"), "Named reviewer", 120),
            "reviewer_reference": text(p.get("reviewer_reference"), "Review reference", 1024, optional=True),
            "note": text(p.get("note"), "Review findings", 8000),
            "exceptions": text(p.get("exceptions"), "Exceptions and assigned actions", 8000, optional=True),
            "recorded_by": actor["id"],
        }
        rid = identifier(p.get("id") or "attestation-" + secrets.token_hex(12))
        return {"record": self._save("identity_attestation", rid, payload, 0, actor["id"])}

    def begin_login(self, provider_id, callback, remote_context):
        with self.store.lock:
            self.store.db.execute("BEGIN IMMEDIATE")
            try:
                provider = self._get("identity_provider", provider_id)
                p = provider["payload"]
                if (not p["enabled"] or p.get("activation_epoch") != self.store.setting("identity_epoch")
                        or p["configuration"]["redirect_uri"] != callback):
                    raise Forbidden("This provider is not active on this workspace address.")
                from . import identity_oidc
                identity_oidc._metadata(p["configuration"], p["metadata"])
                bucket = int(time.time()) // 60
                context = fingerprint([provider_id, str(remote_context)[:256]])
                count = self.store.db.execute(
                    "SELECT count FROM identity_rate WHERE context=? AND bucket=?", (context, bucket)).fetchone()
                if count and count["count"] >= 60:
                    raise Forbidden("Wait one minute before starting another institutional sign-in.")
                self.store.db.execute(
                    "INSERT INTO identity_rate VALUES(?,?,1) ON CONFLICT(context,bucket) DO UPDATE SET count=count+1",
                    (context, bucket))
                self.store.db.execute("DELETE FROM identity_rate WHERE bucket<?", (bucket - 2,))
                for row in self.store.db.execute("SELECT state_sha256,body FROM identity_logins").fetchall():
                    if json.loads(row["body"])["expires_at"] <= time.time():
                        self.store.db.execute("DELETE FROM identity_logins WHERE state_sha256=?", (row["state_sha256"],))
                state, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
                stamp = time.time()
                body = {
                    "provider_id": provider_id, "provider_revision": provider["revision"],
                    "configuration_sha256": fingerprint(p["configuration"]),
                    "metadata_sha256": p["metadata_sha256"],
                    "epoch": self.store.setting("identity_epoch"), "callback": callback,
                    "nonce": nonce, "verifier": verifier,
                    "browser_sha256": hashlib.sha256(browser.encode()).hexdigest(),
                    "requested_at": stamp, "expires_at": stamp + 600,
                }
                location = identity_oidc.authorization_url(p["configuration"], p["metadata"], state, nonce, verifier)
                self.store.db.execute("INSERT INTO identity_logins VALUES(?,?)",
                                      (hashlib.sha256(state.encode()).hexdigest(), encoded(body)))
                self.store.db.commit()
                return {"authorization_url": location, "browser_binding": browser, "expires_in": 600}
            except BaseException:
                self.store.db.rollback()
                raise

    def consume_login(self, state, browser, provider_id, callback):
        if (not isinstance(state, str) or not 20 <= len(state) <= 256
                or not isinstance(browser, str) or not 20 <= len(browser) <= 256):
            raise Forbidden("The browser sign-in transaction is absent or no longer current.")
        key = hashlib.sha256(state.encode()).hexdigest()
        with self.store.lock:
            self.store.db.execute("BEGIN IMMEDIATE")
            try:
                row = self.store.db.execute("SELECT body FROM identity_logins WHERE state_sha256=?", (key,)).fetchone()
                if not row:
                    raise Forbidden("This sign-in transaction was already used or expired.")
                flow = json.loads(row["body"])
                if (flow["expires_at"] <= time.time() or flow["provider_id"] != provider_id
                        or flow["callback"] != callback
                        or flow["epoch"] != self.store.setting("identity_epoch")
                        or not hmac.compare_digest(flow["browser_sha256"], hashlib.sha256(browser.encode()).hexdigest())):
                    raise Forbidden("The sign-in response does not belong to this browser and workspace.")
                provider = self._get("identity_provider", provider_id)
                if (not provider["payload"]["enabled"] or provider["revision"] != flow["provider_revision"]
                        or provider["payload"].get("activation_epoch") != flow["epoch"]
                        or fingerprint(provider["payload"]["configuration"]) != flow["configuration_sha256"]):
                    raise Forbidden("The provider configuration changed. Start a new sign-in.")
                self.store.db.execute("DELETE FROM identity_logins WHERE state_sha256=?", (key,))
                self.store.db.commit()
                return {**flow, "provider": copy.deepcopy(provider)}
            except BaseException:
                self.store.db.rollback()
                raise

    def complete_login(self, flow, claims, user_agent=""):
        """Adopt only protocol-verified claims; credentials never enter a record."""
        with self.store.lock:
            self.store.db.execute("BEGIN IMMEDIATE")
            try:
                provider = self._get("identity_provider", flow["provider_id"])
                p = provider["payload"]
                if (provider["revision"] != flow["provider_revision"] or not p["enabled"]
                        or flow["epoch"] != self.store.setting("identity_epoch")
                        or p["activation_epoch"] != flow["epoch"]):
                    raise Forbidden("The workspace configuration changed while the provider was signing in.")
                if claims.get("iss") != p["configuration"]["issuer"]:
                    raise Forbidden("The authenticated issuer changed.")
                subject = literal(claims.get("sub"), "Verified subject", 255)
                if not subject.isascii():
                    raise Forbidden("The verified subject is not an OIDC subject identifier.")
                rid = account_id(claims["iss"], subject)
                previous = self._get("identity_account", rid, missing=True)
                old = previous["payload"] if previous else {}
                if old and old["provider_id"] != provider["id"]:
                    raise Forbidden("This original institutional identity is assigned to another saved provider.")
                payload = copy.deepcopy(old) if old else {
                    "provider_id": provider["id"], "issuer": claims["iss"], "subject": subject,
                    "mode": "rules", "status": "pending", "manual_access": None,
                    "current_access": None, "expires_at": None, "note": "",
                    "changed_by": "institutional-sign-in",
                }
                retained_claims = {k: copy.deepcopy(claims[k]) for k in p["configuration"]["claim_names"] if k in claims}
                payload.update(
                    label=text(claims.get("name") or old.get("label") or subject, "Account name", 256)[:120],
                    email=text(claims.get("email", old.get("email", "")), "Account email", 254, optional=True),
                    last_authenticated_at=now(), last_verified_claims=retained_claims,
                    last_authentication={k: claims[k] for k in ("iss", "sub", "iat", "exp", "auth_time")},
                )
                basis, reason = None, None
                if old.get("status") == "disabled":
                    reason = "This account was disabled by its workspace administrator."
                elif payload.get("expires_at") and payload["expires_at"] <= now():
                    reason = "This account's workspace assignment expired."
                elif payload["mode"] == "manual":
                    if old.get("status") != "active" or not payload.get("manual_access"):
                        reason = "The recorded account assignment is awaiting access review."
                    else:
                        basis = {"access": access(payload["manual_access"]), "rule_id": None,
                                 "rule_revision": None, "expires_at": payload.get("expires_at")}
                else:
                    basis, reason = self._rule_access(provider["id"], claims)
                if basis:
                    payload.update(status="active", current_access=basis["access"], access_basis=basis, access_message="")
                else:
                    payload["status"] = "disabled" if old.get("status") == "disabled" else "pending"
                    payload["access_message"] = reason
                saved = self._save("identity_account", rid, payload, previous["revision"] if previous else 0, rid)
                if not basis:
                    self._invalidate_account(rid, rid, reason)
                    self.store.db.commit()
                    return {"permitted": False, "account_id": rid, "reason": reason,
                            "provider_label": p["configuration"]["label"]}
                assignment = basis["access"]
                expiry = _deadline(p["configuration"]["session_minutes"])
                for limit in (payload.get("expires_at"), basis.get("expires_at")):
                    if limit:
                        expiry = min(expiry, limit)
                body = {
                    "id": rid, "label": payload["label"], **copy.deepcopy(assignment),
                    "admin": False, "active": True, "created_at": previous["created_at"] if previous else now(),
                    "expires_at": expiry,
                    "institutional": {
                        "provider_id": provider["id"], "provider_revision": provider["revision"],
                        "issuer": claims["iss"], "subject": subject, "account_revision": saved["revision"],
                        "authentication_time": claims["auth_time"], "rule_id": basis["rule_id"],
                        "rule_revision": basis["rule_revision"],
                    },
                }
                existing = self._grant(rid)
                if existing and any(existing.get(k) != body.get(k) for k in ACCESS_FIELDS):
                    self.store.db.execute("DELETE FROM sessions WHERE grant_id=?", (rid,))
                # This unexposed random digest cannot be used as a classic access link.
                placeholder = hashlib.sha256(secrets.token_bytes(48)).hexdigest()
                self.store.db.execute(
                    "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                    (rid, placeholder, encoded(body)))
                token = secrets.token_urlsafe(36)
                token_sha = hashlib.sha256(token.encode()).hexdigest()
                self.store.db.execute("INSERT INTO sessions VALUES(?,?,?)", (token_sha, rid, expiry))
                details = {
                    "id": "session-" + secrets.token_hex(16), "method": "oidc",
                    "created_at": now(), "last_seen_at": now(), "expires_at": expiry,
                    "provider_id": provider["id"], "provider_revision": provider["revision"],
                    "account_id": rid, "account_revision": saved["revision"],
                    "authentication_time": claims["auth_time"],
                    "user_agent": str(user_agent)[:256], "idle_minutes": p["configuration"]["idle_minutes"],
                }
                self.store.db.execute("INSERT INTO identity_session_details VALUES(?,?,?)",
                                      (token_sha, details["id"], encoded(details)))
                self.store._event(rid, "institutional_session_opened", details["id"],
                                  {"provider_id": provider["id"], "account_id": rid,
                                   "rule_id": basis["rule_id"], "expires_at": expiry})
                self.store.db.commit()
                return {"permitted": True, "token": token, "actor": body, "session": details}
            except BaseException:
                self.store.db.rollback()
                raise

    def session_actor(self, token, body):
        """Called by the original Store.session while its re-entrant lock is held."""
        with self.store.lock:
            try:
                current = self.current_actor(body)
            except Forbidden:
                return None
            token_sha = hashlib.sha256(token.encode()).hexdigest()
            row = self.store.db.execute(
                "SELECT body FROM identity_session_details WHERE token_sha256=?", (token_sha,)).fetchone()
            details = json.loads(row["body"]) if row else None
            if current.get("institutional"):
                if not details:
                    return None
                idle = datetime.fromisoformat(details["last_seen_at"]) + timedelta(minutes=details["idle_minutes"])
                if idle <= datetime.now(timezone.utc):
                    def expire():
                        self.store.db.execute("DELETE FROM sessions WHERE token_sha256=?", (token_sha,))
                        self.store._event(current["id"], "institutional_session_idle_expired", details["id"], {})
                    self._transient(expire)
                    return None
                if (datetime.now(timezone.utc) - datetime.fromisoformat(details["last_seen_at"])).total_seconds() >= 30:
                    details["last_seen_at"] = now()
                    self._transient(lambda: self.store.db.execute(
                        "UPDATE identity_session_details SET body=? WHERE token_sha256=?",
                        (encoded(details), token_sha)))
            caps = self._delegation(current)
            return {**copy.deepcopy(current), "access_administration": caps,
                    "session_id": details["id"] if details else None}

    def sessions(self, actor, account=None):
        with self.store.lock:
            current = self.current_actor(actor)
            target = account or current["id"]
            if target != current["id"] and not current.get("admin"):
                record = self._get("identity_account", target, missing=True)
                if not record or not self._account_visible(current, record):
                    raise Forbidden("These sessions are outside the delegated account scope.")
            result = []
            for row in self.store.db.execute(
                "SELECT s.token_sha256,s.grant_id,s.expires_at,d.id,d.body FROM sessions s "
                "LEFT JOIN identity_session_details d ON d.token_sha256=s.token_sha256 "
                "WHERE s.grant_id=? ORDER BY s.expires_at DESC", (target,)).fetchall():
                detail = json.loads(row["body"]) if row["body"] else None
                if detail is None:
                    detail = {"id": "session-" + secrets.token_hex(16), "method": "access_link",
                              "account_id": target, "created_at": None, "last_seen_at": None,
                              "expires_at": row["expires_at"], "user_agent": ""}
                    self._transient(lambda: self.store.db.execute(
                        "INSERT INTO identity_session_details VALUES(?,?,?)",
                        (row["token_sha256"], detail["id"], encoded(detail))))
                result.append({**detail, "active": row["expires_at"] > now()})
            return result

    def revoke_session(self, actor, p):
        current = self.current_actor(actor)
        row = self.store.db.execute(
            "SELECT d.token_sha256,d.body,s.grant_id FROM identity_session_details d "
            "JOIN sessions s ON s.token_sha256=d.token_sha256 WHERE d.id=?", (identifier(p["id"]),)).fetchone()
        if not row:
            return {"id": p["id"], "revoked": True}
        target = row["grant_id"]
        if target != current["id"] and not current.get("admin"):
            record = self._get("identity_account", target, missing=True)
            if not record or not self._account_visible(current, record):
                raise Forbidden("This session is outside the delegated account scope.")
        self.store.db.execute("DELETE FROM sessions WHERE token_sha256=?", (row["token_sha256"],))
        self.store._event(current["id"], "identity_session_revoked", p["id"], {"account_id": target})
        return {"id": p["id"], "revoked": True}

    def history(self, actor, kind, rid):
        if kind not in KINDS:
            raise ValueError("Choose an institutional operating record.")
        with self.store.lock:
            current = self.current_actor(actor)
            record = self._get(kind, rid)
            if kind == "identity_account":
                permitted = self._account_visible(current, record)
            elif kind == "identity_delegation":
                permitted = current.get("admin") or record["payload"]["grantee_id"] == current["id"]
            else:
                permitted = current.get("admin")
            if not permitted:
                raise Forbidden("This institutional history belongs to the workspace access administrators.")
            editions = self.store.history(kind, rid)
            if kind == "identity_account" and not current.get("admin") and rid != current["id"]:
                editions = [r for r in editions if self._account_visible(current, r)]
                for edition in editions:
                    edition["payload"].pop("last_verified_claims", None)
            return editions

    def activity(self, actor, before=None, limit=100, before_sequence=None, event_limit=100):
        """Keep original business activity visible without exposing other access administration."""
        with self.store.lock:
            current = self.current_actor(actor)
            if current.get("admin"):
                return {"operations": self.store.operations(before, limit),
                        "events": self.store.events(before_sequence, event_limit)}
            # Select before limiting so a long run of identity events cannot hide
            # earlier business activity or prevent its existing cursor from advancing.
            def selected(reader, cursor, count, maximum, cursor_key, permitted):
                wanted = max(1, min(int(count), maximum))
                values = []
                while len(values) < wanted:
                    rows = reader(cursor, min(maximum, max(100, wanted - len(values))))
                    if not rows:
                        break
                    for row in rows:
                        if permitted(row):
                            values.append(row)
                            if len(values) == wanted:
                                break
                    next_cursor = rows[-1][cursor_key]
                    if next_cursor == cursor:
                        break
                    cursor = next_cursor
                return values
            def business_event(row):
                return (not row["action"].startswith(("institutional_", "identity_"))
                        and row["action"] != "access_administration_changed"
                        and row["detail"].get("kind") not in KINDS)
            return {
                "operations": selected(self.store.operations, before, limit, 1000, "created_at",
                                       lambda row: not row["action"].startswith("identity.")),
                "events": selected(self.store.events, before_sequence, event_limit, 2000, "sequence",
                                   business_event),
            }

    def state(self, actor):
        with self.store.lock:
            current = self.current_actor(actor)
            caps = self._delegation(current)
            providers = self._rows("identity_provider") if caps["owner"] else []
            accounts = [r for r in self._rows("identity_account") if self._account_visible(current, r)]
            for account in accounts:
                if not caps["owner"] and account["id"] != current["id"]:
                    account["payload"].pop("last_verified_claims", None)
            delegations = [r for r in self._rows("identity_delegation")
                           if caps["owner"] or r["payload"]["grantee_id"] == current["id"]]
            reviews = self._rows("identity_attestation") if caps["owner"] else []
            for r in reviews:
                p = r["payload"]
                p["current_configuration"] = p["basis_sha256"] == fingerprint(self._configuration_basis(p["provider_id"]))
                p["review_due"] = p["next_review_at"] <= now()
            return {
                "capabilities": {**caps, "can_administer": caps["owner"] or bool(caps["delegation_ids"])},
                "roles": sorted(ROLES), "delegable_roles": sorted(DELEGABLE_ROLES),
                "providers": providers, "rules": self._rows("identity_rule") if caps["owner"] else [],
                "provider_options": [{"id": r["id"], "label": r["payload"]["configuration"]["label"],
                                      "enabled": r["payload"]["enabled"] and
                                          r["payload"].get("activation_epoch") == self.store.setting("identity_epoch")}
                                     for r in self._rows("identity_provider")],
                "accounts": accounts, "delegations": delegations, "attestations": reviews,
                "named_grants": self.store.grants() if caps["owner"] else [],
                "sessions": self.sessions(current), "identity_epoch": self.store.setting("identity_epoch") if caps["owner"] else None,
                "restored_from": self.store.setting("restored_from") if caps["owner"] else None,
            }

    def public_providers(self, callback_for):
        with self.store.lock:
            return [{"id": r["id"], "label": r["payload"]["configuration"]["label"]}
                    for r in self._rows("identity_provider")
                    if r["payload"]["enabled"]
                    and r["payload"].get("activation_epoch") == self.store.setting("identity_epoch")
                    and r["payload"]["configuration"]["redirect_uri"] == callback_for(r["id"])]

    def dispatch(self, actor, action, p, operation_id, callback_for):
        if not isinstance(p, dict):
            raise ValueError("Institutional action inputs must be an object.")
        handlers = {
            "identity.provider.save": lambda a: self.save_provider(a, p, callback_for(identifier(p["id"]))),
            "identity.provider.activate": lambda a: self.activate_provider(a, p, callback_for(identifier(p["id"]))),
            "identity.rule.save": lambda a: self.save_rule(a, p),
            "identity.account.save": lambda a: self.save_account(a, p),
            "identity.delegation.save": lambda a: self.save_delegation(a, p),
            "identity.attestation.save": lambda a: self.save_attestation(a, p),
            "identity.session.revoke": lambda a: self.revoke_session(a, p),
        }
        if action == "identity.provider.inspect":
            # Replayed inspection preserves the original accepted metadata result.
            with self.store.lock:
                self._owner(actor)
                previous = self.store.operation(operation_id, action, p, actor["id"])
                if previous:
                    return previous
            prepared = self.inspect_provider(actor, p)
            return self.store.execute(operation_id, action, p, actor["id"],
                                      lambda: self.adopt_inspection(self.current_actor(actor), prepared))
        if action not in handlers:
            raise ValueError("Unknown institutional access operation.")
        return self.store.execute(operation_id, action, p, actor["id"],
                                  lambda: handlers[action](self.current_actor(actor)))


def renew_identity_after_restore(db, restored_from):
    """Called inside the original encrypted restore transaction, before new owner creation."""
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in ("identity_logins", "identity_session_details", "identity_rate"):
        if table in names:
            db.execute("DELETE FROM " + table)
    epoch = secrets.token_hex(24)
    db.execute("INSERT OR REPLACE INTO settings VALUES('identity_epoch',?)", (epoch,))
    db.execute("INSERT OR REPLACE INTO settings VALUES('identity_restored_from',?)", (restored_from,))
    # Configuration and immutable editions remain intact. The new epoch means
    # enabled providers and delegations require the receiving owner's reactivation.
