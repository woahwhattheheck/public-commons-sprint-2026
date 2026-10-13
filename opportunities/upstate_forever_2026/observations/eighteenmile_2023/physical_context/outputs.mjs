import { writeCsv } from "./csv.mjs";
import { renderPhysicalFigures } from "./figures.mjs";
import { renderPhysicalReport } from "./report.mjs";

function physicalOutputs(result,inputManifest) {
  const figures=renderPhysicalFigures(result);
  const summary={
    schema:result.schema,counts:result.counts,
    methods:{
      interval_below:"[0, original lower quantitation limit)",
      interval_above:"(original upper quantitation limit, +Infinity) for blank reported result with original Present Above Quantification Limit condition",
      null_endpoint:"null lower is -Infinity and null upper is +Infinity within an existing interval; absent activity analytes also have null fields but no record ID",
      original_selectors:"SHA-256 plus 1-based data row excluding header; flow retains zero-based series/block/value index",
      paired_difference:"station_b minus station_a on the same original calendar date; original clocks and zones remain explicit",
      nitrogen:"same-activity unfiltered TKN + nitrate/nitrite; original methods checked",
      daily_context:"USGS02186702 parameter00060 statistic00003; annual2023 empirical midrank",
      associations:"Spearman average ranks for ties; routine activities only; exact numerical pairs only with exclusions counted",
      influence:"largest absolute finite endpoint for paired cohorts with at least10 observations; full cohort remains primary",
      seasons:"DJF,MAM,JJA,SON calendar-month cohorts from SWS-2023"
    },
    pair_summaries:result.pair_summaries,
    station_season_summaries:result.summaries,
    associations:result.associations,
    single_observation_influence:result.influences,
    input_files:inputManifest.files
  };
  return {
    "physical-result-index.csv":writeCsv(result.records),
    "activity-physical-context.csv":writeCsv(result.activity_table),
    "paired-activity-dates.csv":writeCsv(result.pairs),
    "paired-characteristic-contrasts.csv":writeCsv(result.differences),
    "paired-cohort-summaries.csv":writeCsv(result.pair_summaries),
    "station-season-summaries.csv":writeCsv(result.summaries),
    "within-station-associations.csv":writeCsv(result.associations),
    "single-observation-influence.csv":writeCsv(result.influences),
    "june-12-original-activity-context.csv":writeCsv(result.event_2023_06_12),
    "daily-gauge-flow-2023.csv":writeCsv(result.daily),
    "study-summary.json":JSON.stringify(summary,null,2)+"\n",
    ...figures,
    "physical-water-quality-study.html":renderPhysicalReport(result,figures,inputManifest)
  };
}
export { physicalOutputs };
