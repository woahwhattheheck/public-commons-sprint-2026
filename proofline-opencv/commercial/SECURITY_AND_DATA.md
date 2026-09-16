# ProofLine security and data questionnaire

This is a pre-sale answer set for owner review. It describes the repository's **current source contract**, not a live customer deployment.

| Question | Current answer |
| --- | --- |
| Does ProofLine require live cloud deployment for a pilot? | No. Local/offline source/test/demo is the default pilot boundary. |
| Is AWS already deployed for a customer? | No evidence in this carrier. `live_aws_deployed=false`. |
| Does the evidence packet contain AWS credentials? | No by design; ambient credentials are not serialized. |
| Can the agent approve or reject product? | No. The authority map hard-falses approval and rejection. |
| Can the agent send email/chat or contact vendors? | No. External-send and vendor-contact authority are false. |
| Can it purchase, pay, invoice, or claim revenue? | No. |
| What does a receipt prove? | Deterministic packet integrity for the encoded source/data generation; not signer identity or who ran the pipeline. |
| What input classification does the sample permit? | `NON_SENSITIVE_SYNTHETIC`. A real pilot carrier permits only `BUYER_APPROVED_NON_SECRET` until a separately reviewed data agreement says otherwise. |
| What retention is promised? | Only the buyer/owner-supplied pilot value. The repo does not claim a production retention program. |
| Does it replace the buyer's QMS/AOI authority? | No. It is a supplemental evidence + human-review workflow. |
| Is image data used to train a model? | Not by this source path. The OpenCV inspection pipeline is deterministic image processing; no training action is defined here. |
| What happens on verification failure? | Fail closed; the packet cannot become a valid review proposal. |

## Before any live deployment

Owner and buyer must separately decide identity/access management, network path, encryption/KMS policy, log retention, incident response, regional/data-residency constraints, backup/recovery, cloud budget, and integration with existing QMS/MES/AOI systems. None of those are inferred as completed by this source carrier.
