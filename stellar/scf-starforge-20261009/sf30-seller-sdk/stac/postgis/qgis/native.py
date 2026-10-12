# SPDX-License-Identifier: MIT
"""Native PostgreSQL provider binding for the original QGIS receiving engine.

Only SELECT statements and QgsVectorLayer's ordinary provider are used here.
The selected libpq service and QGIS authentication references remain external.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from ..model import QgisReceivingError, require, utc_now, value_sha
from .source import connection_profile, normalize_layer

def core():
    from ..qgis_project import native
    return native()

def qi(value):
    return '"' + value.replace('"', '""') + '"'

def ql(value):
    return "'" + str(value).replace("'", "''") + "'"

def relation(schema, name):
    return qi(schema) + "." + qi(name)

def boolean(value):
    return value is True or value in ("t", "true", "1", 1)

def type_name(value):
    value = re.sub(r"\s+", " ", str(value).strip().lower())
    for pattern, replacement in ((r"^int8$", "bigint"), (r"^(int|int4)$", "integer"),
        (r"^int2$", "smallint"), (r"^bool$", "boolean"), (r"^float8$", "double precision"),
        (r"^float4$", "real"), (r"^decimal(?=\(|$)", "numeric"),
        (r"^varchar(?=\(|$)", "character varying"), (r"^timestamptz$", "timestamp with time zone"),
        (r"^timestamp$", "timestamp without time zone"), (r"^char(?=\(|$)", "character")):
        value = re.sub(pattern, replacement, value)
    return re.sub(r"\s*,\s*", ",", value)

@dataclass
class DatabaseBinding:
    workspace: object
    source: object
    definition: dict

    @property
    def layer(self):
        return self.source.layers[self.definition["postgis"]["layerId"]]

    @property
    def profile(self):
        return self.definition["postgis"]["connection"]

def binding(workspace, definition):
    source = workspace.source(definition["sourceId"])
    normalized = normalize_layer(source, definition)
    return DatabaseBinding(workspace, source, normalized)

def uri_for(selected, *, subset=True, geometry_type=None):
    q = core()
    p, layer = selected.profile, selected.layer
    uri = q.QgsDataSourceUri()
    # The service supplies its own database and user. Never override these with a
    # package credential or silently switch the effective PostgreSQL role.
    uri.setConnection(p["service"], "", "", "",
                      q.QgsDataSourceUri.decodeSslMode(p["sslMode"]), p["authConfigId"])
    uri.setDataSource(layer["schema"], layer["relation"], layer["geometryColumn"],
                      selected.definition.get("vectorSubsetString", "") if subset else "", layer["keyColumn"])
    uri.setSrid(str(layer["srid"]))
    uri.setUseEstimatedMetadata(False)
    if geometry_type:
        value = q.QgsWkbTypes.parseType(geometry_type)
        if value != q.Qgis.WkbType.Unknown:
            uri.setWkbType(value)
    return uri

def _query(connection, sql, *, maximum=10000):
    try:
        result = connection.executeSql(sql)
    except Exception:
        # Native exception messages can include an expanded authentication URI.
        raise QgisReceivingError("POSTGIS_NATIVE_READ",
            "The selected native PostgreSQL service could not complete this read. Inspect its local connection and role grants.") from None
    require(isinstance(result, list) and len(result) <= maximum,
            "POSTGIS_READ_BOUND", "The native metadata read exceeded its declared boundary.")
    return result

def _connection(selected):
    q = core()
    try:
        metadata = q.QgsProviderRegistry.instance().providerMetadata("postgres")
        require(metadata is not None, "POSTGIS_PROVIDER", "Install QGIS's native PostgreSQL provider.")
        result = metadata.createConnection(uri_for(selected).connectionInfo(False), {})
        require(result is not None, "POSTGIS_PROVIDER", "The native PostgreSQL connection is unavailable.")
        return result
    except QgisReceivingError:
        raise
    except Exception:
        raise QgisReceivingError("POSTGIS_CONNECTION",
            "Open the selected libpq service or local QGIS authentication configuration before native receiving.") from None

def _current(selected, connection):
    r, p = selected.source.manifest, selected.profile
    table = relation(r["database"]["schema"], "_sf_intake_projects")
    rows = _query(connection,
        "SELECT current_database()::text,current_user::text,p.project_id::text,p.revision::text,"
        "p.active_edition_id::text,current_setting('server_version_num')::text,n.nspname::text,e.extversion::text "
        "FROM " + table + " p CROSS JOIN pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace "
        "WHERE e.extname='postgis' AND p.project_id=" + ql(r["projectId"]), maximum=2)
    require(len(rows) == 1 and len(rows[0]) == 8, "POSTGIS_PROJECT_NOT_VISIBLE",
            "The selected role must read exactly the accepted project row.")
    db, role, project, revision, edition, server, extension_schema, extension_version = map(str, rows[0])
    require(db == r["database"]["name"] and role == p["role"],
            "POSTGIS_CONNECTION_IDENTITY", "The actual service database or effective role differs from the explicit receiving profile.",
            expectedDatabase=r["database"]["name"], observedDatabase=db,
            expectedRole=p["role"], observedRole=role)
    require(project == r["projectId"] and revision == str(r["revision"]) and edition == r["editionId"],
            "POSTGIS_STALE_RECEIPT",
            "The database has a different accepted edition. Import its actual new receipt and review each selected layer before refresh.",
            receipt={"projectId":r["projectId"],"revision":str(r["revision"]),"editionId":r["editionId"]},
            observed={"projectId":project,"revision":revision,"editionId":edition})
    require(server.isdigit() and int(server) >= 150000, "POSTGIS_SERVER_VERSION",
            "Security-invoker receiving requires PostgreSQL 15 or later.")
    require(extension_version.startswith("3."), "POSTGIS_EXTENSION_VERSION", "Use the accepted PostGIS 3.x provider.")
    return {"database":db,"role":role,"projectId":project,"revision":revision,
            "editionId":edition,"serverVersionNumber":server,"postgisSchema":extension_schema,"postgisVersion":extension_version}

def _catalogue(selected, connection, current):
    l = selected.layer
    name = relation(l["schema"], l["relation"])
    oid = ql(name) + "::regclass"
    extension = qi(current["postgisSchema"]) + "."
    require(isinstance(l.get("physicalRelation"),str) and isinstance(l.get("observedColumns"),list) and
            isinstance(l.get("viewDefinitionSha256"),str) and re.fullmatch(r"[0-9a-f]{64}",l["viewDefinitionSha256"]),
            "POSTGIS_ACCEPTED_BINDING_REQUIRED", "Export the complete current receiving receipt with its actual physical relation and view-definition digest.")
    rows = _query(connection,
        "SELECT c.relkind::text,COALESCE(array_to_string(c.reloptions,','),''),"
        "has_schema_privilege(current_user," + ql(l["schema"]) + ",'USAGE')::text,"
        "has_table_privilege(current_user," + oid + ",'SELECT')::text,"
        "has_any_column_privilege(current_user," + oid + ",'INSERT')::text,"
        "has_any_column_privilege(current_user," + oid + ",'UPDATE')::text,"
        "has_table_privilege(current_user," + oid + ",'DELETE')::text "
        "FROM pg_class c WHERE c.oid=" + oid, maximum=1)
    require(len(rows) == 1 and rows[0][0] == "v" and
            "security_invoker=true" in str(rows[0][1]).split(",") and boolean(rows[0][2]),
            "POSTGIS_NATIVE_VIEW", "The accepted relation must remain a security-invoker view in the accessible schema.")
    privileges = dict(zip(("select","insert","update","delete"), map(boolean, rows[0][3:])))
    role = next(x for x in l["roles"] if x["name"] == selected.profile["role"])
    require(isinstance(role.get("visibleRowSha256"),str) and re.fullmatch(r"[0-9a-f]{64}",role["visibleRowSha256"]),
            "POSTGIS_ACCEPTED_ROLE_DIGEST_REQUIRED", "Keep the complete accepted role-visible row digest.")
    require(privileges == role["observedPrivileges"] and privileges["select"],
            "POSTGIS_ROLE_PRIVILEGES_CHANGED",
            "The current selected-role privileges differ from the accepted role profile.", observed=privileges,
            expected=role["observedPrivileges"])
    settings = "pg_catalog," + qi(current["postgisSchema"]) + "," + qi(l["schema"])
    view_definition = _query(connection,
        "WITH cfg AS MATERIALIZED (SELECT set_config('search_path'," + ql(settings) + ",true) AS path) "
        "SELECT pg_get_viewdef(c.oid,true) FROM pg_class c CROSS JOIN cfg WHERE c.oid=" + oid +
        " AND cfg.path IS NOT NULL", maximum=1)
    require(len(view_definition)==1 and hashlib.sha256(str(view_definition[0][0]).encode("utf-8")).hexdigest()==l["viewDefinitionSha256"],
            "POSTGIS_VIEW_DEFINITION_CHANGED", "The native view definition differs from the accepted original.")
    columns = _query(connection,
        "WITH cfg AS MATERIALIZED (SELECT set_config('search_path'," + ql(settings) + ",true) AS path) "
        "SELECT a.attname,format_type(a.atttypid,a.atttypmod) "
        "FROM pg_attribute a CROSS JOIN cfg WHERE a.attrelid=" + oid +
        " AND a.attnum>0 AND NOT a.attisdropped AND cfg.path IS NOT NULL ORDER BY a.attnum")
    expected = [("sf_id","bigint"),("sf_key","text")] + [(f["name"],f["type"]) for f in l["fields"]]
    require([str(r[0]) for r in columns] == [x[0] for x in expected]+["geom"],
            "POSTGIS_COLUMNS_CHANGED", "The actual stable view columns or their order changed.")
    require(all(type_name(row[1]) == type_name(wanted[1]) for row,wanted in zip(columns,expected)),
            "POSTGIS_COLUMN_TYPES_CHANGED", "The actual field types differ from the retained typed mapping.")
    if l.get("observedColumns") is not None:
        observed = [{"attname":str(row[0]),"type":str(row[1])} for row in columns]
        require(observed == l["observedColumns"], "POSTGIS_ACCEPTED_COLUMNS_CHANGED",
                "The actual native column readback differs from the producer's accepted observation.")
    geometry = _query(connection,
        "SELECT "+extension+"postgis_typmod_type(a.atttypmod),"+extension+"postgis_typmod_dims(a.atttypmod)::text,"
        +extension+"postgis_typmod_srid(a.atttypmod)::text FROM pg_attribute a "
        "WHERE a.attrelid=" + oid + " AND a.attname='geom' AND NOT a.attisdropped", maximum=1)
    require(len(geometry) == 1, "POSTGIS_GEOMETRY_COLUMN", "The typed geometry column is unavailable.")
    geometry_type, dimension, srid = map(str,geometry[0])
    base_type = re.sub(r"(ZM|Z|M)$","",geometry_type.upper())
    require(base_type == l["geometryType"] and dimension == str(l["dimension"]) and srid == str(l["srid"]),
            "POSTGIS_GEOMETRY_CHANGED", "The native geometry type, dimension or SRID differs from the receipt.")
    dependencies = _query(connection,
        "SELECT DISTINCT n.nspname,c.relname,c.relrowsecurity::text "
        "FROM pg_rewrite r JOIN pg_depend d ON d.objid=r.oid "
        "JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE r.ev_class=" + oid + " AND d.refclassid='pg_class'::regclass AND c.relkind IN ('r','p','f')",
        maximum=2)
    require(len(dependencies) == 1 and dependencies[0][0] == l["schema"],
            "POSTGIS_VIEW_DEPENDENCY", "The accepted view must resolve to one retained physical edition in its original schema.")
    if l.get("physicalRelation") is not None:
        require(dependencies[0][1] == l["physicalRelation"], "POSTGIS_PHYSICAL_EDITION_CHANGED",
                "The stable view points to a different physical edition than its accepted receipt.")
    scope = role.get("scope")
    if scope:
        require(isinstance(scope,dict) and isinstance(scope.get("values"),list) and
                scope.get("column") in {f["name"] for f in l["fields"]},
                "POSTGIS_SCOPE", "Retain the explicit mapped-column role scope.")
        current_role = _query(connection, "SELECT rolsuper::text,rolbypassrls::text FROM pg_roles WHERE rolname=current_user",maximum=1)
        require(len(current_role)==1 and not any(boolean(v) for v in current_role[0]) and boolean(dependencies[0][2]),
                "POSTGIS_ROW_SECURITY", "A scoped role must not bypass the physical edition's row security.")
        condition = qi(scope["column"]) + "::text = ANY(ARRAY[" + ",".join(ql(x) for x in scope["values"]) + "]::text[])"
        outside = _query(connection,"SELECT count(*)::text FROM "+name+
                         " WHERE NOT COALESCE(("+condition+"),false)",maximum=1)
        require(outside == [["0"]], "POSTGIS_ROW_SCOPE_CHANGED",
                "The actual role can see rows outside its declared receiving scope.")
    return {"relation":name,"privileges":privileges,
            "columns":[{"name":str(x[0]),"type":str(x[1])} for x in columns],
            "geometryType":geometry_type,"dimension":dimension,"srid":srid,
            "physicalRelation":{"schema":str(dependencies[0][0]),"name":str(dependencies[0][1])}}

def preflight(selected):
    connection = _connection(selected)
    current = _current(selected, connection)
    catalogue = _catalogue(selected, connection, current)
    require(_current(selected,connection)==current, "POSTGIS_EDITION_CHANGED_DURING_READ",
            "The database edition changed during native inspection. Continue with its actual new receipt.")
    return connection, {"checkedAt":utc_now(),"sourceId":selected.source.id,
        "layerId":selected.layer["id"],"connection":copy.deepcopy(selected.profile),
        "current":current,"catalogue":catalogue}

def _safe_uri_matches(layer, selected, *, subset=True):
    q = core()
    require(isinstance(layer,q.QgsVectorLayer) and layer.providerType()=="postgres",
            "POSTGIS_NATIVE_PROVIDER", "The selected map layer must use the original native PostgreSQL provider.")
    actual = q.QgsDataSourceUri(layer.source())
    expected = uri_for(selected,geometry_type=q.QgsWkbTypes.displayString(layer.wkbType()))
    require(not actual.password() and not actual.username() and not actual.host() and not actual.port() and
            actual.service()==selected.profile["service"] and actual.authConfigId()==selected.profile["authConfigId"] and
            actual.database()==expected.database() and actual.schema()==selected.layer["schema"] and
            actual.table()==selected.layer["relation"] and actual.keyColumn()==selected.layer["keyColumn"] and
            actual.geometryColumn()==selected.layer["geometryColumn"] and
            q.QgsDataSourceUri.encodeSslMode(actual.sslMode())==selected.profile["sslMode"],
            "POSTGIS_NATIVE_CONNECTION_CHANGED",
            "The saved map must contain only the selected service/auth references and accepted relation; expanded credentials are not retained.")
    if subset:
        require(layer.subsetString()==selected.definition.get("vectorSubsetString",""),
                "POSTGIS_NATIVE_SUBSET_CHANGED", "The native subset differs from the retained analyst choice.")
    # Compare the complete parsed URI as well: no extra host, SQL, auth option,
    # or provider parameter is silently accepted.
    actual.setSql("")
    expected.setSql("")
    require(actual.uri(False)==expected.uri(False), "POSTGIS_NATIVE_URI_CHANGED",
            "The native database URI contains options outside the retained connection/layer selection.")

def verify_layer(layer, selected, *, subset=True):
    q = core()
    _safe_uri_matches(layer,selected,subset=subset)
    require(layer.isValid() and layer.crs().isValid() and
            layer.crs().postgisSrid()==selected.layer["srid"],
            "POSTGIS_NATIVE_CRS", "The native layer CRS differs from the accepted database SRID.")
    names = [f.name() for f in layer.fields()]
    key = layer.fields().indexFromName("sf_id")
    require(key>=0 and list(layer.dataProvider().pkAttributeIndexes())==[key],
            "POSTGIS_NATIVE_KEY", "QGIS must use the retained signed bigint sf_id feature key.")
    require(names == ["sf_id","sf_key"]+[x["name"] for x in selected.layer["fields"]],
            "POSTGIS_NATIVE_FIELDS", "QGIS fields differ from the accepted stable column mapping.")
    connection, result = preflight(selected)
    # The original editing tools still enforce database privileges; additionally
    # respect the operator's explicit read-only choice in this receiving project.
    writable = selected.profile["allowEditing"] and any(result["catalogue"]["privileges"][p] for p in ("insert","update","delete"))
    require(not (layer.isEditable() and not writable), "POSTGIS_UNCOMMITTED_EDITS",
            "Resolve the original native edit buffer before changing this layer to read-only.")
    layer.setReadOnly(not writable)
    form = layer.editFormConfig()
    for name in ("sf_id", "sf_key"):
        form.setReadOnly(layer.fields().indexFromName(name), True)
    layer.setEditFormConfig(form)
    result["editingEnabled"]=writable
    result["nativeFeatureCount"]=str(layer.featureCount())
    result["nativeGeometry"]=q.QgsWkbTypes.displayString(layer.wkbType())
    result["subset"]=layer.subsetString()
    layer.setCustomProperty("starforge/postgisReadback",json.dumps(result,ensure_ascii=False,separators=(",",":")))
    return result

def create_layer(selected):
    q = core()
    _, observation = preflight(selected)
    uri = uri_for(selected,geometry_type=observation["catalogue"]["geometryType"])
    layer = q.QgsVectorLayer(uri.uri(False),selected.definition["label"],"postgres")
    require(layer.isValid(), "POSTGIS_LAYER_OPEN", "The native PostgreSQL provider could not open this accepted relation.")
    verify_layer(layer,selected)
    return layer

def xml_binding(node, selected):
    """Validate QGZ XML before or after native reopen; never allow credentials."""
    q=core()
    value=node.findtext("datasource") or ""
    require(node.findtext("provider")=="postgres","POSTGIS_PROJECT_PROVIDER",
            "The saved database layer must retain the PostgreSQL provider.")
    actual=q.QgsDataSourceUri(value)
    expected=uri_for(selected,geometry_type=q.QgsWkbTypes.displayString(actual.wkbType()))
    require(not actual.password() and not actual.username() and not actual.host() and not actual.port(),
            "POSTGIS_PROJECT_CREDENTIALS", "Remove expanded credentials from the project; select a local service/auth reference.")
    require(actual.uri(False)==expected.uri(False), "POSTGIS_PROJECT_BINDING",
            "The saved database connection, filter or native relation differs from its original layer definition.")

def _stream_rows(selected,connection,current,progress=None):
    l=selected.layer
    extension=qi(current["postgisSchema"])+"."
    sql=("WITH cfg AS MATERIALIZED (SELECT set_config('TimeZone','UTC',true) AS tz, "
        "set_config('DateStyle','ISO, YMD',true) AS dates) "
        "SELECT sf_id::text,sf_key,encode(sha256(convert_to((to_jsonb(t)-ARRAY['sf_id','sf_key','_sf_source','geom'])::text || '|' || "+
        "COALESCE(encode("+extension+"ST_AsEWKB(t.geom),'hex'),'null'),'UTF8')),'hex') AS row_hash FROM "+
        relation(l["schema"],l["relation"])+' t CROSS JOIN cfg WHERE cfg.tz IS NOT NULL AND cfg.dates IS NOT NULL ORDER BY sf_key COLLATE "C"')
    try:
        rows=connection.execSql(sql)
        digest=hashlib.sha256(); count=0; samples=[]; last=[]; prior_key=None
        while rows.hasNextRow():
            values=rows.nextRow()
            require(len(values)==3 and all(isinstance(v,str) for v in values),
                    "POSTGIS_NATIVE_ROW", "The native role row readback did not preserve its exact text fields.")
            identifier,key,row_hash=values
            require(re.fullmatch(r"-?(0|[1-9][0-9]*)",identifier) and
                    -(2**63)<int(identifier)<2**63 and re.fullmatch(r"[0-9a-f]{64}",row_hash),
                    "POSTGIS_NATIVE_ROW_ID", "Retain native signed feature IDs and exact logical row hashes.")
            require(prior_key is None or key!=prior_key,"POSTGIS_NATIVE_SOURCE_KEY","The actual source key is not unique.")
            prior_key=key
            raw=json.dumps({"sf_id":identifier,"sf_key":key,"row_hash":row_hash},
                           ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n"
            digest.update(raw.encode("utf-8")); count+=1
            if len(samples)<8 or abs(int(identifier))>2**53 and len(samples)<16:
                samples.append({"sf_id":identifier,"sf_key":key})
            last=(last+[{"sf_id":identifier,"sf_key":key}])[-8:]
            if progress and count%256==0:
                progress({"phase":"postgis-role-read","completedRows":str(count),"layerId":l["id"]})
        return {"rowCount":str(count),"rowSha256":digest.hexdigest(),"readAt":utc_now(),
                "keySamples":list({x["sf_id"]:x for x in samples+last}.values())}
    except QgisReceivingError:
        raise
    except Exception:
        raise QgisReceivingError("POSTGIS_ROLE_READ",
            "The native role read was interrupted. Preserve the original receiving operation and check the local service.") from None

def inspect_layer(selected, *, progress=None):
    q=core()
    connection, report=preflight(selected)
    readback=_stream_rows(selected,connection,report["current"],progress)
    layer=create_layer(selected)
    # Probe the actual QGIS feature-ID lookup, including large and signed IDs
    # observed in the complete native role stream. No feature values are cast.
    samples=readback["keySamples"]; expected={int(x["sf_id"]):x["sf_key"] for x in samples}
    request=q.QgsFeatureRequest().setFilterFids(list(expected)).setSubsetOfAttributes(
        [layer.fields().indexFromName("sf_id"),layer.fields().indexFromName("sf_key")])
    actual={}
    for feature in layer.getFeatures(request):
        identifier=feature["sf_id"]
        require(type(identifier) is int and feature.id()==identifier and identifier in expected,
                "POSTGIS_QGIS_FEATURE_ID","The native QGIS feature ID differs from its original bigint value.")
        actual[identifier]=str(feature["sf_key"])
    require(actual==expected,"POSTGIS_QGIS_FEATURE_LOOKUP","The native feature-ID lookup did not reopen every selected original sample.")
    require(_current(selected,connection)==report["current"],"POSTGIS_EDITION_CHANGED_DURING_READ",
            "The accepted database edition changed during native role receiving.")
    role=next(x for x in selected.layer["roles"] if x["name"]==selected.profile["role"])
    report.update({"native":verify_layer(layer,selected),"visible":readback,
        "acceptedVisibleRows":role["visibleRows"],"acceptedVisibleRowSha256":role.get("visibleRowSha256"),
        "changedSinceReceipt":readback["rowCount"]!=role["visibleRows"] or
            (role.get("visibleRowSha256") is not None and readback["rowSha256"]!=role["visibleRowSha256"]),
        "contentObservation":"A stable accepted edition can contain later authorized operator edits. Current role bytes and the original receipt remain separately recorded.",
        "featureIdSamplesVerified":len(actual)})
    return report

def record_check(workspace,source_id,layer_ids,profile,*,revision,request_id,actor,progress=None):
    selected=workspace.source(source_id)
    require(selected.sourceKind=="postgis" and isinstance(layer_ids,list) and layer_ids and
            len(layer_ids)==len(set(layer_ids)), "POSTGIS_LAYER_SELECTION", "Select unique accepted relations to inspect.")
    profile=connection_profile(profile,selected.manifest)
    payload={"sourceId":source_id,"layerIds":layer_ids,"connection":profile}
    prior=workspace.operation(request_id,"postgis.checked",payload)
    if prior:return prior
    require(workspace.read()["revision"]==revision,"REVISION_CHANGED","Refresh the original workspace before native inspection.")
    observations=[]
    for name in layer_ids:
        definition=selected.layer_definition(name,profile)
        observations.append(inspect_layer(binding(workspace,definition),progress=progress))
    report={"id":"postgis-check-"+request_id,"sourceId":source_id,"at":utc_now(),"actor":actor,
            "layers":observations}
    def update(state):
        state.setdefault("postgisChecks",[]).append(copy.deepcopy(report))
        return {"report":copy.deepcopy(report)}
    return workspace._mutate(revision,request_id,actor,"postgis.checked",payload,update)

def refresh_project(workspace,project,*,progress=None):
    state=workspace.read()
    definitions={x["id"]:x for x in state["layers"] if x.get("postgis")}
    selected=[x for x in project.mapLayers().values()
              if x.customProperty("starforge/workspaceId")==state["id"] and
              x.customProperty("starforge/layerId") in definitions]
    require(len(selected)==len(definitions) and definitions,"POSTGIS_MANAGED_LAYERS",
            "Apply the current retained database layers to QGIS before refresh.")
    require(not any(x.isEditable() for x in selected),"POSTGIS_UNCOMMITTED_EDITS",
            "Commit or roll back the original native edits before refreshing these layers.")
    # Check every original binding before reloading any layer.
    bound=[(layer,binding(workspace,definitions[layer.customProperty("starforge/layerId")])) for layer in selected]
    for layer,item in bound:
        require(layer.customProperty("starforge/sourceId")==item.source.id,"POSTGIS_MAP_SOURCE",
                "Apply the explicitly reviewed successor selection before refresh.")
        verify_layer(layer,item)
    result=[]
    for layer,item in bound:
        layer.reload();layer.triggerRepaint()
        result.append({"layerId":item.definition["id"],"readback":verify_layer(layer,item)})
    return {"workspaceId":state["id"],"revision":state["revision"],"layers":result}


def save_selection(workspace,definitions,*,revision,request_id,actor):
    prior=workspace.operation(request_id,"layers.saved",{"layers":definitions})
    if prior:return prior
    require(workspace.read()["revision"]==revision,"REVISION_CHANGED","Refresh the original layer list before binding a database service.")
    normalized=workspace.normalize_layers(definitions)
    for definition in normalized:
        if definition.get("postgis"):
            preflight(binding(workspace,definition))
    return workspace.save_layers(definitions,revision=revision,request_id=request_id,actor=actor)

def guard_edit_buffers(workspace,project):
    owned=[layer for layer in project.mapLayers().values()
           if layer.customProperty("starforge/workspaceId")==workspace.read()["id"] and layer.providerType()=="postgres"]
    require(not any(layer.isEditable() for layer in owned),"POSTGIS_UNCOMMITTED_EDITS",
            "Commit or roll back the original database edit buffers before replacing the managed layer selection.")


def preflight_project(workspace,filename,definitions):
    """Bind every database URI before QgsProject.read can open a connection."""
    q=core()
    from ..qgis_project import expected_layer_path,_expected_native_uri,_uri_binding
    with zipfile.ZipFile(filename) as archive:
        names=[name for name in archive.namelist() if name.endswith(".qgs")]
        require(len(names)==1 and archive.getinfo(names[0]).file_size<=67108864,
                "POSTGIS_PROJECT_XML","Use one complete native QGZ project with bounded XML.")
        xml=ET.fromstring(archive.read(names[0]))
    by_id={row["id"]:row for row in definitions}; seen=set(); checks=[]
    for node in xml.findall(".//projectlayers/maplayer"):
        properties={}
        for element in node.findall(".//customproperties//*"):
            name=element.get("name") or element.get("key")
            if name in ("starforge/layerId","starforge/sourceId"):
                require(name not in properties,"POSTGIS_PROJECT_IDENTITY","The native map repeats an original layer property.")
                properties[name]=element.get("value")
        identifier=properties.get("starforge/layerId")
        require(identifier in by_id and identifier not in seen,"POSTGIS_PROJECT_LAYER_CLOSURE",
                "The native map contains an unselected or duplicate layer.")
        seen.add(identifier); definition=by_id[identifier]
        require(properties.get("starforge/sourceId")==definition["sourceId"],"POSTGIS_PROJECT_SOURCE",
                "The native map changed a retained layer's source edition.")
        if definition.get("postgis"):
            selected=binding(workspace,definition)
            xml_binding(node,selected)
            checks.append(selected)
        else:
            expected,_=expected_layer_path(workspace,definition)
            provider,expected_uri=_expected_native_uri(expected,definition)
            require(node.findtext("provider")==provider,"NATIVE_PROJECT_PROVIDER","The native file provider differs from its retained source.")
            uri=node.findtext("datasource") or ""
            require(uri.startswith(("./","../")),"NATIVE_RELATIVE_PATHS","Retained file layers must use portable relative paths.")
            decoded=dict(q.QgsProviderRegistry.instance().decodeUri(provider,uri))
            candidate=decoded.get("path") or decoded.get("fileName") or uri.split("|",1)[0]
            resolved=Path(q.QgsPathResolver(str(filename)).readPath(candidate)).absolute().resolve()
            require(resolved==expected.resolve(),"NATIVE_PROJECT_SOURCE","The project XML names a different retained file.")
            decoded["path"]=str(resolved);decoded.pop("fileName",None)
            compared={key:value for key,value in decoded.items()
                      if value not in ("",None,[],{}) and key.lower() not in ("subset","subsetstring")}
            require(compared==_uri_binding(provider,expected_uri),"NATIVE_SUBLAYER_CHANGED",
                    "The native project XML changed the selected file or sublayer.")
    require(seen==set(by_id),"POSTGIS_PROJECT_LAYER_CLOSURE","The native project omits an original selected layer.")
    for selected in checks:
        preflight(selected)
