# PLAN Phase 1 assessment workbench

Version 0.1.0 provides a local workspace for independent provider assessments, source-defined measurements, process maps, findings, recommendations and phased delivery planning.

## Install and open

Download `plan_phase1_workbench-0.1.0-py3-none-any.whl` from this directory. Python 3.10 or later is required. Install and launch:

```sh
python -m pip install --no-deps plan_phase1_workbench-0.1.0-py3-none-any.whl
plan-workbench --workspace ./plan-workspace --demo
```

Open `http://127.0.0.1:8769`. The runtime uses the Python standard library and makes no hosted-model calls. The wheel includes source, README, engine documentation, the license and original public demonstration inputs.

## Working product

- Retain original evidence files and map CSV/JSON operational exports into explicitly defined local cohorts.
- Review provider-specific measures with their denominators, cutoff, pending records, exclusions and channel overlap.
- Edit provider process maps, attach evidence to findings, and connect recommendations to prerequisites, effort, costs and elapsed delivery time.
- Record LSP consultation separately from PLAN's consolidated-use decision. Changed finding, evidence or consultation records identify the specific decision needing review.
- Export audience-specific reports and restore a complete private workspace with its original bytes and revision history.

The demonstration loads the actual public RFP and provider directory. Its fourteen published provider candidates remain unresolved against the RFP's thirteen assessment units until an operator supplies the actual participant roster. Original public counts, authored planning templates and imported operational observations retain distinct meanings.

The complete browser workflow and a fresh offline installation were exercised before release. The fresh installation restored the authored example project with its source-bound calculation and exact original files intact.

## Integrity and source notices

File size: **7,817,567 bytes**.

SHA256:

```text
9225d0da5d27c538e05817bb92fffa781a5239eba0094b0a28bf891451b41e0a
```

The reusable application is supplied under MIT. Bundled third-party public documents retain their original ownership and notices; see `SOURCE-NOTICES.md` and the source manifest inside the wheel. The original RFP is published at [LSNTAP](https://www.lsntap.org/sites/default/files/2026-09/plan-statewide-intake-improvement-project-phase-1-assessment-and-planning-rfp-issue-2026-09-24-1.pdf).
