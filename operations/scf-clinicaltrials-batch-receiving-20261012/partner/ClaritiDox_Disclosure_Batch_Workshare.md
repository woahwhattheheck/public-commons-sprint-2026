# ClaritiDox disclosure batch implementation
## Proposed partner workshare
**Prepared for:** ClaritiDox disclosure and technical delivery team  
**Prepared by:** TokenJunkieLabs  
**Proposed fixed fee:** USD 11,500  
**Delivery:** 15 business days from the agreed start, receipt of the selected input set and access to the receiving environment

## The delivery problem
A disclosure team receives a mixture of protocol XML, results XML, partial updates and source exports. Several client references can point to the same source document. Each update needs a clear relationship to the prior document, the current schema and a named reviewer’s decision. The useful handover is a complete, reproducible package that another operator can open and understand.

ClaritiDox publicly offers XML development, protocol and results disclosure, technology consultation, and services delivered with software partners. Its project-management services also include workflow and multisystem data entry. This proposal supplies the engineering for a defined receiving and review workflow within that existing service model. [Disclosure services](https://www.claritidox.com/clinical-trial-disclosure) · [Project management](https://www.claritidox.com/project-management)

## What TokenJunkieLabs delivers
The implementation covers one agreed portfolio and one receiving environment, with up to three agreed input variants and 500 original XML documents in the initial adaptation set.

1. **A receiving contract and source adapters.** Map the client reference, document role, schema edition, authoritative study identity and optional public-registry relationship. Retain the original bytes, including encoding, and keep separate client references when files are identical.
2. **An operator workbench.** Batch intake, source inspection, exceptions, original/candidate document selection, reviewer attribution, disposition queues, and repeatable export. The interface uses plain tables and forms, with details available alongside each source.
3. **Schema and update handling.** Use the selected original Protocol and Results schemas; present actual schema and source-reference findings. Retain reviewed legacy-field changes as separate candidates. Compose full or partial inputs through the original PRS component, with the base, incoming document and resulting candidate kept together.
4. **Source reconciliation.** Adapt explicit client-provided study links and up to twelve agreed typed comparison fields. Keep correlated repeated records—such as outcome measures and arms—aligned through declared record links. Provide an exception queue with source-specific explanations and reviewer decisions.
5. **Complete receiving outputs.** Deliver the batch register, exceptions CSV, exact source and candidate XML, inspection/change/composition records, selected schemas, operating guide and portable workspace. Restore the same batch into a fresh customer workspace and confirm the client references, document identities and decisions.
6. **Installation and handover.** Install in one agreed environment, walk two operators through representative work, and deliver source, configuration and a concise recovery procedure. Two consolidated correction rounds are included.

The initial source adaptation and comparison-field selection are fixed during the receiving-contract phase. The underlying batch engine supports larger batches; this workshare’s initial portfolio size is the engineering and acceptance scope.

## Work split
| Responsibility | TokenJunkieLabs | ClaritiDox |
|---|---|---|
| Input specification | Document the mapping and validate actual source examples | Supply representative formats, authoritative identifiers and document roles |
| Engineering | Build the adapters, exception views, export and receiving operation | Provide the selected installation environment and technical contact |
| Review policy | Implement the agreed dispositions and fields | Name the reviewer and define what each preparation disposition means |
| XML decisions | Retain originals, candidate changes and composition findings | Approve domain interpretations and the selected customer document |
| Acceptance | Deliver the replayable receiving package and address consolidated corrections | Review the agreed example set and acceptance outputs |
| Client and registry relationship | Support the defined technical handover | Own client communication, regulatory judgment and submission authorization |

## Delivery sequence
| Phase | Working days | Usable output |
|---|---:|---|
| Receiving contract | 1–2 | Approved document variants, identity rules, schema editions, comparison fields and acceptance sample |
| Source and XML adaptation | 3–6 | Original intake and schema handling for the agreed formats |
| Review integration | 5–9 | Client-reference queue, candidate selection, explicit comparisons and attributed dispositions |
| Customer receiving | 10–12 | Full export and fresh-workspace restore on the selected customer environment |
| Acceptance and operator handover | 13–15 | Consolidated corrections, operator walkthrough, source/configuration delivery and recovery guide |

Review responses are assumed within two business days of each consolidated review request. A missing agreed input or environment changes the corresponding delivery date; the updated schedule is recorded in the same workshare.

## Commercial terms for discussion
| Milestone | Fee | Invoice event |
|---|---:|---|
| Receiving contract and implementation start | USD 3,500 | Agreed scope and scheduled start |
| Integrated operator and agreed-format demonstration | USD 4,500 | Delivery of the reviewable operator and representative output set |
| Customer receiving and handover | USD 3,500 | Agreed acceptance outputs and operator handover |

Invoices are proposed due within 14 calendar days. The fixed fee includes implementation, one installation environment, two operator walkthroughs and two consolidated correction rounds. ClaritiDox supplies its existing infrastructure and authorized source access. Any additional paid infrastructure or third-party service is priced and agreed separately before use. The initial implementation is expected to require roughly 90–110 engineering hours across source adaptation, interface integration and customer receiving; the fee is tied to the delivered scope.

For 20 business days following handover, corrections to the delivered behavior against the agreed acceptance set are included. Additional portfolios, source formats, registry submission automation or ongoing operated services can be priced as a following workshare after the first deployment is accepted.

## Acceptance outputs
Acceptance uses the agreed representative input set and checks useful operating behavior:

- Every client reference remains identifiable, including separate references to identical input bytes.
- An operator can trace a selected candidate to its original document, reviewed change plan and any composition inputs.
- Schema, reference and source-reconciliation findings reach the appropriate review queue.
- Named decisions and reasons survive export and fresh-workspace receiving.
- The receiving package contains all original and candidate documents used by the selected batch, with a complete manifest.
- Two designated operators can repeat the documented intake, review, export and reopen workflow.

The accompanying technical demonstration uses three published PRS example files and preserves their original source and GPL-2 notice. The customer adaptation then applies the same retained workflow to ClaritiDox’s agreed source set.

## A current schema consideration
NLM’s 22 September 2026 notice identifies thirteen deprecated PRS XML elements whose values are accepted but ignored; it also describes the current replacements. The workbench exposes those occurrences for explicit reviewed changes and retains the selected original schema edition. [NLM source notice](https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html)

## Decision
Would a fixed-scope receiving and exception-review implementation support a current ClaritiDox client or software-partner project? The first useful discussion is with the person who owns technical delivery for XML and disclosure workflows. The attached input contract makes that discussion concrete.
