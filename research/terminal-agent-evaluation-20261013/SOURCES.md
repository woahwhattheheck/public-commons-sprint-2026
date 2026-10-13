# Editorial brief and claims register

## Brief

Audience: engineers and research leaders evaluating terminal agents; secondary audience: technical buyers trying to understand an evaluation claim.
Purpose: make an evaluation result actionable by preserving assignment, budget, output and judgment.
Format: practical research explainer, approximately 1,450 words before source list.
Voice: direct, specific, technically careful; the company and founder adaptations serve distinct editorial roles.
Public sources reviewed: 13 October 2026.
Prepared by TokenJunkieLabs with AI-assisted drafting and independent source review.

## Claims

| Article section | Supported factual assertion | Primary source | Treatment |
| --- | --- | --- | --- |
| Unit of work | Harbor task/trial/job distinction | https://docs.harborframework.com/core-concepts | Paraphrase |
| Conditions | Agent/verifier timeout and network/environment controls | https://docs.harborframework.com/tasks/configuration | Current documented configuration |
| Rewards | AfterQuery distinguishes partial RL reward and official binary evaluation, and discloses different training/evaluation budgets | https://www.afterquery.com/blog/how-we-improved-terminal-bench-2-with-tinker-and-harbor | Attributed historical publication; no new measurement |
| Verifier | Linux entrypoint and numerical reward locations | https://docs.harborframework.com/tasks/verifier | Documented contract |
| Trial review | ATIF interaction records; emitting and loading trajectories are separate capabilities | https://docs.harborframework.com/agents/atif | Documented capabilities |
| Viewer | harbor view jobs and retained-file inspection | https://docs.harborframework.com/results/view-job-results | Documented instruction, not an executed sample run |
| Regrading | Existing outputs, required artifacts and separate updated verifier | https://docs.harborframework.com/jobs/regrade | Preserve documented conditions |
| Aggregation | Default means and zero treatment for missing rewards | https://docs.harborframework.com/datasets/metrics | Default behavior, not universal metric |
| Training/evaluation | Tinker Harbor recipe uses task format and sandbox interface | https://tinker-docs.thinkingmachines.ai/cookbook/recipes/harbor-rl/ | Source-backed description |

The CSV-to-JSON converter, its three failure scenarios, experiment-inventory table and recommended investigative workflow are original explanatory examples and editorial analysis. They are not presented as an observed experiment or a result from AfterQuery.

## Review instructions

Check that source descriptions still match the selected release; preserve task and artifact conditions on regrading. Keep the distinction between partial reward and task success in all adaptations. Obtain founder approval before the proposed first-person viewpoint is posted. Replace publication-link placeholders only with the approved article URL.

