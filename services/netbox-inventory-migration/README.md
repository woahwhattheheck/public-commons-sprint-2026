# Native NetBox customer inventory migration

Move a selected CSV inventory into the customer's existing NetBox, review its actual native effects, commit that reviewed edition, and hand the operator a recoverable workspace. The product includes a CSV mapping/preparation CLI, a NetBox custom script, a retained Scripts/Jobs/Journal API client, searchable printable inventory and network commissioning reports, and a complete customer restore archive.

The native contract is NetBox **v4.7.2**, commit **251458b89a5eb2f5fe0d20ecd1140ba08f141a9c**. Each actual review also records the server's own NetBox version, database schema, tenant and origin. The contract pin identifies the implementation used to build this integration; it does not substitute for the version returned by a running customer instance.

## Browser customer desk

The [customer desk](workspace/README.md) carries retained CSV uploads, complete column and relationship mapping, actual permitted catalogue selection, original native review/apply/recovery, and corrected drafts through this same operator. It keeps a browser action attached to its original request across a lost reply, and includes the complete desk source in the selected native handover.

Start it with `python3 workspace/server.py --directory /private/customer-inventory --config /private/netbox-connection.json`. Open the returned local URL. Reopening the same directory restores the saved projects and native action history.

## Customer operating path

1. Select the existing tenant, native catalogues and a complete source edition.
2. Map CSV columns to sites, racks, devices, physical interfaces and IP addresses.
3. Prepare a private immutable workspace. Read and resolve its row corrections.
4. Execute an original NetBox ScriptJob with commit disabled. NetBox performs its real model validation, saves and generated-component creation inside the original transaction, then rolls those writes back.
5. Read the complete native review and its digest. Apply exactly that digest to the same retained source.
6. Recover the original request through actual Jobs and the transaction's native JournalEntry whenever a reply is lost.
7. Export the native result, object links, ID mapping, report and full operator handover. Restore those original bytes in a new directory and reopen the same operation.

This is a selected inventory migration. Existing NetBox catalogues, templates, permissions, models, journal, job queue and optional Branching remain the operating systems.

## Files and requirements

| File | Purpose |
| --- | --- |
| inventory_migration.py | Original NetBox custom script and shared standard-library data contract |
| prepare_inventory.py | CSV mapping, exact source retention, row corrections and workspace creation |
| network_report.py | Retained network objects, VRF-aware prefix membership, full CSV and printable commissioning report |
| operate_inventory.py | Native API review, apply, receipt recovery, report, archive and restore |
| examples/ | Five joined CSV tables plus mapping and private connection templates |
| native/native_fixture.py | Creates the dedicated receiving inventory inside a real NetBox instance |
| native/run_native.py | One retained whole product receiving journey against that original HTTP API |
| native/README.md | Actual PostgreSQL/Redis/worker receiving instructions and operation identity |

The two local CLIs require Python 3.12 or newer and use its standard library. The custom script runs in the existing NetBox Python/Django process, with its original PostgreSQL and Redis/RQ worker. A queue worker must actually service the native script job.

Use a private working directory. The workspace contains original inventory, source paths, native results and job receipts. Connection credentials stay in the named environment variable. The operator does not copy the connection file or token into the handover.

## Configure the selected environment

Copy examples/connection.json to a private path. Replace the example origin with the exact NetBox base URL, including any deployment path prefix. Set token_env to the existing environment variable holding the original API credential. NetBox v2 tokens use authorization_scheme Bearer; legacy v1 tokens use Token. The current NetBox documentation recommends v2.

For an existing native branch, add its actual ID as branch. This sends the original X-NetBox-Branch header and permanently binds that workspace to the chosen branch. Configure the instance's original Branching integration and worker before using that route. A branch's reviewed native schema remains part of the digest. The workflow never silently changes the branch on reopen.

The authenticated account needs the original permission to run the selected script and to view its jobs. It also needs view/add/change permissions for the selected inventory and its tenant, view permissions for chosen catalogues and affected descendants, and view/add permission for the original JournalEntry. The script checks the same native object restrictions before and after writes. The existing administrator determines the customer's permitted tenant and objects.

Install inventory_migration.py through NetBox's existing custom-script upload screen, or its original multipart endpoint:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $NETBOX_TOKEN" \
  -F "file=@inventory_migration.py;type=text/x-python" \
  "$NETBOX_URL/api/extras/scripts/upload/"
```

The native module name is inventory_migration and class name is InventoryMigration. The configured script is therefore inventory_migration.InventoryMigration. Upload uses the existing extras.add_scriptmodule and core.add_managedfile permissions. Update an installed module through NetBox's original update route, preserving its filename and reviewing the source change.

## Prepare the complete source edition

Copy the example mapping and CSVs into a customer source directory. Every example origin and numeric native ID is a placeholder. Use actual tenant, Site/Rack/Device match IDs, DeviceType, DeviceRole, Platform, Location and VRF IDs from the selected instance.

```bash
python prepare_inventory.py \
  --mapping /private/customer-input/mapping.json \
  --workspace /private/customer-inventory/edition-001 \
  --operation-id customer-inventory-20261012-001
```

A successful result is PREPARED. CORRECTION_REQUIRED points to corrections.json, which identifies the source mapping or the exact data-row number. Row numbers count CSV records after the header; an embedded newline belongs to its original CSV record.

A prepared edition retains the exact mapping, each original CSV, its byte hash and row count, the normalized request, every source-row digest and one operation ID. A repeated identical preparation completes any missing original files. Changed source bytes or mapping require a new edition directory and a new operation ID. This keeps reviewed input and correction history readable.

### Mapping contract

The mapping has schema tjlabs.netbox.mapping/v1, the exact netbox_url, existing tenant_id and one to 32 sources. Each source declares kind, file, key and the mapped fields, links and catalogue IDs.

| Expression | Meaning |
| --- | --- |
| {"column":"serial"} | Read the original named CSV column |
| {"value":"active"} | Use an explicit literal |
| {"column":"state","values":{"In use":"active","Spare":"inventory"}} | Map only the declared original values |
| {"column":"dns_name","lower":true} | Apply an explicit normalization |
| {"column":"location_id","blank":"null"} | Clear this optional native value when the source is blank |
| {"column":"description","blank":"empty"} | Retain an explicit empty text value |
| {"column":"site_key","by":"key"} | Refer to another mapped original row |
| {"column":"site_id","by":"id"} | Refer to an existing native object ID |

Whitespace is trimmed by default; trim:false preserves it. The default blank behavior is omit, which leaves an existing value unchanged. JSON literal decimals must be strings; rack position is retained as an exact decimal string. Integer IDs, booleans and IP prefixes are validated explicitly. Unknown columns, values or fields produce source corrections.

The source key is stable within its kind. Use match_id when an object is renamed or moved: it binds the intended original object even if the natural match changes. Without match_id the native lookup uses site slug, rack/site/name, tenant/device/site/name, interface/device/name, or IP address/VRF. Ambiguous matches require an explicit original ID.

| Kind | Supported fields and relationships |
| --- | --- |
| sites | name, slug, status, description; selected tenant |
| racks | name, status, u_height, width, starting_unit, desc_units, description, facility_id; site and existing Location |
| devices | name, status, serial, asset_tag, position, face, description; site, optional rack, DeviceType, DeviceRole, optional Platform and Location |
| route_targets | name, description; selected tenant |
| vrfs | name, optional rd, enforce_unique, description; import/export route-target memberships |
| vlans | name, vid, status, description; optional site, existing VLANGroup and IPAM Role |
| prefixes | prefix, status, is_pool, mark_utilized, description; optional VRF, VLAN, Site scope and existing IPAM Role |
| interfaces | name, type, enabled, mgmt_only, description, mtu, speed, duplex, mode; physical device, optional VRF, untagged VLAN and complete tagged VLAN membership |
| ip_addresses | address with prefix, status, role, dns_name, description; physical interface, optional source/native VRF; optional primary flag |
| cables | label, type, status, color, exact decimal length, length_unit, description; selected A/B Interfaces and optional existing CableBundle |

A primary address updates the native device's primary IPv4 or IPv6 after the interface/IP is validated. One selected address per device/family may request primary status.

A located rack determines the native device location. The script derives that original value before NetBox validates a move. If the source explicitly selects a conflicting Location, the review fails with the row error. When moving to an unlocated rack or clearing a rack across sites, explicitly select or clear the retained Location as appropriate.

Existing installed child devices follow the original Device.save propagation. The review shows affected child site/rack/location changes and checks their original permissions. Mapped parents precede mapped children, and final validation detects any native side effect that overwrote an explicit source value.

Supported input limits are 5,000 mapped objects, 32 CSV source mappings, 32 MiB per source, 64 MiB of combined unique source bytes and an 8 MiB normalized request. These are implementation limits; the priced customer scope is separately agreed.

## Commission routing, addressing and cable connections

The complete [network example](examples/network-mapping.json) extends the same CSV compiler, ScriptJob, review digest and transaction journal. It includes two route targets, two VRFs, three VLANs, four scoped prefixes, four interfaces, four addresses and an interface-to-interface cable. The two VRFs deliberately use the same IPv4 prefix and address so the operator can inspect their separate routing contexts.

Keep the original sites.csv, racks.csv and devices.csv beside the network-*.csv files. Replace the example origin, tenant, DeviceType, DeviceRole, Location and existing object IDs with the selected customer inventory before preparation:

~~~bash
python3 prepare_inventory.py \
  --mapping examples/network-mapping.json \
  --source-root examples \
  --workspace /private/customer-inventory/network-001 \
  --operation-id customer-network-20261012-001
~~~

The browser supports the same fields. Add the network CSVs, choose the native object kinds and retain the exact mapping before preparing an edition. The original small inventory example remains available in examples/mapping.json.

### Source keys and native selection

Objects are prepared in dependency order: sites, route targets, VRFs, VLANs, prefixes, racks, devices, interfaces, IP addresses and cables. A relationship uses either an imported source key or an existing native ID. Prefix scope_site selects a native Site through NetBox's original scoped-object field.

Use match_id for an existing object's rename, move or intentional reassignment. Native matching follows the original model's identity rules: route-target name; VRF route distinguisher when supplied, otherwise tenant/name; VLAN group/VID, or tenant/site/VID without a group; prefix or IP address in its explicitly selected VRF; and the actual pair of Interface cable terminations. An ambiguous native match requires the original ID. Cable labels are descriptive and are not used as identity.

A new or existing prefix is normalized to its network address before native validation. NetBox's own prefix, address, VLAN, site/group and uniqueness validation still determines the accepted inventory. Interface VRF and address VRF are independently selected native fields: the compiler does not copy one into the other.

Legacy IP mapping through catalog.vrf remains accepted. A row may select VRF through links.vrf or catalog.vrf; choosing both produces a source correction.

### Complete memberships

VRF import_targets/export_targets and Interface tagged_vlans live in the mapping's many object:

~~~json
{
  "many": {
    "tagged_vlans": {
      "column": "tagged_vlans_keys",
      "by": "key",
      "separator": ";",
      "blank": "null"
    }
  }
}
~~~

The CSV value apps;guest selects those two imported VLANs. Set by to id for existing native IDs, such as 110;120. A fixed JSON list can also select the complete membership; value:[] or value:null clears it. The default blank behavior is omit, which preserves an existing membership. The example explicitly uses blank:null to clear an empty cell.

The desk provides column and fixed-value modes, native catalogue selection for IDs, the one-character separator, and JSON-list value replacements. Values become the original NetBox many-to-many relationships after the model is saved.

Tagged VLAN membership requires native tagged mode, and a VLAN must be unscoped to a site or belong to the Interface's device site. NetBox's own save behavior clears tagged membership when mode changes away from tagged, and clears an untagged VLAN when mode becomes empty. Every Interface review includes the resulting mode and both VLAN membership fields, including changes produced by that native behavior.

For an existing channelized Interface rename, the migration retains the actual affected channel children and invokes NetBox's own _rename_channel_subinterfaces method after all mapped saves. Its original custom-name, length and collision handling determines the result. Those native renames appear before the final review/journal is recorded, and explicit mapped child names are checked against the completed cascade. The original commit callback remains attached to that same once-only native invocation, including interacting parent-name collisions.

### Native connectivity

A cable source maps one actual Interface at each A/B end. Use the original cable's match_id to move an existing connection. NetBox validates endpoint compatibility, channel restrictions, occupied interfaces, mark_connected and the original cable fields; the migration calls Cable.save inside the same original transaction.

The review also reads the actual CableTermination rows, affected endpoint caches, channel interfaces and stored CablePaths. It retains ordered path hops, origins, destinations and complete/active/split flags. Existing passthrough/circuit path nodes remain part of that native observation. Endpoint/path changes appear with the mapped inventory; generated database cache IDs are normalized to source/component identities before comparing review and apply.

An interrupted apply is recovered through the same operation's original job and journal. All mapped inventory, memberships, native cable effects and the journal commit together.

### Review, deliver and reopen

The desk's **Network commissioning** panel shows each network family, source row, native object link, complete before/after change and the selected prefix for each address. Prefix membership uses the most specific selected prefix in that address's explicitly reviewed VRF. It describes the selected migration inventory; the full original native result remains alongside it.

Create report or Build handover writes:

| File | Contents |
| --- | --- |
| exports/network-commissioning.html | Searchable, printable network tables and native endpoint/path effects |
| exports/network-commissioning.csv | Every selected network object/effect, full before/after JSON, source file hash and data-row reference |
| exports/network-commissioning.json | Typed objects, exact prefix address counts, routing context and selected-prefix groups |

The complete handover retains these exports, the original native result, all input CSVs, mapping and network_report.py with the operator/desk source. Restoring that archive reopens the same edition and report. Start a corrected draft to carry applied native IDs into the next reviewed edition, change membership or a cable endpoint, and preserve the earlier applied result.

The same-host receiving continuation is documented in [the native guide](native/README.md).

## Review the actual NetBox result

```bash
python operate_inventory.py review \
  --workspace /private/customer-inventory/edition-001 \
  --config /private/netbox-connection.json \
  --wait 120

python operate_inventory.py report \
  --workspace /private/customer-inventory/edition-001
```

The operator retains the original multipart request before submitting one ScriptJob. The immediate Scripts response names a candidate job; complete job paging and the unique original execution reference establish which result belongs to this operation.

Read exports/inventory-report.html and exports/native-result.json. The native review includes original and final selected values, native catalogue/template context, affected child devices and the actual generated components from Device.save. Module bay types, custom-field defaults, parent relationships and inventory-item component references are retained. Generated database IDs and derived Ltree storage paths are normalized to logical source/component identities so a rolled-back dry-run can be compared with a later commit.

The digest also binds the original CSV identities, source notes, tenant, origin, native version and database schema. A changed catalogue, reviewed value or generated result produces a different digest.

Review does real native work inside NetBox's transaction. Its data-model writes roll back through the original ScriptJob commit=false path. NetBox retains the original job and output.

## Apply the reviewed edition

```bash
python operate_inventory.py apply \
  --workspace /private/customer-inventory/edition-001 \
  --config /private/netbox-connection.json \
  --review-digest COPY_THE_EXACT_REVIEW_DIGEST \
  --wait 120
```

The original models execute again and must produce the exact reviewed digest. The custom script acquires a transaction-scoped native tenant lock, locks the selected original objects, performs normal model validation/save and creates one original tenant JournalEntry in that same transaction.

If the actual native state has changed, the transaction rolls back and returns CORRECTION_REQUIRED. Read its retained job error and run review --refresh to obtain a new native review. The earlier attempt and its output remain under attempts/. Apply the newly reviewed digest only after inspecting that result.

APPLIED contains the native JournalEntry, committed object IDs and receipt digest. Its journal is the recovery record for this source operation. Reopening an already committed operation returns that original receipt and inventory.

## Recover a reply or session

```bash
python operate_inventory.py recover \
  --workspace /private/customer-inventory/edition-001 \
  --config /private/netbox-connection.json \
  --wait 120

python operate_inventory.py inspect \
  --workspace /private/customer-inventory/edition-001
```

Recovery first reads the original tenant journal, then pages the native Jobs for the retained script and time window. It matches the exact execution reference. The latest unrelated job is never adopted as this request's result.

| Retained state | Operator action |
| --- | --- |
| PREPARED | Review the saved original edition |
| AWAITING_NATIVE_RESULT | Recover the same request; its original job may still be queued or running |
| AUTH_REQUIRED | Restore the same account's credential, then recover the retained request |
| REJECTED | Read the original provider response and resolve that explicit request problem |
| CORRECTION_REQUIRED | Read the native validation error; correct a new source edition or refresh the current native review |
| REVIEWED | Inspect the complete digest-bound result and apply it |
| APPLIED | Reopen the original journal and export the customer handover |

Ordinary restarts use reads to reconcile a retained request. For an explicitly chosen unresolved request after reviewing native status, retry-current creates another native job for the **same business operation**, after another complete receipt/census read. The script's same-transaction operation journal serializes duplicate native submissions into one inventory commit. Use the original API status and operator context to decide that explicit action; a timeout alone does not initiate it.

The client refuses redirects and cross-origin pagination and keeps the selected native branch/origin binding. Tokens stay in memory and the named environment variable. A replaced credential does not create a new operation.

## Correct the source and hand it over

After a committed import, exports/resolved-objects.csv maps each original source key to its actual NetBox ID. Populate the corrected source's match_id columns from that file before a rename or move. Prepare the corrected bytes in edition-002 with a new operation ID, then review and apply through the same native path. Existing ID bindings preserve those customer objects.

```bash
python operate_inventory.py handover \
  --workspace /private/customer-inventory/edition-001

python operate_inventory.py restore \
  --archive /private/customer-inventory/edition-001/exports/inventory-handover.zip \
  --workspace /private/customer-inventory/restored-001

python operate_inventory.py inspect \
  --workspace /private/customer-inventory/restored-001
```

The ZIP contains complete original source files, mapping, request, retained attempts/results, native journal capture, operator source, report and object-ID export. Its manifest names and hashes every file. Restore streams the verified bytes to exclusive synced files and is resumable with the same archive/directory. The ordinary operator opens it only after every source, native result and operation binding validates.

A customer can then supply their private connection configuration and original credential and recover that same native receipt from the restored workspace. Hand over the exact ZIP to the agreed customer destination; retain its original checksum and receiving record in the opportunity.

## Native receiving operation

The complete runnable packet is native/README.md. It uses the actual pinned NetBox model/ScriptJob/API implementation, PostgreSQL, Redis/RQ, a dedicated receiving tenant and the original operator. It covers source preparation, native rollback, generated component/default changes, reviewed commit, parent/child moves, a lost response after an actual HTTP submission, same-operation recovery, corrected source, full customer export and cold restore. Follow its original operation identity on an equipped receiving host.

## Primary source contract

- [NetBox v4.7.2 source](https://github.com/netbox-community/netbox/tree/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c)
- [Original ScriptJob transaction](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/extras/jobs.py)
- [Custom scripts](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/docs/customization/custom-scripts.md)
- [Original REST API and token formats](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/docs/integrations/rest-api.md)
- [Device saves and component creation](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/dcim/models/devices.py)
- [Component hierarchy and original generic relationships](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/dcim/models/device_components.py)
- [Native component templates](https://github.com/netbox-community/netbox/blob/251458b89a5eb2f5fe0d20ecd1140ba08f141a9c/netbox/dcim/models/device_component_templates.py)
- [Community-maintained NetBox Docker deployment](https://github.com/netbox-community/netbox-docker)

The partner opportunity is grounded in [NetBox Labs' Expert Partner program](https://netboxlabs.com/partners/) and its [implementation/migration project bundles](https://netboxlabs.com/blog/netbox-labs-project-bundles-for-partners-streamlining-network-projects-for-our-expert-partners-and-their-clients/). Customer scope, price, payer, work split and receiving arrangement belong to the original commercial case.
