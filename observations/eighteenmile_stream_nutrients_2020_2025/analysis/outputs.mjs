import { writeCsv } from "./csv.mjs";
import { renderStreamStudy, renderStationContext } from "./report.mjs";

export function studyOutputs(result, basin) {
  return {
    "source-result-index.csv": writeCsv(result.records),
    "activity-nutrients-flow.csv": writeCsv(result.activities),
    "station-cohort-summaries.csv": writeCsv(result.summaries),
    "paired-station-contrasts.csv": writeCsv(result.paired_comparisons),
    "paired-nitrogen-components.csv": writeCsv(result.nitrogen_component_pairs),
    "agency-calculated-nitrogen.csv": writeCsv(result.agency_calculated_comparison),
    "daily-gauge-flow.csv": writeCsv(result.daily),
    "annual-flow-coverage.csv": writeCsv(result.flow_coverage),
    "study-summary.json": JSON.stringify({schema:result.schema,period:result.period,counts:result.counts,stations:result.stations,pair_summaries:result.pair_summaries,nitrogen_component_summary:result.nitrogen_component_summary,flow_coverage:result.flow_coverage,summaries:result.summaries},null,2)+"\n",
    "station-context.svg": renderStationContext(result.stations,basin),
    "nutrient-flow-study.html": renderStreamStudy(result)
  };
}
