# PeerGrade — evidence-checked formative feedback with Apertus

Original candidate for Hack Apertus 2026, Track 2A (Academia). This is executable open-source prebuild source, not a Devpost entry. Exact academic partner challenge matching in the official Getting Started Guide must be checked before treating it as a Track 2A submission. Other contest tracks, teams and published work are unchanged.

## What the program does

Academic instructors supply their own task prompt, anonymized student response and explicitly weighted rubric in JSON. The program sends an explicitly configured HTTPS OpenAI-compatible chat completion request to an Apertus deployment and asks for criterion-by-criterion suggested feedback. **No remote call is made** in offline mode. Each cited quote is checked as a literal substring of the actual student submission; criterion IDs, totals, ranges, duplicates, missing fields and evidence are validated. On failure the program writes an invalid_model_output report without scores. Every valid report is marked requires_human_review, and final_grade remains null: this is not automatic grading.

The output records the input digest, mode, model, proposed feedback and report integrity digest. A verifier checks those digests and quote evidence. Digests are tamper indicators, not cryptographic signatures or independent proof of model accuracy. Reports contain excerpts of student work: process only content you are authorized to submit to the chosen endpoint. Do not use real student or personal data for a public demo.

## Reproducible offline example (fully synthetic; no model execution)

From this directory:

    python3 peergrade.py run --assignment examples/assignment.json --offline-fixture examples/synthetic_model_response.json --output /tmp/peergrade.json
    python3 peergrade.py verify --assignment examples/assignment.json --report /tmp/peergrade.json
    python3 -m unittest test_peergrade.py

The synthetic fixture demonstrates strict response validation; 8/8 proposed points are fixture values and are **not an observed Apertus score**.

## Real Apertus-compatible endpoint

Set your own APERTUS_API_KEY environment variable and specify an HTTPS endpoint (no default external destination):

    python3 peergrade.py run --assignment examples/assignment.json --endpoint https://YOUR-APERTUS-PROVIDER.example/v1/chat/completions --model swiss-ai/Apertus-1.5-8B-Instruct --output /tmp/real-peergrade.json

The HTTPS endpoint must end in /chat/completions. Redirects are blocked, responses bounded to 128 KiB, and authentication is never written to output. Model selection is provided by operator; check the actual provider model identifier and access terms. No paid inference or service access is bundled.

## Research / judge packet outline

- Hypothesis: source-verified, rubric-constrained suggestions reduce unsupported evidence in automated formative feedback.
- Experimental design: instructor-authored synthetic or consented task/response pairs; rubric with locked IDs and ranges; compare human reviewer judgements for citation correctness, helpfulness, and false-positive abstentions.
- Metrics: verified quoted-evidence fraction; invalid-output rate; independent instructor agreement; latency/cost measured only during real authorized runs, disaggregated by language/task.
- Disclosure: do not describe fixture scores as achieved model performance or imply that quote substring verification establishes factual correctness, fairness, or educational validity.
- Submission gaps: select an actual Track 2A partner-specified academic challenge, authorize one entrant/team, execute and document actual Apertus 1.5 model calls on appropriate data, produce technical report/dataset/demo, verify official eligibility, and submit before October 16, 2026 12:00 CEST.

Official references:
- https://hackapertus.devpost.com/
- https://hackapertus.ch/online-hack
- https://hackapertus.notion.site/getting-started-guide-onlinehack

No third-party proprietary assets are bundled. Python 3 stdlib only. MIT licensed under repository defaults where applicable.
