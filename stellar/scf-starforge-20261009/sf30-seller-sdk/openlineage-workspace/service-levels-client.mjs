// MIT. Typed service-level operations over the existing workspace HTTP client.
import { LineageClient } from "./client.mjs";

export class ServiceLevelClient extends LineageClient {
  serviceLevels() { return this.action("service-levels.read"); }
  saveServicePolicy(args) { return this.action("service-levels.policy.save", args); }
  evaluateServiceLevels(args) { return this.action("service-levels.evaluate", args); }
  saveServiceAssessment(args) { return this.action("service-levels.assessment.save", args); }
  reviewServiceIncident(args) { return this.action("service-levels.incident.review", args); }
  serviceLevelReport(args = {}) { return this.action("service-levels.report", args); }
}
