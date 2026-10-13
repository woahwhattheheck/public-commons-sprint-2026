import {analyze,tables} from "./history_core.mjs";
import {render,figures} from "./render_history.mjs";
export const ROOT="source/nc_assessment_history/20261013";
export const MANIFEST="nc_assessment_history.sources.json";
export const SOURCE_ID="nc-assessment-history-2008-2022";
const json=value=>JSON.stringify(value,null,2)+"\n";
const shown=value=>value===null?"Missing (null)":String(value);
const rounded=value=>Number(value).toFixed(3);
export function produce(originalText,metadataText,provenance,sourceFiles,identity){
  const analysis=analyze(originalText,metadataText,provenance),csv=tables(analysis),figure=figures(analysis);
  const generated={
    [ROOT+"/analysis.json"]:json(analysis),
    ...Object.fromEntries(Object.entries(csv).map(([name,body])=>[ROOT+"/tables/"+name,body])),
    [ROOT+"/report.html"]:render(analysis,csv),
    [ROOT+"/figures/specification.json"]:json(figure.spec),
    [ROOT+"/figures/rating_counts.svg"]:figure.svg
  };
  const originals={[provenance.original.path]:originalText,[provenance.metadata.path]:metadataText};
  const members={...sourceFiles,...originals,...generated};
  const entryFor=path=>({path,...identity(members[path])});
  const sizeRows=analysis.cohort_summary.by_published_size_unit.map(s=>[s.unit,s.assessment_units,rounded(s.fixed_2022_published_size_decimal)]);
  const summary=analysis.cohort_summary;
  const recipe={
    schema:"upstate.observed-report/v1",edition:analysis.edition,title:"North Carolina assessment rating history, 2008–2022",
    sections:[
      ["Original assessment corpus",[
        "The source carries eight overall-rating columns for the same 110 assessment units in NC DEQ's Final 2022 Integrated Report. The complete analysis resolves all 880 original cells to their original feature index, object ID, assessment-unit ID and JSON pointer.",
        "Needs expert review: use this assessment context alongside the original methodology and measured-source evidence. Historical columns on current records do not reconstruct historical geography, assessment coverage or legal classification.",
        {kind:"table",columns:["Measure","Value"],rows:[["Assessment units",summary.assessment_units],["Original rating cells",summary.rating_cells],["Units constant across eight columns",summary.constant_units],["Units with any label change",summary.changed_units],["Adjacent-cycle label changes",summary.adjacent_cycle_changes]]}
      ]],
      ["Eight-cycle counts",[
        {kind:"table",columns:["Year",...analysis.ratings],rows:analysis.cycles.map(c=>[c.year,...analysis.ratings.map(r=>c.by_rating.find(x=>x.value===r)?.assessment_units??0)])},
        "Every year has the same denominator of 110 units. Ratings retain the publisher's literal strings. No Data is an assessment label, not zero pollution or an assertion that no monitoring exists."
      ]],
      ["Changes hidden by identical aggregate counts",[
        "The 2018 and 2020 headline counts are identical: 23 Meeting Criteria, 83 No Data and 4 Data Inconclusive. Within that total, Horsepasture River AU 10512 changes Data Inconclusive to Meeting Criteria; Trays Island Creek AU 13394 changes Meeting Criteria to Data Inconclusive. All original 2020 and 2022 unit-level labels match.",
        {kind:"table",columns:["Interval","AU ID","Published name","From","To"],rows:analysis.transitions.map(t=>[t.from_year+"–"+t.to_year,t.assessment_unit_id,t.name,shown(t.from_rating),shown(t.to_rating)])}
      ]],
      ["Stable labels and interpretation",[
        {kind:"table",columns:["Original label in all eight columns","Assessment units"],rows:summary.always_rating.map(r=>[shown(r.rating),r.assessment_units])},
        "The 99 constant units and 11 changing units describe the fixed current cohort. Label changes alone do not establish an improvement, deterioration, contaminant load, causal explanation or exposure risk."
      ]],
      ["Published size and geographic representation",[
        {kind:"table",columns:["Original size unit","Assessment units","Fixed 2022 total"],rows:sizeRows},
        "Miles and acres remain separate. All size-weighted tables use the original AU_Length/AU_Units values attached to this 2022 source, with exact decimal-token sums before display rounding. They are not estimates of historical stream length or lake area.",
        "The 34 original polygon records are alternate geometry for assessment units already in this 110-unit corpus. This history uses one original layer-2 row per AU_ID and does not count polygon representations again. The separate parameter table's CYCLE records remain distinct from these eight overall-rating columns."
      ]],
      ["Reusable original-source explorer and exports",[
        {kind:"links",items:[
          {title:"Offline assessment unit explorer",path:ROOT+"/report.html"},
          {title:"All 880 original rating cells",path:ROOT+"/tables/history.csv"},
          {title:"All 110 unit trajectories",path:ROOT+"/tables/unit_trajectories.csv"},
          {title:"Every adjacent-cycle transition",path:ROOT+"/tables/transitions.csv"},
          {title:"Complete transition matrices, including unchanged units",path:ROOT+"/tables/transition_matrices.csv"},
          {title:"Cycle counts",path:ROOT+"/tables/cycle_counts.csv"},
          {title:"Fixed 2022 size by historical label",path:ROOT+"/tables/fixed_2022_size_by_rating.csv"},
          {title:"Complete analysis and original record attributes",path:ROOT+"/analysis.json"}
        ]}
      ]],
      ["Original publisher sources and method",[
        "Publisher: North Carolina Department of Environmental Quality. Original Final 2022 Integrated Report layer 2, selected HUC8 values 3060101 and 3060102. Field aliases explicitly identify the eight YYYY Overall Rating columns.",
        {kind:"links",items:[
          {title:"Complete original feature response",path:provenance.original.path},
          {title:"Complete original layer metadata",path:provenance.metadata.path},
          {title:"Original query URLs, sizes and hashes",path:ROOT+"/source.json"},
          {title:"Reproduction and current native rendering instructions",path:ROOT+"/README.md"}
        ]}
      ]]
    ],
    inputs:[provenance.original.path,provenance.metadata.path,ROOT+"/analysis.json"].map(entryFor),
    source_links:[provenance.original.path,provenance.metadata.path,ROOT+"/source.json"],
    figure_spec:ROOT+"/figures/specification.json",
    figures:[{id:"rating_counts",path:ROOT+"/figures/rating_counts.svg"}]
  };
  const recipePath=ROOT+"/report.recipe.json";
  generated[recipePath]=json(recipe);members[recipePath]=generated[recipePath];
  const entry={id:SOURCE_ID,title:recipe.title,kind:"document",role:"OBSERVED_CONTEXT",
    path:recipePath,uri:provenance.original.uri,vintage:"Final 2022 Integrated Report; original IR2008–IR2022 columns",
    publisher:provenance.publisher,source_format:"JSON",...identity(generated[recipePath]),
    metadata:{report_schema:recipe.schema,producer:analysis.edition,source_edition:analysis.scope.source_edition,assessment_units:summary.assessment_units,rating_cells:summary.rating_cells,cohort_basis:analysis.scope.cohort_basis,size_basis:analysis.scope.size_basis,needs_expert_review:true},
    companions:Object.keys(members).filter(path=>path!==recipePath).sort().map(entryFor)
  };
  const manifest={schema:"upstate.sources/v1",title:recipe.title,captured_at:provenance.captured_at,
    scope:"Fixed 2022 assessment-unit corpus in the two selected Savannah HUC8 basins; original eight overall-rating columns",
    notes:[analysis.scope.rating_interpretation,analysis.scope.size_basis,"Original government bodies are preserved verbatim with complete source URLs and hashes. Derived code and reports use the repository license; the original publisher's source terms remain with the retained metadata."],
    entries:[entry]};
  generated[MANIFEST]=json(manifest);
  return {analysis,files:generated};
}
