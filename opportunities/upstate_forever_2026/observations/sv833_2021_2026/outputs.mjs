import {writeCsv} from "./csv.mjs";
import {renderSV833Figures} from "./figures.mjs";
import {renderSV833Report} from "./report.mjs";
export function sv833Outputs(result,inputManifest) {
 const figures=renderSV833Figures(result);
 const summary={
   schema:result.schema,counts:result.counts,station:result.station,
   methods:{
     result_identity:"610 unique original ResultIdentifiers; original narrowResult, default profile, Activity and ResultDetectionQuantitationLimit exports reconciled",
     activity_weighting:"One agreeing interval per original ActivityIdentifier and characteristic; all repeated original ResultIdentifiers retained",
     below_limit:"[0, exact original lower quantitation limit), nonnegative concentration support",
     above_limit:"(exact original upper quantitation limit, +Infinity)",
     nulls:"An existing measurement with null upper has unbounded upper support. A missing measurement has no result IDs; CSV nulls are empty cells.",
     summary_bounds:"Arithmetic means and medians of lower/upper supports; open endpoints retained. Sampled activities only.",
     nitrogen:"Same-activity unfiltered as-N Kjeldahl nitrogen plus nitrate/nitrite. Ammonia as NH3 retained separately.",
     ph_screen:"Original pH 724 retained; explicit [0,14] study screen excludes only that pH value from descriptive calculations",
     associations:"Exact-pair Spearman average ranks for ties; coverage denominators explicit",
     interval_order:"Conservative Kendall tau-a score bounds over all activity pairs; ties zero, unresolved support [-1,1]; no probability or confidence interpretation",
     influence:"Full cohort primary. All-series largest finite upper endpoint omission and named 2025 nitrogen event omission reported alongside it.",
     source_rows:"One-based data rows excluding CSV header; exact original paths and SHA256 retained",
     assessment:"Retained exact record extract with complete upstream source-bank identity and publisher document references"
   },
   yearly_coverage:result.yearly_coverage,summaries:result.summaries,
   exact_associations:result.associations,interval_associations:result.interval_associations,
   weighting_effects:result.weighting_effects,influences:result.influences,
   nitrogen2025_influence:result.nitrogen2025_influence,
   quality_flags:result.quality_flags,agency_nitrogen:result.agency_nitrogen,
   assessment_context:result.assessment_context,input_files:inputManifest.files
 };
 return {
  "original-result-index.csv":writeCsv(result.records),
  "activity-characteristic-measurements.csv":writeCsv(result.measurements),
  "activity-water-quality.csv":writeCsv(result.activity_table),
  "repeated-original-results.csv":writeCsv(result.duplicates),
  "annual-seasonal-summaries.csv":writeCsv(result.summaries),
  "sampling-coverage.csv":writeCsv(result.yearly_coverage),
  "exact-pair-associations.csv":writeCsv(result.associations),
  "interval-order-associations.csv":writeCsv(result.interval_associations),
  "interval-order-pairs.csv":writeCsv(result.interval_pairs),
  "original-row-weighting-effects.csv":writeCsv(result.weighting_effects),
  "single-observation-influence.csv":writeCsv(result.influences),
  "quality-screening.csv":writeCsv(result.quality_flags),
  "agency-nitrogen-reconciliation.csv":writeCsv(result.agency_nitrogen),
  "physical-source-count-reconciliation.csv":writeCsv(result.source_census),
  "highest-turbidity-activities.csv":writeCsv(result.top_turbidity),
  "study-summary.json":JSON.stringify(summary,null,2)+"\n",
  ...figures,
  "sv833-water-quality-study.html":renderSV833Report(result,figures,inputManifest)
 };
}
