// MIT. Dataset quality operations through the existing workspace HTTP owner.
import { LineageClient } from "./client.mjs";

export class QualityClient extends LineageClient {
  qualityOverview(options = {}) { return this.action("quality.overview", options); }
  qualityHistory(datasetKey, options = {}) { return this.action("quality.history", { ...options, datasetKey }); }
  saveQualityRule(args) { return this.action("quality.rule.save", args); }
  evaluateQuality(options = {}) { return this.action("quality.evaluate", options); }
  saveQualityEvaluation(args) { return this.action("quality.evaluation.save", args); }
  saveQualityDisposition(args) { return this.action("quality.disposition.save", args); }
  qualityReport(options = {}) { return this.action("quality.report.read", options); }
}
