# Original water classifications across SC, NC and GA

Water source review now accepts explicit jurisdiction-qualified registry v2
editions. The existing South Carolina v1 body and class interpretation remain
unchanged. Each original legal system, source edition, geographic publisher and
record identity stays separate throughout adoption, crosswalk, inspection,
export and the printable briefing.

## Read a source and choose geometry

Import the complete native source manifest into the existing Workspace. Open
**Water source review**, choose a legal registry, then choose its retained
geographic crosswalk when one exists. Filter by jurisdiction, literal class,
individual class component, county, edition or source text. Inspect the complete
original description, source index, class components, special markers and
original per-reach date when supplied.

**Download printable source briefing** freezes every filtered record, including
records beyond the displayed page. Legal cards, native appendix and CSV preserve
jurisdiction, classification system, components, original index/date, source
edition and exact identities. The complete JSON retains all original source
values. Open the HTML and use the browser's Print / save PDF command.

Statewide or basin-wide source membership does not establish study membership.
The maintained crosswalk measures intersections with the original 217-HUC
domain. Positive intersections and boundary touches remain separate.
Candidate associations support review; explicit coextensive and partial
bindings retain their distinct meanings.

## Original systems

| Jurisdiction | System | Interpretation |
| --- | --- | --- |
| SC | SC-R61-69 | Original v1 classes, county abbreviations, prior classes, SP and NDZ remain unchanged. |
| NC | NC-15A-NCAC-02B | Complete BIMS_Class punctuation, primary B/C, supplemental Tr/HQW/ORW and management markers +/@ remain separate. |
| GA | GA-391-3-6-.03 | Designated uses and county trout-protection clauses have distinct original records and roles. |

No automatic class equivalence is applied. NC `C;Tr,ORW` retains that entire
literal string with components C, Tr and ORW. NC `C;Tr:+` separately retains +;
a + or @ marker is not promoted to ORW/HQW. Georgia Primary/Secondary trout
labels are not renamed to South Carolina TN/TPGT/TPT.

The explicit source screening predicate uses SC's existing
ONRW/ORW/TN/TPGT/TPT classes; NC Tr/HQW/ORW components; and GA statutory trout,
Wild/Scenic or ONRW components. It is a source screening flag, not an award,
cross-state equivalence, ecological condition or modeled effect.

## Registry v2 and dates

A v2 edition requires jurisdiction and its matching classification_system.
Original records retain id, waterbody_name, class_raw, class_code,
source_class_label, class_components, reach_description and source references.
primary_class, supplemental_classes, special_markers, classification_role,
original_index and effective_date retain their original meanings.

Edition status can be current, proposed, source-published, historical or
superseded. **source-published** records the publisher's original edition
without silently asserting that a printed document is present law. Publisher
data quality remains independent. Capture dates, publisher modification dates,
edition approval dates and individual reach dates are not interchangeable.

SC v1 is not rewritten on disk. View-only missing scope defaults to SC /
SC-R61-69. Foreign editions require v2 so an older SC-only receiver cannot
silently apply SC rules to their class strings.

## Geographic mapping and candidate associations

Use exact original metadata names. A typical NC mapping uses class_field
BIMS_Class, name_field BIMS_Name, description_field BIMS_Descr,
native_index_field BIMS_INDEX and effective_date_field BIMS_Date, with explicit
NC / NC-15A-NCAC-02B, source-published status and original source vintage.

The raw native date remains native_effective_date; an independently transcribed
legal date remains effective_date. Every original attribute is retained in the
feature inspector. Candidate joining uses jurisdiction, system, exact original
index, entire literal class and edition status. This works without invented
county attributes. The legacy name/class/county candidate is confined to the
same jurisdiction and system. Explicit cross-system or mixed-status bindings
are rejected.

Derived display names can disable automatic name candidates with
allow_name_candidate=false. Georgia's conditional county trout paragraphs use
this flag while retaining explicit binding capability and complete clauses.

## Adopt original responses

The original command accepts complete existing responses without another query:

```bash
python -m source_tools.high_quality_waters adopt \
  --selection retained-selection.json \
  --metadata original-layer.json \
  --features original-page-001.json \
  --features original-page-002.json \
  --attributes original-attributes.json \
  --companion original-ids.json \
  --companion original-count.json \
  --output retained-capture
```

Selection v1 keeps its mandatory original publisher HUC constraints.
Selection v2 adds explicit jurisdiction/system, complete unique
expected_object_ids, and exact attribute_filters. A source lacking a published
HUC field uses huc_field=null and its actual nonempty attribute predicate, such
as `{"Name":["Savannah"]}`. No HUC attributes are invented.

Original feature count, exact IDs, CRS, metadata field types, all projected
attributes, class totals, transfer limits and source response bytes remain
checked. Output stays capture/v1 plus upstate.sources/v1, with exact original
responses accompanying the derived native collection.

```bash
python -m source_tools.high_quality_water_crosswalk \
  --capture retained-capture \
  --mapping native-field-binding.json \
  --planning-basins ORIGINAL_PlanningBasins2023.shp \
  --focus-hucs ORIGINAL_FOUR_FOCUS_RESPONSE.json \
  --huc ORIGINAL_217_DOMAIN.json.gz \
  --registry ORIGINAL_LEGAL_REGISTRY.json \
  --output prepared-water-crosswalk \
  --workspace EXISTING_WORKSPACE
```

Use the original geography belonging to the existing study. The maintained
project-source option remains available when those retained files occupy its
documented directory. The existing engine measures geometry and imports the
completed source edition into the same Workspace.

## Complete source families and receiving

Georgia's application-root manifest is ga_classified_water_sources.json; its
complete original extraction, reviewed selection, executable builder, CSV and
DNR discovery metadata are documented under
source/high_quality_waters/georgia-20261013/README.md. North Carolina's
independently retained legal schedules and native GIS source use
nc_classified_water_sources.json. Complete basin source cohorts remain distinct
from their measured study intersections.

The additive component fragment retains the classification helper, original
adoption/crosswalk producers, controller, printable module and data companions
through the maintained application resolver.

In the existing native operation, compile the updated Python modules, load the
original SC and new NC/GA sources, then run the complete original NC source
against the retained 217-domain geography. Inspect a compound class, +/@
marker, source index/date and candidate association. Inspect a complete Georgia
conditional clause without assigning fishing-map geometry. Reopen an exported
briefing outside the operator and compare its complete selected JSON/CSV with
the original source selections. Retain actual source collection/crosswalk IDs.
