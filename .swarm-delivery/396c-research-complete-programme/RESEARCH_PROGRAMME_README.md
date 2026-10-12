# Research complete programme

This package contains the operated Citation Review, Python/Analysis continuation, and Europe PMC literature-search product, with the complete source selected for each phase.

## Open the finished work

Start with COMPLETE_RESEARCH_PROGRAMME.json for the actual workspace and dossier identifiers and the native completion records. The three phase ZIPs contain their complete source and the original generated handovers. Their DELIVERY_MANIFEST.json or original native manifest identifies every delivered member.

Citation_Review_Complete_Receiving.zip contains the citation review, original retained Crossref document edition, browser output, and portable receiving artifacts listed in receiving/result.json.

Python_Analysis_Complete_Receiving.zip contains the continuation of that same citation dossier, its Python package, Analysis outputs, and the generated Excel workbook. The continuation preserves the original dossier revision.

The Europe PMC complete archive contains the two source query editions, full original result pages, the query-scope comparison, metadata review, RIS/CSV/JSON exports, report, browser work, portable workspace, and fresh receiving results. Read its original handover for the installed service and CLI entrypoints.

## Interpret the source examples

The Crossref example is the retained original source for DOI 10.1177/1758835919874651 and its associated update. The Europe PMC example compares a baseline query for DOI 10.1093/nar/gkad1085 with an expanded query that also includes DOI 10.1093/nar/gkad1088. The latter comparison measures an expanded query scope; both retained editions were captured on the same day.

A new commissioned literature programme supplies its own research question, agreed queries, reviewers, export conventions, and baseline. The supplied public examples can be opened and rerun immediately.

## Rerun the complete programme

Use Linux, Python 3.11 or newer with openpyxl 3.1.5, Node 24 or newer, util-linux flock, and the existing Playwright/Chromium runtime. The selected source contains the original dependency declarations.

Extract this archive into a new private working directory. Set these paths to the equipped runtime:

- RESEARCH_NODE: Node executable.
- RESEARCH_NODE_MODULES: an existing node_modules directory containing the selected Node dependencies, including re2js and Playwright.
- RESEARCH_PLAYWRIGHT_MODULE: optional absolute path to playwright/index.mjs or playwright-core/index.mjs.
- RESEARCH_CHROMIUM: the Chromium executable.

Then run:

    python3 -B run-complete-research.py

The runner verifies the three complete source kits before materializing them. It executes the original citation workflow, its original Python/Analysis continuation with a workbook, and the original Europe PMC parent driver against the same citation workspace and dossier. Each phase writes its own original result and logs. Successful completion writes complete-delivery/COMPLETE_RESEARCH_PROGRAMME.json and the three complete phase archives.

Use a fresh directory for an independent rerun. For an interrupted original operation, preserve its directory and use the original operation's receiving and continuation contract. The operation identifiers and selected input identities remain recorded alongside that operation.

## Source composition

kits/citation, kits/python, and kits/epmc each contain the complete source-envelope.json, original materializer with the pinned asset addition, and KIT_SUCCESSOR.json. The kits contain 286, 452, and 476 source files respectively. All 283, 449, and 473 original source bodies are retained unchanged, with the original Developer Portal HTML, browser module and stylesheet added from commit d60d878e9c7c042c58b26b9ec5aaee8e99ffd5a0.

The source materializer preserves an existing exact predecessor manifest before atomically advancing its canonical manifest. The source manifests drive the complete phase archives, so those three assets are included in delivery as well as execution.

The complete archive also includes the original source-addition packet and its composer for source maintenance. kits/ is sufficient to run the programme; the source repository is not required at runtime.

## Delivery structure

- Three complete phase ZIPs: finished customer workspaces, exports, source and their original receiving instructions.
- COMPLETE_RESEARCH_PROGRAMME.json: actual native completion and phase archive identities.
- run-complete-research.py: the complete programme runner.
- kits/: three complete pinned source kits.
- source-maintenance/: exact three-asset packet and its composer.
- PACKAGE_MANIFEST.json: exact membership, sizes and SHA-256 identities for this enclosing archive.

Source and generated material retain their included license and attribution notices.
