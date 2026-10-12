# QWC publication acceptance: original source contracts

Source review: 2026-10-12. This handoff supports the existing Sourcepole publication and acceptance work. The examples below illustrate the documented ABI; they are not observations from a customer deployment. The original publisher supplies the selected edition, tenant, role context and deployed service URLs.

## Source selection

| Original project | Reviewed reference | Relevant full source |
| --- | --- | --- |
| qwc-services/qwc-ogc-service | 62cf733a278dbc02137bf570eba15ae5afe2730e | src/server.py 72edd9ce428fd24e4666c9b88bdd88f4595aabef; src/ogc_service.py f5460732d15e0edd9d5b28bc833f972513024688; src/wms_handler.py 75a086dcef237c2fdac47e960f852f6e718d6c2e; schemas/qwc-ogc-service.json d19037d98ce8a50f136e90438108313689f6e719 |
| qwc-services/qwc-config-generator | 01721f84b4f5478fd4c0283ba7f14b646ed24adb | schemas/qwc-config-generator.json 0c945f79495000b19be5352dae2dc89c4dcf00c3; src/config_generator/permissions_config.py 4b64d339635e22eed4f32902f82986be90bad5d9; capabilities_reader.py 7b7f4f8ccf3687fe4ff42f8c7c4ced5f8171c12d |
| qwc-services/qwc-services-core | 02d18ad18142c2a428459511c4e8a11a82df3096 | schemas/qwc-services-permissions.json 90657676ed8e4ce02ccb8ec897ebb828e9355f5d; qwc_services_core/permissions_reader.py 2bc47b3707e221e42a8bae5f5f0b13d69c806163 |
| qwc-services/qwc-docker | 0ff5bc0f96568cd867024929ab26022e30a53c98 | api-gateway/nginx-example.conf ad42254f392f46209952d92982149119ada79a71; volumes/config-in/default/tenantConfig.json 1c1faa6553e079d7c3c2e3aee45984f104fbce02; themesConfig.json 79faadd3397fb0e7849a4ad771344dc9a2f35601 |
| QGIS/QGIS | final-3_40_0 | src/server/services/wms/qgswmsrenderer.cpp; actual extent inversion in lines803–809 |
| OGC WMS | 06-042, version1.3.0 | §7.2.4.6–8 and Tables6–7 |

The QWC master references are observed source selections, not a claim that a customer's installed release matches them. Read the installed publisher manifest first.

## Configuration inputs and outputs

The maintained generator accepts tenantConfig.json under INPUT_CONFIG_PATH/<tenant>. Its themesConfig property is either an embedded object or the relative filename of themesConfig.json. Generated service files and permissions.json go under OUTPUT_CONFIG_PATH/<tenant>. Its required config fields include tenant, default_qgis_server_url, config_db_url and qgis_projects_base_dir; services is an array of original service configurations. Preserve the existing ConfigDB and identity configuration.

A compact theme input using the actual official example shape is:

```json
{
  "defaultWMSVersion": "1.3.0",
  "defaultMapCrs": "EPSG:3857",
  "defaultTheme": "qwc_demo",
  "themes": {
    "items": [{
      "id": "qwc_demo",
      "title": "QWC Demo Theme",
      "url": "/ows/qwc_demo",
      "mapCrs": "EPSG:3857",
      "extent": [-1000000, 4000000, 3000000, 8000000],
      "printResolutions": [100, 300],
      "defaultPrintLayout": "A4 Landscape"
    }]
  }
}
```

The source generator combines original QGIS projects, WMS project settings and the ConfigDB; the acceptance component should compare that retained input/output edition. It need not create an alternative permission database. The original generator offers generate_configs, generate_configs_status and generate_configs_cancel; publication remains with the existing owner.

Generated ogcConfig.json has service:"ogc", config:{...}, resources:{wms_services:[...]}. Each WMS service contains name and nested root_layer, with optional wms_url, online_resources, print_url, print_templates and internal_print_layers. A nested group uses layers:[...]. Leaf attributes map original field names to display aliases.

## Existing roles and resource identities

Users and groups receive roles; the public role also applies to authenticated users. The permission source uses original field names and exact project/layout identifiers. A Map resource is the relative project path below qgs-resources without .qgs. A layer is its QGIS name or WMS short name; an attribute is the native field name; a print template is the layout name.

With permissions_default_allow=false, explicit map, layer and group permissions are required. The generator's defaults and original ConfigDB are the authority. layerTreeHiddenSublayers controls UI display and does not independently grant or revoke access.

The generated classic permissions ABI is:

```json
{
  "users": [{"name": "demo", "groups": ["demo"], "roles": []}],
  "groups": [{"name": "demo", "roles": ["demo"]}],
  "roles": [{
    "role": "public",
    "permissions": {
      "wms_services": [{
        "name": "qwc_demo",
        "layers": [
          {"name": "qwc_demo"},
          {"name": "countries", "attributes": ["name", "pop_est"], "queryable": true}
        ],
        "print_templates": ["A4 Landscape"]
      }]
    }
  }]
}
```

Here layers is a flat list of permitted layers, groups and internal print layers. Do not mistake it for ogcConfig's nested root_layer tree. Existing unified permissions are also supported by the original PermissionsReader; preserve whichever declared schema the actual installation uses.

Source schemas:
- https://github.com/qwc-services/qwc-services-core/blob/02d18ad18142c2a428459511c4e8a11a82df3096/schemas/qwc-services-permissions.json
- https://github.com/qwc-services/qwc-config-generator/blob/01721f84b4f5478fd4c0283ba7f14b646ed24adb/schemas/qwc-config-generator.json
- https://docs.qwc.app/master/configuration/ResourcesPermissions/

## Original proxy request and response behavior

The service's native route is /<path:service_name> under the existing gateway/tenant mount. The example deployment mounts /ows. /ows/api/ is service documentation, not the WMS project identifier. Preserve the publisher's actual URL; a nested project can be /ows/subfolder/project.

Illustrative requests, with parameters URL-encoded by the caller:

```text
/ows/qwc_demo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
/ows/qwc_demo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetProjectSettings
/ows/qwc_demo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=countries&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=720&HEIGHT=360&FORMAT=image/png
/ows/qwc_demo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=countries&QUERY_LAYERS=countries&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=720&HEIGHT=360&I=360&J=180&INFO_FORMAT=text/xml
```

The QWC proxy's current WmsHandler requires LAYERS and QUERY_LAYERS to be identical for GetFeatureInfo and permits text/plain, text/html and text/xml. Direct QGIS supports additional formats; do not infer that the proxy accepts application/json. Both GET and POST are routed through the existing identity and permission filters.

OGCService.service_exception produces HTTP200 with text/xml and a ServiceExceptionReport body. An unavailable service can return code ServiceNotSupported, a layer LayerNotDefined, and an unavailable print layout Error. Capture the complete body, parse exceptions and evaluate the actual outcome. HTTP200 alone does not establish a successful map, feature or print response. Conversely, transport/login failures retain their actual HTTP status and body.

The proxy forwards to the configured ogc_url; GetPrint and file-named map exports can use its configured print_url. Run acceptance through that selected proxy and existing role context, not an internal QGIS endpoint with different authorization.

## WMS layer inheritance

OGC1.3 rules are property-specific: CRS and styles accumulate; a child cannot redefine an inherited style name. Geographic bounds, scale limits and optional layer attributes inherit unless replaced. BoundingBox overrides are keyed by CRS, and Dimension overrides by name. queryable/opaque/noSubsets default false only when absent through ancestry; cascaded/fixed sizes default0. Names, titles, abstracts and identifiers are not inherited. Only a layer with its own Name is requestable. Keep direct declarations alongside resolved values so moving a declaration up the tree does not appear to remove a capability. Source: https://docs.ogc.org/is/06-042/06-042.pdf §7.2.4.6–8, Tables6–7.

## Axis ordering and print map identifiers

WMS1.3 follows the advertised CRS axes. EPSG:4326 therefore sends latitude,longitude; CRS:84 sends longitude,latitude. EPSG:3857 uses easting,northing. WMS1.1.1's EPSG:4326 wire BBOX uses longitude,latitude and SRS instead of CRS. Preserve internal x/y extents separately from their request serialization. FeatureInfo uses I/J in1.3 and X/Y in1.1.1.

Use ComposerTemplates/ComposerTemplate@name for TEMPLATE and each advertised ComposerMap@name for map-specific parameters. A project can expose more than one map item. QGIS's documented response shape is:

```xml
<ComposerTemplates>
  <ComposerTemplate name="Druckzusammenstellung 1" width="297" height="210">
    <ComposerMap name="map0" width="171" height="133"/>
    <ComposerMap name="map1" width="49" height="46"/>
  </ComposerTemplate>
</ComposerTemplates>
```

Retain the actual response namespaces and every map item; those sample names are not universal. GetPrint parameters include TEMPLATE, FORMAT, CRS, mapN:EXTENT, mapN:LAYERS, mapN:STYLES, mapN:SCALE, mapN:ROTATION and grid intervals. Select the publisher's actual enabled print template and original map names. QGIS can remove a non-atlas map item without its requested extent, so a successful PDF alone does not prove all maps survived.

The selected QGIS3.40 renderer explicitly inverts map-specific print extents for VERSION>=1.3.0 when destinationCrs.hasAxisInverted() is true. Its documentation contains a global-world print example with x/y order; source behavior takes precedence for this release. For EPSG:4326, serialize mapN:EXTENT as south,west,north,east in this version. Confirm the actual installed version for another release rather than applying this assertion universally.

Original renderer: https://github.com/QGIS/QGIS/blob/final-3_40_0/src/server/services/wms/qgswmsrenderer.cpp
Official request guide: https://docs.qgis.org/3.40/en/docs/server_manual/services/wms.html

## Receiving comparison

Retain each exact config/XML/response with URL, selected edition, native source hash, role label and retrieval time. Keep credentials and session values out of exported observations. Compare original theme IDs and source service names, resolved layer CRS/bounds/queryability/styles, printable layouts/maps, retained expected permissions and actual proxy outcomes. Record an authentication failure separately from an expected denied resource and from an unsupported request.

The same edition's original permission context supplies expected outcomes. An acceptance run uses existing identities and recorded publisher configuration; it does not edit users, roles, permissions or gateway routing. All publication/change-review and original customer ownership remain in the maintained workspaces.


## Native FeatureInfo fields, groups and role comparison

These details are pinned to QGIS `final-3_40_0` and the original QWC OGC service source listed above. They describe the configured parser contract; the illustrative XML structure is not a captured response.

The QGIS vector XML hierarchy is a configurable document root, then `Layer`, `Feature` and `Attribute` elements. The default root is `GetFeatureInfoResponse`; project settings can change its name and namespace. A layer carries its published query name and title. A feature ID comes from the original server feature-ID function and may reflect primary-key attributes, so retain it as a string. Attribute names are presentation labels produced by the layer's attribute-display function. Their values can include native value-map, relation and expression substitutions. Preserve those strings and the original XML; do not silently cast them into underlying database field types.

When the project enables the drag-and-drop attribute form layout, the renderer recursively inserts elements named after the original form containers. An unnamed container adds no XML group. Attributes may therefore occur several levels below a feature. Preserve their order, full group path, name and value as individual occurrences. Two attributes with the same display name must not overwrite one another in a keyed object. Fields excluded from the original WMS or access-control configuration are omitted by the renderer.

Raster responses use another native shape: attributes can appear directly under a layer without a feature wrapper. Numeric band identification uses the published band name; a null band value is represented by an empty string. Feature-style raster identification also appends direct layer attributes from its field/value pairs and can repeat field names across feature stores. A map tip can add another direct attribute. Retain these occurrences and their parent paths; do not invent feature IDs or assume every layer is a vector layer.

The selected QWC proxy requests upstream XML, then applies its own layer and attribute filter before returning XML or constructing the selected plain-text/HTML representation. In this pinned implementation, permitted-layer filtering uses direct `./Layer` children. It may replace a layer's title with the configured permitted title. It does not rewrite a retained layer's query name, feature ID, attribute name or value. The permissions reader maps original field names to aliases; the proxy resolves the alias because the native XML uses display labels.

The proxy's attribute filter inspects direct `Attribute` children under each feature. Its source does not establish equivalent filtering for arbitrary nested form groups or direct raster attributes. The acceptance operator must compare every parsed occurrence against the caller's explicit role expectation and retain any unexpected-field result. This is a comparison of the existing publication and permissions; the operator does not change roles, sessions or identities. Custom document namespaces and grouping remain properties of the selected publication and are recorded with the original response.

For expected denial, a successful data-bearing response must produce a difference. HTTP status alone cannot distinguish an allowed response from the proxy's XML error representation: retain and parse the original exception document as well as its status. Exact expected layer names, allowed field occurrences, configured root/namespace, geometry, print-map identifiers and role context belong to the selected publication edition.

Primary implementation sources:
- [QGIS 3.40 WMS renderer](https://github.com/qgis/QGIS/blob/final-3_40_0/src/server/services/wms/qgswmsrenderer.cpp): vector attributes, recursive form groups, raster identification and document construction.
- [Pinned QWC WMS handler](https://github.com/qwc-services/qwc-ogc-service/blob/62cf733a278dbc02137bf570eba15ae5afe2730e/wms_handler.py): request construction, permitted layers/attributes, XML filtering and selected client format.
- [Pinned QWC service permissions reader](https://github.com/qwc-services/qwc-services-core/blob/02d18ad18142c2a428459511c4e8a11a82df3096/qwc_services_core/permissions_reader.py): retain this repository's actual permission-source mapping when composing the selected edition.
