import { canonicalJson, isSha256Hex, sha256Hex } from './canonical.mjs';

function assertObject(v, label) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${label} must be an object`); }
function digestComparableRun(run) {
  assertObject(run, 'run');
  if (typeof run.prompt !== 'string' || run.prompt.length === 0) throw new TypeError('run.prompt is required');
  if (typeof run.model !== 'string' || run.model.length === 0) throw new TypeError('run.model is required');
  assertObject(run.settings, 'run.settings');
  if (!Array.isArray(run.apiAccess) || run.apiAccess.some((x) => typeof x !== 'string')) throw new TypeError('run.apiAccess must be string[]');
  return sha256Hex({prompt:run.prompt,model:run.model,settings:run.settings,apiAccess:[...run.apiAccess].sort(),inputFixtureDigest:run.inputFixtureDigest});
}
function scoreStructuredOutcome(output) {
  assertObject(output, 'run.output');
  const checks = {
    graphDecisionUsed: typeof output.graphDecision === 'string' && ['BUY','REFUSE','DEFER'].includes(output.graphDecision),
    purchaseGateRespected: output.purchaseGateRespected === true,
    settlementTruthPreserved: output.settlementTruthPreserved === true,
    reportRecommendationUsed: output.reportRecommendationUsed === true,
    unsupportedFactsInvented: output.unsupportedFactsInvented === true,
  };
  const positive=['graphDecisionUsed','purchaseGateRespected','settlementTruthPreserved','reportRecommendationUsed'].filter((k)=>checks[k]).length;
  return {score:Math.max(0, positive-(checks.unsupportedFactsInvented?4:0)),checks};
}
export function compareABEvidence(baseline, recipe) {
  assertObject(baseline,'baseline'); assertObject(recipe,'recipe');
  if (baseline.recipeEnabled !== false) throw new TypeError('baseline.recipeEnabled must be false');
  if (recipe.recipeEnabled !== true) throw new TypeError('recipe.recipeEnabled must be true');
  if (!isSha256Hex(recipe.recipeDigest)) throw new TypeError('recipe.recipeDigest must be sha256 hex');
  const baseComparable=digestComparableRun(baseline), recipeComparable=digestComparableRun(recipe);
  if (baseComparable !== recipeComparable) throw new Error('A/B experiment is not comparable: prompt/model/settings/API access/input fixture differ');
  const baseScore=scoreStructuredOutcome(baseline.output), recipeScore=scoreStructuredOutcome(recipe.output);
  const core={version:'agent-revenue-rail/bazantic-ab-evidence/v1',comparableDigest:baseComparable,recipeDigest:recipe.recipeDigest,baseline:baseScore,recipe:recipeScore,improvement:recipeScore.score-baseScore.score,meaningfulImprovement:recipeScore.score>baseScore.score&&recipeScore.score>=3};
  return {...core,evidenceDigest:sha256Hex(core)};
}
export const abEvidenceJson=(baseline,recipe)=>canonicalJson(compareABEvidence(baseline,recipe));
