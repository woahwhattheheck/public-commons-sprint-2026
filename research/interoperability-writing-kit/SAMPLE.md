# Interoperability reporting for attribute-based data access

**Technical writing and working-template sample · TJLabs · 13 October 2026**

A useful interoperability report lets another team reconstruct the question that was asked, the conditions under which it was asked, and the response that supports the conclusion. “Access failed” is too broad. It can describe a valid policy denial, a rejected credential, an unavailable dependency, a damaged object, or a client that never reached the service.

The reporting task is to keep those meanings separate while making the result readable. This sample develops a practical reporting convention, a twelve-scenario plan, and an editable review record for a team evaluating attribute-based access. The requirements identified as **WR-01** through **WR-12** are proposed requirements for this reporting convention. Their identifiers belong to this sample.

## 1. Define the question before collecting the answer

Begin each scenario with an actor, a requested action, a resource, and a selected policy edition. Add the interface and implementation version used to express that question. The same person can make two different requests against the same object; the requested action therefore belongs in the scenario identity.

For an OpenTDF evaluation, the architecture documentation separates policy administration, authorization decisions, entity resolution, and key access. A result at one service does not automatically describe the complete client experience. The report should identify the boundary actually exercised: decision request, key access, or complete decryption. [1]

This distinction changes the writing. “The decision service returned the expected denial for the selected action” describes one observation. “The recipient could not recover plaintext through this client” describes another. If both were measured, record both and link their separate evidence. If only the first was measured, the report can still present a useful result without stretching it into an end-to-end conclusion.

**WR-01.** Each scenario record MUST identify its subject reference, action, resource reference, policy/configuration edition, implementation versions, and exercised interface.

Use stable references to controlled test identities rather than putting access tokens or real personal attributes into the report. Record enough configuration to reproduce the decision while keeping sensitive source material in its appropriate controlled location.

## 2. Separate the plan, observation, and assessment

Maintain three fields even when they appear repetitive:

- **Expected behavior:** the outcome required by the selected clause or agreed scenario.
- **Observed behavior:** the actual response and client behavior from one execution.
- **Assessment:** the comparison made by the reviewer, with a reason.

The expected field is written before execution. The observed field is populated from the actual run. The assessment can change after a review, but the earlier observation remains part of the record. This structure makes a disagreement actionable: a reviewer can challenge the interpretation without silently rewriting what the operator saw.

**WR-02.** Each execution MUST retain its original scenario edition, observed behavior, and referenced evidence independently of its assessment.

Consider a negative authorization scenario. A valid policy denial may be the expected result and therefore pass that scenario. A connection timeout also prevents access, but it does not establish that the requested policy decision occurred. Classifying both as “denied” loses the most important information.

## 3. Use two dimensions for result status

Give an execution a **condition** and an **assessment**. They answer different questions.

| Condition | Meaning in this reporting convention |
| --- | --- |
| response-observed | The specified interface returned a response that can be examined. |
| transport-failure | The intended response was not observed because communication failed. |
| dependency-failure | A required service or fixture failed, and the available evidence identifies that dependency. |
| execution-interrupted | The operator or execution environment ended the attempt before its conclusion. |
| not-executed | The scenario remains planned. |

An assessment is one of **pass**, **fail**, **inconclusive**, or **not-assessed**. A transport-failure condition can support a pass for a scenario explicitly testing transport recovery, but it cannot substitute for a policy-denial response in an authorization scenario. The selected assertion determines what is assessable.

**WR-03.** The reviewer MUST assess the stated assertion and MUST preserve the execution condition separately.

An inconclusive result is useful when the report states the exact missing observation and the action that would resolve it. “No correlated service response was retained; repeat this scenario with correlation capture enabled” is a production instruction. “Needs more testing” is not.

## 4. Treat authentication, authorization, and enforcement as different observations

A test account that cannot authenticate never reaches the same decision point as an authenticated subject that lacks the requested entitlement. Similarly, a decision response does not by itself prove how a separate enforcement component handled that decision.

OpenTDF's current authorization documentation distinguishes v1 and v2. The v2 decision flow considers entities, actions, resources, and policy rules; its current request structures and limits are documented separately from v1. A report should pin the selected interface and source revision so that a reviewer does not compare two different request contracts as though they were equivalent. [2]

**WR-04.** Authentication failure, authorization outcome, and enforcement outcome MUST be recorded in separate fields when they are exercised.

Record exact protocol status and the original structured response where available. A report-friendly category such as “authorization-denial” is a projection that accompanies that response. It does not replace the service's original status, enum, or error detail.

This approach is particularly useful for cross-implementation work. Each implementation can retain its native representation while reviewers compare a clearly defined common assertion.

## 5. Make a policy-change scenario explicit about time and retained state

“Revocation works” is an incomplete test objective. Specify what changed, where it changed, and when that change became observable. Identify whether the client made a fresh request, retained a previously issued credential, retained a previously released key, or already possessed plaintext.

These are different scenarios. Disabling a future authorization path does not erase information already delivered to a recipient. A report about fresh access after a policy change should say precisely that.

**WR-05.** A policy-change scenario MUST identify the original and changed configuration editions, the relevant change time, the request time, and the client state intentionally retained or cleared.

Use a test-specific clean client state to examine fresh access, and a separately labeled retained-state scenario where that behavior matters. Do not clear caches without recording it: the resulting observation belongs to the changed setup. Record clock sources and known uncertainty if an elapsed-time requirement is part of the assertion.

The report's conclusion should match the measured boundary. “A fresh request at time T was denied under configuration B” is useful and reviewable. It can be combined with other results when the team has a broader requirement.

## 6. Carry obligations through the report

Some evaluations require more than a bare allow/deny comparison. If the selected interface or profile returns obligations, preserve their complete original representation and record the enforcement component's handling of each relevant obligation.

An authorization response and the application's completion of its associated conditions are separate evidence. A report should show which part of that chain was exercised and which component owns the behavior being assessed.

**WR-06.** When an assertion depends on obligations, the record MUST retain the returned obligations and the corresponding enforcement observation.

Do not simplify unknown or unsupported obligations into an empty set. Keep a source-backed mapping between the selected contract, the scenario, and the concrete assertion. The companion plan includes an obligation scenario whose expected behavior is deliberately completed against the chosen profile before execution.

## 7. Preserve comparison identity across implementations

A useful comparison fixes the data object, policy, subject attributes, requested action, and intended interface. If implementation B needs a different request representation, keep the complete mapping and original request for each side. Equivalence is a documented engineering judgment, not a consequence of using similar field names.

**WR-07.** A cross-implementation comparison MUST preserve the original inputs and request/response representations for each participant and explain every intentional difference.

Keep the object identity independent of its display filename. A filename can be reused; exact bytes can distinguish editions. Where the team records digests, state the algorithm and the exact byte representation hashed. A digest links a record to its content; it does not establish the source's authority or whether a scientific, security, or commercial conclusion is correct.

Do the same for configuration exports and selected specification sources. A moving “latest” link is helpful for discovery, but a comparison needs the actual edition used.

## 8. Give every run its own place in the history

A retry is another execution of the scenario. Preserve the earlier run, its cause, and the relationship to its successor. If the scenario itself changes, issue a new scenario edition and explain the change before comparing results.

**WR-08.** A later execution MUST have a distinct run identifier and MUST reference any earlier run it supersedes; earlier observations MUST remain available.

Use this rule for partial results as well. A long scenario may establish several assertions before a later step fails. Preserve the completed observations and mark the unexecuted steps explicitly. Reporting a single undifferentiated red or green row wastes information that the receiving engineer could use.

Avoid an overall “interoperable” label unless the report defines its scope. A statement covering one object format, one policy profile, and two pinned implementations should carry those limits in the same sentence as the conclusion.

## 9. Turn reviewer comments into exact editorial work

A review log should identify the affected clause and edition, quote the smallest necessary disputed wording, explain the technical issue, and propose replacement text. Record the decision and its reason alongside the incorporated location. Keep deferred comments linked to their responsible owner and required input.

**WR-09.** Each resolved review comment MUST link its disposition to the exact affected document edition and incorporated location.

For example, replace “Access is always revoked immediately” with a requirement that identifies fresh authorization requests, the selected propagation interval, and the applicable configuration. If the interval has not been selected, keep that parameter visibly unresolved in the draft; do not turn an editorial guess into a protocol guarantee.

Separate normative wording from explanatory material. RFC 2119 defines requirement vocabulary, and RFC 8174 clarifies its special interpretation when the terms appear in uppercase. Use this convention deliberately and state its scope. [3][4]

**WR-10.** Normative terms in this sample's numbered WR requirements MUST be interpreted using BCP 14; ordinary explanatory prose is informative.

## 10. Deliver a report that survives handover

The receiving team should be able to open the narrative, find a scenario, follow it to the actual evidence, and determine why the reviewer reached the recorded assessment. Package the editable report, complete scenario plan, run records, source register, comment log, and permitted original evidence together.

**WR-11.** The handover MUST include a manifest of delivered members and identify any referenced evidence distributed separately, including the route and responsible custodian.

Redaction changes a distributed artifact. Give the distributable copy its own identity, preserve the relationship to the controlled original, and explain which review questions the recipient can still answer. Keep secrets, live credentials, and sensitive payload content out of ordinary correspondence and public examples.

**WR-12.** Every redacted or transformed evidence artifact MUST retain an explicit relationship to its original and a description of the transformation.

The final report should lead with the decision the reader needs to make, then show the observations supporting it. The attached templates make this practical: twelve complete scenario designs, one run-record structure, a full report skeleton, and a comment-resolution table travel with this sample. They give the next writer and engineer the same starting point.

## Sources and application

1. OpenTDF, [Architecture](https://opentdf.io/architecture), retrieved 13 October 2026. Used for the service-boundary description.
2. OpenTDF, [Authorization Service](https://opentdf.io/components/authorization), retrieved 13 October 2026. Used for the current v1/v2 distinction and decision dimensions. Select and retain the exact implementation contract for an execution.
3. IETF, [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html). Requirement vocabulary.
4. IETF, [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html). Uppercase requirement-keyword interpretation.

The WR requirements, scenario designs, reporting vocabulary, and editorial examples are authored proposals in this sample. An adopting team can revise them under its own document and profile authority.
