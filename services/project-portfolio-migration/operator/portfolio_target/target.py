"""Original Project scheduling API transport and retained metadata contract.

Reference: MicrosoftDocs/dynamics-365-project-operations schedule-api-preview,
scheduling-apis-powerautomate and schedule-api-logs; see SOURCE_REFERENCES.json.
This module issues no automatic POST retries and never uses generic CRUD writes.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import stat
from urllib.parse import quote, urlencode, urlsplit
import uuid
import xml.etree.ElementTree as ET

ACTIONS = {
    "msdyn_CreateProjectV1": ("Project",),
    "msdyn_CreateTeamMemberV1": ("TeamMember",),
    "msdyn_CreateOperationSetV1": ("ProjectId", "Description"),
    "msdyn_PssCreateV1": ("Entity", "OperationSetId"),
    "msdyn_PssUpdateV1": ("Entity", "OperationSetId"),
    "msdyn_PssDeleteV1": ("RecordId", "EntityLogicalName", "OperationSetId"),
    "msdyn_ExecuteOperationSetV1": ("OperationSetId",),
    "msdyn_AbandonOperationSetV1": ("OperationSetId",),
    "msdyn_PssUpdateResourceAssignmentContourV1": (
        "ResourceAssignmentId", "UpdatedContours", "OperationSetId"),
}
ENTITIES = (
    "systemuser", "msdyn_project", "msdyn_projectteam", "msdyn_projectbucket",
    "msdyn_projecttask", "msdyn_resourceassignment", "msdyn_projecttaskdependency",
    "msdyn_operationset", "msdyn_operationsetdetail", "msdyn_psserrorlog",
)
NS = {"edm": "http://docs.oasis-open.org/odata/ns/edm"}
SAFE_HEADERS = {
    "content-type", "content-length", "date", "etag", "retry-after",
    "request-id", "x-ms-request-id", "x-ms-service-request-id", "req_id",
    "x-ms-correlation-request-id", "activityid", "preference-applied",
}
NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class TargetError(RuntimeError):
    def __init__(self, code, message, *, evidence=None, dispatched=False):
        super().__init__(message)
        self.code, self.evidence, self.dispatched = code, evidence, dispatched


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def guid(value):
    try:
        parsed = str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise TargetError("TARGET_GUID", "A complete native GUID is required.") from exc
    if parsed == str(uuid.UUID(int=0)):
        raise TargetError("TARGET_GUID", "A nonzero native GUID is required.")
    return parsed


def logical_name(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise TargetError("TARGET_NAME", "Invalid native entity or field name.")
    return value


def odata_string(value):
    return "'" + str(value).replace("'", "''") + "'"


def public_profile(profile):
    return {key: profile[key] for key in (
        "id", "label", "kind", "api_origin", "api_version", "user_id",
        "organization_id", "source_timezone", "licensed_project_user",
        "status_semantics", "operation_set_size",
    ) if key in profile}


def read_profiles(path, workspace_root):
    """Read a locally selected private configuration; tokens stay outside archives."""
    profiles = {"mspdi": {"id": "mspdi", "label": "Microsoft Project XML",
                          "kind": "mspdi"}}
    if path is None:
        return profiles
    config_path = Path(path).expanduser().resolve(strict=True)
    root = Path(workspace_root).resolve()
    if config_path == root or root in config_path.parents:
        raise TargetError("PRIVATE_PROFILE_LOCATION",
                          "Keep the private target configuration outside this workspace.")
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if raw.get("schema") != "portfolio.target-profiles.v1" or not isinstance(raw.get("targets"), list):
        raise TargetError("TARGET_PROFILES", "Expected portfolio.target-profiles.v1.")
    for item in raw["targets"]:
        if not isinstance(item, dict) or item.get("kind") != "project_operations":
            raise TargetError("TARGET_PROFILE", "Use an explicit Project Operations target.")
        p = dict(item)
        key = p.get("id")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", key) or key in profiles:
            raise TargetError("TARGET_PROFILE_ID", "Target IDs must be distinct.")
        u = urlsplit(p.get("api_origin", ""))
        if u.scheme != "https" or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ("", "/"):
            raise TargetError("TARGET_ORIGIN", "Select one exact HTTPS Dynamics API origin.")
        p["api_origin"] = "https://" + u.netloc.lower()
        if p.get("api_version", "9.2") not in ("9.1", "9.2"):
            raise TargetError("TARGET_VERSION", "Select native API version 9.1 or 9.2.")
        p.setdefault("api_version", "9.2")
        p["user_id"], p["organization_id"] = guid(p.get("user_id")), guid(p.get("organization_id"))
        if p.get("licensed_project_user") is not True:
            raise TargetError("LICENSED_USER_SELECTION",
                              "Select the licensed Microsoft Project user for this target.")
        p["operation_set_size"] = int(p.get("operation_set_size", 200))
        if not 1 <= p["operation_set_size"] <= 200:
            raise TargetError("OPERATION_SET_LIMIT", "A native OperationSet holds at most 200 operations.")
        token_path = Path(p.get("token_file", "")).expanduser()
        if not token_path.is_absolute():
            token_path = config_path.parent / token_path
        token_path = token_path.resolve(strict=True)
        if token_path == root or root in token_path.parents:
            raise TargetError("PRIVATE_TOKEN_LOCATION", "Keep the bearer token outside the portable workspace.")
        p["token_file"] = str(token_path)
        p["timeout_seconds"] = int(p.get("timeout_seconds", 90))
        if not 5 <= p["timeout_seconds"] <= 600:
            raise TargetError("TARGET_TIMEOUT", "Choose a target timeout from 5 to 600 seconds.")
        p["max_response_bytes"] = int(p.get("max_response_bytes", 64 * 1024 * 1024))
        if not 1024 <= p["max_response_bytes"] <= 256 * 1024 * 1024:
            raise TargetError("TARGET_RESPONSE_LIMIT", "Choose a complete response limit up to 256 MiB.")
        profiles[key] = p
    return profiles


def access_token(profile):
    path = Path(profile["token_file"])
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
        raise TargetError("TOKEN_FILE", "The selected token file must be a small regular file.")
    if os.name == "posix" and before.st_mode & 0o077:
        raise TargetError("TOKEN_PERMISSIONS", "The selected token file must be private to its owner.")
    value = path.read_text(encoding="utf-8").strip()
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise TargetError("TOKEN_CHANGED", "The selected token changed during this read.")
    if value.startswith("{"):
        value = json.loads(value).get("access_token")
    if not isinstance(value, str) or not value or any(c.isspace() for c in value) or len(value) > 65536:
        raise TargetError("TOKEN_VALUE", "Expected the selected delegated access token.")
    return value


class Metadata:
    """Exact selected CSDL projection; native entity sets and casing remain authoritative."""
    def __init__(self, xml_bytes):
        if b"<!DOCTYPE" in xml_bytes.upper() or b"<!ENTITY" in xml_bytes.upper():
            raise TargetError("METADATA_XML", "Unexpected external XML declaration.")
        try:
            document = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            raise TargetError("METADATA_XML", "The native CSDL response is not complete XML.") from exc
        self.sha256 = hashlib.sha256(xml_bytes).hexdigest()
        types = {}
        for schema in document.findall(".//edm:Schema", NS):
            namespace = schema.get("Namespace", "")
            for node in schema.findall("edm:EntityType", NS):
                types[namespace + "." + node.get("Name", "")] = node
        sets = {}
        for node in document.findall(".//edm:EntitySet", NS):
            sets.setdefault(node.get("EntityType"), []).append(node.get("Name"))
        self.entities = {}
        def fields(type_name, seen=()):
            if type_name in seen or type_name not in types:
                raise TargetError("METADATA_TYPE", "Incomplete or circular native entity inheritance.")
            node = types[type_name]
            base = node.get("BaseType")
            result = fields(base, (*seen, type_name)) if base else {"properties": {}, "navigation": {}, "key": None}
            result = json.loads(json.dumps(result))
            for prop in node.findall("edm:Property", NS):
                result["properties"][prop.get("Name")] = dict(prop.attrib)
            for prop in node.findall("edm:NavigationProperty", NS):
                result["navigation"][prop.get("Name")] = {
                    **prop.attrib,
                    "constraints": [dict(x.attrib) for x in prop.findall("edm:ReferentialConstraint", NS)],
                }
            key = node.find("edm:Key/edm:PropertyRef", NS)
            if key is not None:
                result["key"] = key.get("Name")
            return result
        for name in ENTITIES:
            qualified = "Microsoft.Dynamics.CRM." + name
            if qualified not in types:
                continue
            choices = sets.get(qualified, [])
            if len(choices) != 1:
                raise TargetError("METADATA_ENTITY_SET", "Native entity set is ambiguous for " + name)
            self.entities[name] = {**fields(qualified), "set": choices[0], "type": qualified}
        self.actions = {}
        for node in document.findall(".//edm:Action", NS):
            name = node.get("Name")
            if name in ACTIONS and node.get("IsBound", "false").lower() != "true":
                if name in self.actions:
                    raise TargetError("METADATA_ACTION", "Ambiguous native action " + name)
                self.actions[name] = {p.get("Name"): dict(p.attrib) for p in node.findall("edm:Parameter", NS)}
        for action, parameters in ACTIONS.items():
            if action not in self.actions or set(self.actions[action]) != set(parameters):
                raise TargetError("TARGET_ACTION_UNAVAILABLE",
                                  "The selected environment does not expose the expected native " + action)
        for name in ENTITIES:
            if name not in self.entities:
                raise TargetError("TARGET_ENTITY_UNAVAILABLE", "The selected environment lacks " + name)

    def summary(self):
        return {"schema": "portfolio.native-target-metadata.v1", "sha256": self.sha256,
                "entities": self.entities, "actions": self.actions}

    def entity(self, name):
        try:
            return self.entities[name]
        except KeyError as exc:
            raise TargetError("TARGET_ENTITY", "Entity is outside the reviewed target contract.") from exc

    def field(self, entity, wanted, *, navigation=False):
        group = self.entity(entity)["navigation" if navigation else "properties"]
        candidates = [name for name in group if name.lower() == wanted.lower()]
        if len(candidates) != 1:
            raise TargetError("TARGET_FIELD", "Native field is absent or ambiguous: " + entity + "." + wanted)
        return candidates[0]

    def lookup(self, entity, navigation):
        name = self.field(entity, navigation, navigation=True)
        constraints = self.entity(entity)["navigation"][name]["constraints"]
        if len(constraints) != 1:
            raise TargetError("TARGET_LOOKUP", "Expected one native lookup constraint for " + entity + "." + name)
        return constraints[0]["Property"]

    def binding(self, entity, record_id):
        return "/" + self.entity(entity)["set"] + "(" + guid(record_id) + ")"

    def validate_entity(self, payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("@odata.type"), str):
            raise TargetError("TARGET_ENTITY_PAYLOAD", "A native typed entity is required.")
        name = payload["@odata.type"].removeprefix("Microsoft.Dynamics.CRM.")
        schema = self.entity(name)
        for key, value in payload.items():
            if key == "@odata.type":
                continue
            if key.endswith("@odata.bind"):
                nav = key[:-11]
                if nav not in schema["navigation"]:
                    raise TargetError("TARGET_BINDING", "Unknown selected native relationship " + key)
                if not isinstance(value, str) or not re.fullmatch(r"/[A-Za-z_][A-Za-z0-9_]*\([0-9a-f-]{36}\)", value):
                    raise TargetError("TARGET_BINDING", "Expected a prepared native entity reference.")
                target = schema["navigation"][nav].get("Type", "").removeprefix("Microsoft.Dynamics.CRM.")
                if target in self.entities and value.split("(")[0] != "/" + self.entity(target)["set"]:
                    raise TargetError("TARGET_BINDING", "Relationship points to another entity set.")
            elif key not in schema["properties"]:
                raise TargetError("TARGET_PROPERTY", "Unknown selected native property " + name + "." + key)
        return name


class NativeTarget:
    def __init__(self, profile, *, observe=None):
        if profile.get("kind") != "project_operations":
            raise TargetError("TARGET_KIND", "Select the Project Operations target.")
        self.profile = profile
        self.origin = profile["api_origin"]
        self.api_root = self.origin + "/api/data/v" + profile["api_version"] + "/"
        self.observe = observe or (lambda value: None)
        self.metadata = None

    def request(self, method, relative, payload=None, *, allow_not_found=False, before_dispatch=None):
        """One actual HTTP attempt. The caller saves request identity before a POST."""
        if method not in ("GET", "POST"):
            raise TargetError("TARGET_METHOD", "Only native reads and scheduling actions are supported.")
        url = relative if relative.startswith("https://") else self.api_root + relative
        parsed = urlsplit(url)
        root = urlsplit(self.api_root)
        if (parsed.scheme, parsed.netloc) != (root.scheme, root.netloc) or not parsed.path.startswith(root.path) or parsed.fragment or parsed.username:
            raise TargetError("TARGET_URL", "The native URL must stay in the selected environment API.")
        if any(c in url for c in ("\r", "\n", "\x00")):
            raise TargetError("TARGET_URL", "Invalid target URL.")
        body = canonical(payload) if payload is not None else None
        token = access_token(self.profile)
        headers = {"Authorization": "Bearer " + token, "Accept": "application/json",
                   "OData-Version": "4.0", "OData-MaxVersion": "4.0",
                   "Accept-Encoding": "identity",
                   "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'}
        if method == "GET":
            headers["If-None-Match"] = "null"
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443,
                                          timeout=self.profile.get("timeout_seconds", 90),
                                          context=ssl.create_default_context())
        started = utcnow()
        dispatched = False
        response = None
        raw = b""
        try:
            if before_dispatch is not None:
                before_dispatch()
            # Once request() begins, a lost reply may conceal an accepted native write.
            dispatched = True
            conn.request(method, parsed.path + (("?" + parsed.query) if parsed.query else ""),
                         body=body, headers=headers)
            res = conn.getresponse()
            limit = self.profile.get("max_response_bytes", 64 * 1024 * 1024)
            chunks, count = [], 0
            while True:
                chunk = res.read(min(1024 * 1024, limit + 1 - count))
                if not chunk:
                    break
                count += len(chunk)
                if count > limit:
                    raise TargetError("TARGET_RESPONSE_LIMIT",
                                      "The native response exceeds the selected complete-response limit.",
                                      dispatched=dispatched)
                chunks.append(chunk)
            raw = b"".join(chunks)
            response = {"method": method, "url": url, "started_at": started,
                        "finished_at": utcnow(), "status": res.status,
                        "headers": {k.lower(): v for k, v in res.getheaders() if k.lower() in SAFE_HEADERS},
                        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                        "body_base64": base64.b64encode(raw).decode("ascii"), "complete": True}
            self.observe(response)
            if allow_not_found and res.status == 404:
                return None, response
            if not 200 <= res.status < 300:
                raise TargetError("TARGET_HTTP_" + str(res.status),
                                  "The native service returned HTTP " + str(res.status) + ".",
                                  evidence=response, dispatched=dispatched)
            if relative == "$metadata":
                return raw, response
            if not raw:
                return {}, response
            try:
                data = json.loads(raw.decode("utf-8-sig"))
            except (UnicodeError, json.JSONDecodeError) as exc:
                raise TargetError("TARGET_JSON", "The native response is not complete JSON.",
                                  evidence=response, dispatched=dispatched) from exc
            return data, response
        except TargetError:
            raise
        except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
            evidence = {"method": method, "url": url, "started_at": started, "finished_at": utcnow(),
                        "complete": False, "error_type": type(exc).__name__}
            self.observe(evidence)
            raise TargetError("TARGET_TRANSPORT", "The native connection ended before a complete response.",
                              evidence=evidence, dispatched=dispatched) from exc
        finally:
            conn.close()
            token = ""

    def get(self, relative, *, allow_not_found=False):
        return self.request("GET", relative, allow_not_found=allow_not_found)[0]

    def collection(self, relative, *, limit=250000):
        values, seen, pages = [], set(), []
        while relative:
            if relative in seen:
                raise TargetError("TARGET_PAGINATION", "The native collection repeated a page.")
            seen.add(relative)
            page, evidence = self.request("GET", relative)
            if not isinstance(page, dict) or not isinstance(page.get("value"), list):
                raise TargetError("TARGET_COLLECTION", "Expected a complete native collection page.")
            values.extend(page["value"])
            pages.append({"sha256": evidence["sha256"], "url": evidence["url"], "count": len(page["value"])})
            if len(values) > limit:
                raise TargetError("TARGET_COLLECTION_LIMIT", "The native collection exceeds the selected limit.")
            relative = page.get("@odata.nextLink")
            if relative is not None and not isinstance(relative, str):
                raise TargetError("TARGET_PAGINATION", "Invalid native continuation link.")
        return {"value": values, "pages": pages, "complete": True}

    def action(self, action, parameters, *, before_dispatch=None):
        if self.metadata is None or action not in ACTIONS or set(parameters) != set(ACTIONS[action]):
            raise TargetError("TARGET_ACTION", "Use the probed original scheduling action contract.")
        if action in ("msdyn_CreateProjectV1", "msdyn_CreateTeamMemberV1"):
            self.metadata.validate_entity(next(iter(parameters.values())))
        if "Entity" in parameters:
            self.metadata.validate_entity(parameters["Entity"])
        for key in ("OperationSetId", "ProjectId", "RecordId", "ResourceAssignmentId"):
            if key in parameters:
                guid(parameters[key])
        if action == "msdyn_PssUpdateResourceAssignmentContourV1":
            try:
                contours = json.loads(parameters["UpdatedContours"])
            except (TypeError, json.JSONDecodeError) as exc:
                raise TargetError("TARGET_CONTOURS", "Contours must use the native serialized JSON value.") from exc
            if not isinstance(contours, list) or len(contours) > 100:
                raise TargetError("TARGET_CONTOURS", "A native contour update accepts at most 100 slices.")
        return self.request("POST", action, parameters, before_dispatch=before_dispatch)[0]

    def probe(self):
        identity = self.get("WhoAmI")
        if guid(identity.get("UserId")) != self.profile["user_id"] or guid(identity.get("OrganizationId")) != self.profile["organization_id"]:
            raise TargetError("TARGET_IDENTITY", "The delegated user or organization differs from the selected target.")
        xml, xml_receipt = self.request("GET", "$metadata")
        self.metadata = Metadata(xml)
        m = self.metadata
        user = self.record("systemuser", self.profile["user_id"])
        disabled = m.field("systemuser", "isdisabled")
        app = m.field("systemuser", "applicationid")
        if not user or user.get(disabled) is not False or user.get(app):
            raise TargetError("TARGET_USER_KIND", "Scheduling requires the selected active delegated Project user.")
        status_field = m.field("msdyn_operationset", "msdyn_status")
        choices = self.get("EntityDefinitions(LogicalName='msdyn_operationset')/Attributes(LogicalName='" +
                           status_field + "')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet")
        options = choices.get("OptionSet", {}).get("Options")
        if not isinstance(options, list) or not options:
            raise TargetError("TARGET_STATUS_METADATA", "Native OperationSet status choices are required.")
        selected = self.profile.get("status_semantics", {})
        semantics = {}
        for role in ("completed", "failed", "abandoned"):
            explicit = selected.get(role)
            if explicit is not None:
                candidates = [o for o in options if o.get("Value") == explicit]
            else:
                candidates = []
                for option in options:
                    labels = option.get("Label", {}).get("LocalizedLabels", [])
                    if any(str(label.get("Label", "")).strip().casefold() == role for label in labels):
                        candidates.append(option)
            if len(candidates) == 1:
                semantics[role] = candidates[0]["Value"]
        if "completed" not in semantics or len(set(semantics.values())) != len(semantics):
            raise TargetError("TARGET_STATUS_SELECTION",
                              "Select the actual completed status from the returned native choices.",
                              evidence={"choices": options, "selected": selected})
        actor = {key: user.get(m.field("systemuser", key)) for key in
                 ("systemuserid", "isdisabled", "applicationid", "azureactivedirectoryobjectid")}
        link_field = m.field("msdyn_projecttaskdependency", "msdyn_linktype")
        link_choices = self.get("EntityDefinitions(LogicalName='msdyn_projecttaskdependency')/Attributes(LogicalName='" +
            link_field + "')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet")
        link_options = link_choices.get("OptionSet", {}).get("Options")
        if not isinstance(link_options, list) or not link_options:
            raise TargetError("TARGET_LINK_METADATA", "The actual dependency link-type choices are required.")
        result = {"schema": "portfolio.target-probe.v1", "captured_at": utcnow(),
                  "profile": public_profile(self.profile), "identity": identity,
                  "user": actor, "metadata": m.summary(), "metadata_response_sha256": xml_receipt["sha256"],
                  "status_choices": options, "status_semantics": semantics, "link_type_choices": link_options}
        result["sha256"] = digest(result)
        return result

    def record(self, entity, record_id):
        if self.metadata is None:
            raise TargetError("TARGET_METADATA_REQUIRED", "Probe the selected native target first.")
        return self.get(self.metadata.entity(entity)["set"] + "(" + guid(record_id) + ")",
                        allow_not_found=True)

    def operation_sets(self, project_id, *, description=None):
        m = self.metadata
        field = m.lookup("msdyn_operationset", "msdyn_project")
        expression = field + " eq " + guid(project_id)
        if description is not None:
            expression += " and " + m.field("msdyn_operationset", "msdyn_description") + " eq " + odata_string(description)
        return self.collection(m.entity("msdyn_operationset")["set"] + "?" +
                               urlencode({"$filter": expression}))

    def operation_details(self, operation_set_id):
        m = self.metadata
        return self.collection(m.entity("msdyn_operationsetdetail")["set"] + "?" + urlencode({
            "$filter": m.lookup("msdyn_operationsetdetail", "msdyn_operationset") + " eq " + guid(operation_set_id),
            "$orderby": m.field("msdyn_operationsetdetail", "msdyn_requestnumber") + " asc",
        }))

    def project_errors(self, project_id):
        m = self.metadata
        return self.collection(m.entity("msdyn_psserrorlog")["set"] + "?" + urlencode({
            "$filter": m.lookup("msdyn_psserrorlog", "msdyn_project") + " eq " + guid(project_id),
        }))


def operation_response(value, expected_set, expected_record=None):
    """Decode the provider's documented serialized OperationSetResponse field."""
    raw = value.get("OperationSetResponse") if isinstance(value, dict) else None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise TargetError("OPERATION_RESPONSE", "Incomplete native OperationSetResponse.") from exc
    if not isinstance(raw, dict):
        raise TargetError("OPERATION_RESPONSE", "The native response omitted OperationSetResponse.")
    if guid(raw.get("operationSetId")) != guid(expected_set):
        raise TargetError("OPERATION_RESPONSE_ID", "The response names another native OperationSet.")
    if expected_record is not None and guid(raw.get("recordId")) != guid(expected_record):
        raise TargetError("OPERATION_RESPONSE_RECORD", "The response names another native record.")
    guid(raw.get("operationSetDetailId"))
    return raw
