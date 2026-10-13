# A terminal-agent score needs a task, a budget and a verifier

*A practical guide to reading an agent result, investigating a regression and preserving a useful comparison.*

An agent completes a software task. Its output passes the checker. A newer model earns a lower score on the next run. Before deciding that the model became worse, ask what else changed.

Perhaps the second environment could not download a dependency. Perhaps the agent had fewer turns. Perhaps the checker now expects a different output. Each possibility deserves a different engineering response. A single percentage cannot tell you which one occurred.

A useful evaluation therefore needs a durable relationship between the assignment, the conditions of the attempt, the work produced and the rule that judged it. That relationship lets a research result become a decision: which behavior to train, which environment to repair and which comparison to repeat.

## Start with the unit of work

Harbor separates a task from a trial. A task defines the instruction, environment and verification; a trial is one attempt to complete it. A job groups trials for execution and analysis. That separation gives an evaluation a more precise vocabulary than “we ran the benchmark.” [1]

Consider an illustrative task: repair a command-line converter so it reads a supplied CSV and writes the required JSON. The instruction describes the output contract. The environment supplies the repository and input. The verifier checks the produced result.

Now imagine three unsuccessful trials. One changes the parser incorrectly. Another never starts because its environment fails. A third produces correct JSON, but a changed verifier reads the wrong path. All may reduce an aggregate score. They point to different corrective work.

Keep those outcomes in the original result set and label their causes separately. Silently discarding an infrastructure failure changes the denominator. Quietly treating a checker defect as model behavior changes the explanation.

## Freeze the conditions that affect the attempt

The phrase “same model, same task” leaves substantial room for variation. Record the actual model or checkpoint identifier, agent implementation, prompt configuration, tool definitions, task edition, environment image, network policy and applicable execution budgets.

Harbor exposes agent and verifier timeouts and environment network controls in its task configuration. Its current documentation also distinguishes a shared verifier environment from a separate one. These settings belong in the experiment record because they change what an agent can do and how its work is evaluated. [2]

For the converter task, network access could determine whether a missing library is installable. A shorter deadline could turn a correct but slow approach into a timeout. Neither observation is useless; each answers a particular question. The problem begins when the published comparison hides the changed condition.

A compact record might look like this:

| Record | Why retain it |
| --- | --- |
| Task edition and input identities | Establish the assignment actually attempted |
| Model, agent and tool configuration | Identify the system that acted |
| Environment and network policy | Explain available tools and dependencies |
| Time, token and turn budgets | Define the opportunity given to the agent |
| Original trajectory and output files | Preserve the work and decisions |
| Verifier edition, reward and error state | Explain the judgment |
| Aggregation rule and trial membership | Make the reported denominator inspectable |

This is a proposed experiment inventory, not a replacement configuration schema. Store it beside the original system outputs so someone can follow each reference without reconstructing the experiment from a slide.

## Keep training rewards separate from evaluation outcomes

A training signal can reward partial progress. A reported task-success metric can demand complete success. Both can be useful, provided the transition is explicit.

AfterQuery’s published Terminal-Bench work illustrates the distinction. It describes partial test credit during reinforcement learning, while the official task evaluation uses a binary outcome. It also distinguishes a 20-turn training budget without context summarization from its evaluation configuration. Those are material details when interpreting the reported improvement. [3]

Suppose our illustrative converter passes seven of ten checks. That fraction may help distinguish it from an attempt that passes only two. It does not establish that the required converter works. A failed check might cover the central input format rather than an optional convenience.

When comparing training experiments, retain the component rewards and their weighting. When reporting task success, state the success rule. A reader should be able to tell whether “better” means more complete tasks, more partial checks, lower cost, shorter runtime or a selected combination.

## Design the verifier around observable completion

Harbor’s Linux verifier entrypoint is `tests/test.sh`; it records numerical results under `/logs/verifier/`. Structured rewards can retain multiple named dimensions. That mechanism makes the output contract explicit, but the author must still choose what the verifier establishes. [4]

For the converter, inspect the actual output file and its behavior on the specified input. Decide which differences are meaningful: missing records, incorrect values, unstable ordering or invalid syntax. Prefer assertions connected to the assignment over details of one preferred implementation.

Also retain enough diagnostics to understand a failure. “Zero reward” is a result. “Output omitted the final input record” is a useful explanation. A verifier crash is a different event again.

A good review asks whether an agent can satisfy the checker while failing the user’s instruction, and whether a legitimate solution can fail because the checker assumed a particular implementation. These questions improve both the task and the training signal.

## Investigate a regression at the trial level

An aggregate tells you where to look. The retained attempt tells you what happened.

Harbor’s ATIF format represents agent interactions, including tool calls, observations and metrics. Its documentation explicitly separates an agent’s ability to write a trajectory from its ability to load one into a future session. Keep that distinction when describing replay or recovery capabilities. [5]

For each changed outcome, compare the initial environment, significant tool responses, produced files and verifier result. In the converter example, this can reveal whether the agent misread the format, ran out of time, encountered a missing executable or wrote a correct file that the checker missed.

Harbor’s local viewer opens a jobs directory and exposes trials, trajectories and generated files. The documented command is:

```bash
harbor view jobs
```

Use the viewer to inspect the retained output and download the relevant files. Its presence does not prove that every required artifact was collected; verify that the specific output needed for your investigation exists. [6]

The aim is to identify a corrective action tied to an observed event. Changing a prompt to compensate for an unavailable dependency may obscure an environment defect. Repairing the environment will not fix a model that consistently misunderstands the requested transformation.

## Version a corrected judgment without erasing the attempt

Sometimes the agent’s work remains useful and only the verifier needs correction. Re-executing the agent introduces another attempt, with another trajectory and potentially another output. That answers a different question from asking how the existing output should be judged.

Harbor provides regrading for recorded outputs. Its current requirements include readable source results and artifact manifests, an updated separate verifier, and every artifact the updated verifier needs. Task identity and, for multi-step trials, step compatibility also matter. [7]

If the converter produced its JSON and that file was retained, a corrected path check can evaluate the same output. If the output was never collected, regrading cannot recreate it. The retained files determine what can be recovered.

Preserve both judgments with their verifier identities and a reason for the correction. Report whether the headline number came from a new agent run or a new judgment of existing work. This makes a correction informative rather than destructive.

## Publish the comparison someone else can question

Harbor’s default aggregation averages rewards and counts missing rewards as zero; multidimensional rewards are aggregated independently. A custom metric may change the calculation. The reported result should identify the actual rule used. [8]

Alongside the headline, provide trial counts, error categories, relevant budgets and the conditions that differ between configurations. If repeated trials are used, explain how they contribute to the reported number. Keep cost and latency visible when they are part of the decision.

Tinker’s Harbor RL recipe demonstrates how the task format can be used in training and evaluation with a sandbox interface. Reusing a task format helps connect those stages; it does not make every training configuration equivalent to an evaluation configuration. Preserve both. [9]

A strong evaluation package lets a reviewer move from a score to a trial, from the trial to its exact output, and from that output to the judgment that produced the score. That is what turns an agent benchmark into an engineering instrument: a result that can guide the next change and survive a reasonable challenge.

## Sources

1. [Harbor — Core concepts](https://docs.harborframework.com/core-concepts).
2. [Harbor — Task configuration](https://docs.harborframework.com/tasks/configuration).
3. [AfterQuery — How We Improved Terminal-Bench 2.0 Scores by Over 5x Using Tinker and Harbor](https://www.afterquery.com/blog/how-we-improved-terminal-bench-2-with-tinker-and-harbor).
4. [Harbor — Verifier](https://docs.harborframework.com/tasks/verifier).
5. [Harbor — ATIF](https://docs.harborframework.com/agents/atif).
6. [Harbor — View job results](https://docs.harborframework.com/results/view-job-results).
7. [Harbor — Regrade](https://docs.harborframework.com/jobs/regrade).
8. [Harbor — Dataset metrics](https://docs.harborframework.com/datasets/metrics).
9. [Tinker — Harbor RL](https://tinker-docs.thinkingmachines.ai/cookbook/recipes/harbor-rl/).

*Technical source review: 13 October 2026. Prepared by TokenJunkieLabs with AI-assisted research and drafting. The converter task is an illustrative explanation; reported AfterQuery results remain attributed to its original publication.*
