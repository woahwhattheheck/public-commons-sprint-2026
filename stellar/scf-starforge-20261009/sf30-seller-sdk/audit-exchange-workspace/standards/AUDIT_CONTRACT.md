# Audit Exchange Workspace: native data and receiving contract

This contract defines the original XML, validation, entity identity and commissioning-register boundaries for the Audit Exchange Workspace. The portable source catalogue in standards.json identifies every original schema, rule and example by byte length, SHA-256 and Git blob SHA-1. The complete original consumer application is retained in the private source packet alongside this generic product contract.

## 1. Standard and source identity

The native interchange is BuildingSync XML. The selected schema release is 2.7.0, from BuildingSync/schema release v2.7.0, commit b167d8b2867dfada909ed169ebd7ef71b43be1e8. Its namespace is http://buildingsync.net/schemas/bedes-auc/2019. The namespace suffix is not the schema release number. Prefix spelling is arbitrary: auc:BuildingSync and an unprefixed BuildingSync in that default namespace denote the same expanded element name.

The schema's required root version attribute accepts the literal forms 2.0.0/2.0 through 2.7.0/2.7. Preserve the supplied version text. Record the selected validator release separately. A document declaring 2.6.0 can be checked against the retained 2.7.0 compatibility schema; that result identifies 2.7.0 as the schema actually executed. A reviewed change of the declared version produces a new derived document.

Each imported source retains its complete original bytes, sourceId = SHA-256(bytes), length, original name, media type, supplied origin URI, intake time, stated revision/date, XML declaration/encoding and root namespace/version. Intake time and document revision are separate. Equal original bytes can share a retained object while their intake occurrences and source descriptions remain distinct.

Pass original bytes to the XML parser. Keep the original bytes even when the document is malformed or fails a selected validation rule. A well-formed document can be reviewed and corrected with its findings visible. An unchanged original download returns its original bytes. A modified export has its own hash, byte length and declared output encoding, and links back to its complete original and accepted edits.

## 2. Entity identity and structural locations

Expanded XML names consist of namespace URI and local name. Attribute names are also expanded names; BuildingSync ID and IDref are unqualified, case-sensitive attributes. The literal IDref value refers to an xs:ID anywhere in the SAME original XML document. Reference identity is not limited to a Facility, Site or Building, and separate source files do not share an ID namespace.

Retain all parsed elements, ordered attributes, text, child order, comments, processing instructions and original document content. The semantic index is a view over that source. An unfamiliar native element or foreign-namespace element remains in the retained source and generic structural view.

Every element gets a deterministic document-order key and complete structural location within its source. A suitable representation is sourceId plus a zero-based element ordinal, with an expanded-name path whose sibling indexes are one-based among siblings of the same expanded name. Store the literal ID separately, even when missing or duplicated. An editor's stable node key must remain attached to the same retained node after sibling insertions; a later independently imported source receives a different source identity. Comparison of different source versions uses an explicit operator-supplied source pairing. Within paired versions, unique literal IDs can assist matching; duplicate/missing IDs remain explicit structural matches.

The conventional prefix auc below maps to the native namespace. F means /auc:BuildingSync/auc:Facilities/auc:Facility. Wildcards here describe inventory traversal; native XML is never flattened into these labels.

| Entity | Original location or rule |
| --- | --- |
| Facility | F |
| Site | F/auc:Sites/auc:Site |
| Building | F/auc:Sites/auc:Site/auc:Buildings/auc:Building |
| Section | Building/auc:Sections/auc:Section |
| Thermal zone | Section/auc:ThermalZones/auc:ThermalZone |
| Space | ThermalZone/auc:Spaces/auc:Space |
| System or load | F/auc:Systems/*/*, retaining the exact local type |
| HVAC plant/source/delivery | Original descendants of HVACSystem under Plants and HeatingAndCoolingSystems |
| Measure | F/auc:Measures/auc:Measure |
| Report | F/auc:Reports/auc:Report |
| Scenario | Report/auc:Scenarios/auc:Scenario |
| Resource use | Scenario/auc:ResourceUses/auc:ResourceUse |
| Time series | Scenario/auc:TimeSeriesData/auc:TimeSeries and original derived-model time-series locations |
| Utility | Report/auc:Utilities/auc:Utility |
| Rate schedule | Utility/auc:RateSchedules/auc:RateSchedule |
| Contact | F/auc:Contacts/auc:Contact |
| Tenant | F/auc:Tenants/auc:Tenant |
| Schedule | F/auc:Schedules/auc:Schedule |
| Weather station | Original Site or Building WeatherStations/WeatherStation |
| Derived model/model | Scenario/auc:ScenarioType/auc:DerivedModel and its Models/Model |
| Savings summary | Original DerivedModel/SavingSummaries/SavingSummary |
| Other ID-bearing content | Preserve and index its actual expanded name, parent and full source location |

Index each IDref occurrence as its own relation: sourceId, fromNodeKey, attribute path, literal targetId, all same-source targetNodeKeys, and state resolved/unresolved/ambiguous. Duplicate IDs produce a finding on every affected member; an ambiguous relation has no arbitrary chosen target. The 59 upstream linking annotations are in schema-linking-elements.md and standards.json. Use their target-kind guidance alongside actual schema structure. Their human-readable path hints are not a substitute for the retained XSD.

LinkedPremises may name several Buildings, Sections or Spaces and may carry floor-area percentages on the link itself. Preserve those edge attributes and children. A system shared by two buildings remains one original system with two explicit relationships. An original system's enclosing facility and its served premises are distinct facts. The upstream file named Multi-Facility Shared Systems.xml contains one Facility and two Buildings; its two HVAC systems and on-site generation illustrate shared service within that source.

## 3. Exact values and reviewed changes

Keep native scalar text as text, including decimal precision, leading/trailing whitespace and supplied timestamp offsets. Record absence separately from a present empty element or attribute. xs:decimal values must not pass through JavaScript Number as their authoritative representation. A typed preview can add a parsed interpretation while the full original text stays present.

Keep literal enumerations and units. ResourceUnits, PeakResourceUnits, ReadingType, TimeSeriesReadingQuantity, IntervalFrequency, IntervalDurationUnits, Phase, EnergyFlowDirection and Source attributes belong to their original locations. Explicit reviewed transformations record both the original and replacement values and the chosen conversion method. Source ingestion does not perform unit conversion, infer timezone, infer a missing engineering value, or convert a utility resource into a BAS point.

A proposal binds to the exact source, source edition/current revision and node/attribute path. Each operation includes its expected original presence/value or subtree identity and complete replacement content. Apply a proposal atomically after checking all preconditions. Preserve proposed, accepted, superseded and rejected decisions and reviewer notes. Accepted changes create a source-linked edition; original source objects stay immutable. Related edits, such as changing an ID together with all approved IDref updates, can be reviewed in one atomic proposal.

Schema-order-aware insertion must use the complete XSD ordering. Removing or replacing a parent deliberately affects its full subtree and must show the complete affected content. References to removed or renamed IDs become explicit findings unless the same accepted proposal resolves them.

## 4. Local schema and use-case validation

Run a real XSD engine against the retained complete schema. The native supported route is Python lxml.etree.XMLSchema, followed by lxml.isoschematron.Schematron for selected official use cases. Record Python, lxml, libxml2 and libxslt versions with the actual validation result. Parsing XML with a standard-library tree reader alone is not an XSD validation result.

The 2.7.0 schema has one import:
https://github.com/BuildingSync/gbXML_Schemas/releases/download/v6.01/GreenBuildingXML_Ver6.01.xsd

Resolve that URI to the exact retained schema-gbxml-6.01.xsd bytes. Compile the original main XSD without editing its schemaLocation attribute. The dependency has no further xs:import, xs:include or xs:redefine. Its own xsi:schemaLocation contains an old author-local file URI; that attribute is source data, not a request to access the receiving machine.

Use an explicit lxml resolver whose allowlist maps only retained schema identifiers to their hash-checked bytes. The parser uses no_network=True, load_dtd=False, resolve_entities=False and recover=False. Do not process XInclude or document-supplied remote schema references. Reject DTD/entity declarations in editable input rather than expanding them. A resolver denial is an actionable validation diagnostic identifying the attempted URI. Schema assets are read from the delivered application, so ordinary original XML intake and validation work offline.

Retain a separate result for XML well-formedness, XSD, reference semantics and each selected Schematron file. Each result names the exact source/edited-document hash, original rule hash, chosen phase, start/end time and complete diagnostics. A diagnostic includes a stable ID, code, severity, message, sourceId, node/path when available, native line/column, rule/test/context and full original engine details. Preserve the full native SVRL report as a retained output.

The original use cases are version 1.0.0 with schemaVersion="1.0.0-2.7.0" and queryBinding="xslt1". The rule version and minimum native schema version are separate fields. Deliver the complete L000, L100, L200 and BSyncr files. Use phase "#ALL" for the complete chosen use case; explicit partial phase runs record the selected phase and remain distinct from the full-use-case result. Preserve ERROR, WARNING and INFO roles. lxml's default failed-assert finder includes warnings; configure the overall error determination to use ERROR-role failures while retaining all findings in SVRL and the operator view.

XSD checks the native grammar, attribute/value types and ordering. The semantic reader also checks duplicate IDs, unresolved/ambiguous references and expected reference target kinds. Schematron applies its source-authored contextual requirements. These are distinct results. A well-formed retained source with findings remains available for source review and correction; exported findings travel with the document.

## 5. Meter series and energy-model inputs

A TimeSeries can represent energy, peak demand, cost, temperature or another quantity. Its grouping identity includes source, containing scenario/model, linked resource or weather station, ReadingType, TimeSeriesReadingQuantity, native interval, phase and flow direction. Keep full StartTimestamp and EndTimestamp values; absent timezone information remains absent. Keep every original sample and its XML ID/location.

The full original L100+BSyncr fixture has four scenarios, two measures, three ResourceUses and 84 TimeSeries. Electricity has 12 Total, 12 Peak and 12 Cost readings; natural gas has 12 Total and 12 Cost; on-site generation has 12 Total and 12 Cost. Those seven streams share monthly dates and must not be concatenated into one regression input. The upstream sample states that its energy data is based on a DOE small-office prototype and PVWatts; it is an original publisher example used to commission the interchange.

The current official BSyncr use case requires a Building with latitude/longitude, one measured scenario per Scenarios container, one electricity ResourceUse in that measured scenario, at least 12 linked TimeSeries, and StartTimestamp/Month/IntervalReading for its TimeSeries. These requirements establish that particular input profile. They do not select a building, meter, reading category or weather station for the operator.

The original bsyncr R reader selects the first Building coordinates and first Electricity ResourceUse globally, then every linked TimeSeries without filtering ReadingType. It also obtains the nearest weather station and closest available weather date. The workspace therefore prepares explicit source-bound analysis selections before invoking an energy model. Retain selected source/building/scenario/resource/sample IDs, literal units, date range/timezone policy, original weather input and station identity, actual conversion/alignment options and selected native algorithm.

Keep complete original multi-resource XML alongside any derived model input. Native nmecr execution uses the real R package and its original input/output contracts. Retain invocation, package versions/source, original input frames, model object, statistics and native errors. A later model serialization writes a derived, source-linked XML edition and is validated against the same delivered schema. The exchange product can export complete selected native model inputs and receive externally produced native results without inventing savings.

## 6. Commissioning register interoperability

The existing consumer accepts eight strict tables. Every table is present, including empty tables. Values in these rows are strings; blank means blank. Extra undeclared fields are rejected. Preserve the consumer's supplied project contract, project ID, reviewers and commercial scope separately; the generic audit product does not hard-code a prospect's identity.

| Table | Primary key | Exact ordered fields |
| --- | --- | --- |
| source-groups | group_id + source_edition | group_id, purpose, source_workspace_id, source_folder_id, source_edition, source_review_sha256, archive_relative_path, archive_sha256, receiving_workspace_id, receiving_folder_id, receiving_edition, status |
| sources | source_id | source_id, group_id, source_edition, relative_path, sha256, bytes, supplied_mime, stated_revision, stated_revision_date, received_at, document_type, source_owner, approved_use, status |
| assets | asset_id | asset_id, site_id, system_id, provider_namespace, provider_id, equipment_tag, display_name, location, manufacturer, model, serial_number, source_id, source_locator, review_state, decision_id |
| points | point_id | point_id, provider_namespace, provider_id, asset_id, original_asset_reference, point_name, point_type, original_unit, normalized_unit, relationship_state, source_id, source_locator, review_state, decision_id |
| document-links | link_id | link_id, subject_type, subject_id, relationship, source_id, source_locator, stated_revision, approved_use, review_state, decision_id |
| discrepancies | issue_id | issue_id, subject_type, subject_id, issue_type, observed_value, source_id, source_locator, expected_requirement, proposed_action, decision_owner, decision_id, accepted_disposition, state, target_date |
| turnover-requirements | requirement_id | requirement_id, subject_type, requirement_name, applicability, decision_owner, source_id, source_locator, disposition, decision_id |
| field-mapping | mapping_id | mapping_id, source_id, source_field, source_type, target_table, target_field, empty_value_treatment, normalization, relationship_rule, reviewer_id, decision_id, accepted_at |

The complete first interoperability path is all eight CSV tables plus complete original XML as a document source, the generic full audit register/analysis, mapping description and source manifest. Use RFC-style quoted fields, escape embedded quotes, preserve embedded newlines and exact field order. The consumer maps columns by their original positions and retains every source row and mapping.

A native XML source catalogue ID can be "audit:" plus its full source SHA-256. A projected asset ID uses that source identity and the exact original node key; provider_namespace includes the explicitly chosen provider namespace and source identity, and provider_id retains the literal native ID. source_locator records the original hash and structural location/ID. Location/manufacturer/model/serial data is projected only when explicitly present or supplied through a reviewed mapping. Native facility/site/system relationships remain in the full audit analysis; a strict table cell does not silently collapse several served premises into one guessed location.

The sources table's path/hash/size must match an actual retained file. Its bytes field is a decimal string. When the same file occurs in several intake editions, the consumer retains all matching original occurrences. Relative paths are portable, case-sensitive full paths, so equal basenames remain distinct. A source group is emitted only when an actual selected archive/workspace edition supplies its required group metadata. An ordinary XML file can use a blank group_id/source_edition.

Review fields on projected assets, points and document links begin unreviewed, with blank decision_id. Their accepted states are unreviewed, needs_source, needs_decision, accepted, superseded and not_applicable. Field mappings retain blank reviewer/decision/acceptance values until actual review. Derived unit conversions remain explicit accepted mappings rather than silent normalization.

Measures, scenarios and utility/time-series records stay complete in the native audit analysis and XML. The current eight-table consumer has no measure or scenario subject type. It recognizes asset/equipment, point, source/document, requirement, discrepancy, the eight table names, and the actual project. Audit-specific detailed issue context can remain attached to its source/document or project with an exact native locator. A BAS-point projection requires an explicit accepted source relationship and appropriate native point identity.

The current consumer's source.import supports table, document, haystack-grid, haystack-workspace and folder-archive. register.save accepts selected original table mappings, document source IDs, reviewed additions/corrections/exclusions, and its existing native selections. Its native materialization origin distinguishes Folder from Haystack; a later direct audit adapter requires its own explicit foundation classification. The eight-CSV/document path works with the current published consumer.

## 7. Complete edited exchange and receiving

A complete handover contains original XML objects; edited native XML for the selected edition; the full source/entity/relation/diagnostic view; selected official schemas and use-case rules; proposals and review decisions; exact source-to-register mappings; all eight consumer tables when selected; complete reports and model input/result attachments; and a manifest of every original member.

A complete editable workspace export additionally contains the application source, its declared Python/XML-engine dependency contract, immutable edition history, selected source identities and retained operation outcomes. Receiving verifies every member length/hash, source/object relationship, edition/proposal chain and original rule identity before opening the same editable material under the receiving workspace's local identity. Keep incoming identities as source data and create local operating identities for new changes.

The native receiving journey starts from the untouched combined L100+BSyncr fixture, retains all seven reading streams, saves a reviewed change, compares editions, exports native XML and the full register package, receives the full editable workspace into a new destination, reopens it and checks the original bytes again. The untouched L000, L200, minimal BSyncr and two-building shared-system examples exercise the same full parser/validator interfaces. Record the actual original engine results, including any upstream-example findings, rather than rewriting a fixture to make it look successful.

## 8. Original source notices and references

Retain BUILDINGSYNC_LICENSE.txt exactly. It permits source and binary redistribution subject to its complete notice and conditions, including its naming/trademark condition. The generic product name is Audit Exchange Workspace; BuildingSync identifies the supported standard.

The schema and linking guide come from the licensed schema repository. The complete rule/example files come from the publisher's public use-cases repository; its repository metadata currently reports no separate license file. The original gbXML dependency comes from the public BuildingSync-maintained v6.01 mirror; both that mirror and the current official schema repository report no separate repository license. Their source locations and original notices stay explicit in the source catalogue. The private integration packet preserves these original standard inputs and the private consumer source as separate components.

Primary implementation references:
- https://github.com/BuildingSync/schema/releases/tag/v2.7.0
- https://github.com/BuildingSync/schema/blob/b167d8b2867dfada909ed169ebd7ef71b43be1e8/BuildingSync.xsd
- https://github.com/BuildingSync/use-cases/commit/88d1e5e4ce741fef4d81d93a411e67a70d96aa25
- https://buildingsync.net/technical_resources
- https://buildingsync.net/implementers
- https://buildingsync.net/use_cases
- https://github.com/BuildingSync/bsyncr
- https://github.com/kW-Labs/nmecr
- https://kw-labs.github.io/nmecr/
