import { QualityClient } from "./quality-client.mjs";
export class QualityFollowupClient extends QualityClient {
  qualityFollowupOverview() { return this.action("quality.followup.overview", {}); }
  compareSavedQuality(args) { return this.action("quality.followup.compare", args); }
  saveQualityComparison(args) { return this.action("quality.followup.comparison.save", args); }
  saveQualityFollowup(args) { return this.action("quality.followup.save", args); }
  qualityFollowupReport(args) { return this.action("quality.followup.report.read", args); }
}
