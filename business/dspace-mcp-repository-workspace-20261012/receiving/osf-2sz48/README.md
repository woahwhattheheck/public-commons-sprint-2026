# Original OSF 2sz48 receiving continuation

This continues the original OSF institutional-transition operation against one small, public research project. It uses the production OSF transition workspace and preserves every original project, file, version, author and source-response identity.

## Source and attribution

- Project: https://osf.io/2sz48/
- DOI: https://doi.org/10.17605/OSF.IO/2SZ48
- Title: *Impact of information presentation on interpretability of spatial hazard information: Lessons from a study in avalanche safety—Data and Code*
- Authors: Katie Fisher, Pascal Haegeli and Patrick Mair.
- Publisher paper: https://nhess.copernicus.org/articles/21/3219/2021/nhess-21-3219-2021.html
- License: Creative Commons Attribution 4.0, as retained in the project's original OSF license response. https://creativecommons.org/licenses/by/4.0/
- Publisher reference https://osf.io/myfp2/ remains a distinct earlier registration reference. It is not imported as a component of this project.

The original input contains 43 complete source-response descriptors, including the project, contributor and license records, folder inventory, all 17 version records, five complete activity pages (41 unique events), and current plus all three historical home-wiki contents. The source has no child or linked projects. The 17 selected file versions total 397,352 publisher-declared bytes. Each file has its original version link, size, SHA-256 and MD5.

These are historical research materials used to operate a real-source receiving demonstration. They do not establish an accepted institutional order, an acquired customer cohort, or ongoing work by these researchers.

The input records how each response was received. The early JSON documents were retained from the rendered original API response; later wiki and activity responses were received as complete UTF-8 bodies. The API's returned version metadata varies between those original responses and remains unchanged. Historical wiki metadata sizes exceed their actual received content lengths by 41 bytes in each of the three versions; both original values are retained without rewriting content or inferring a cause.

## Same original operation

Operation identity: OSF-4SCIENCE-TRANSITION-RECEIVING-E9B2-20261012

The full institutional operator is at the parent workspace directory. Its original files, immutable mapping/review history, native DSpace preparation and portable receiving are documented in ../../OSF_TRANSITION.md.

Run from that workspace's source directory with Python 3.10 or newer:

    python3 scripts/receive_osf_2sz48.py \
      --input receiving/osf-2sz48/original-intake.json \
      --directory /absolute/owned/original-source-intake

Use the same directory after interruption. The collector takes one exclusive local operation lock, binds the exact input SHA, and checks complete retained files before making any request. It downloads only missing original versions through their exact observed links.download URLs. It permits ordinary HTTPS redirects to the original storage service, sends no credential, and does not rewrite provider-specific revision or version selectors.

Every file must match all three original checks: byte length, SHA-256 and MD5. Complete bytes are staged, synced and published exclusively; a different existing file is preserved and rejected. Original failed response bodies and attempt history remain available. A failed request terminates the invocation; the next authorized continuation resumes that same operation instead of starting a second cohort.

After all 17 versions have been received, the collector retains one final original node response and one final metadata response per file. Those before/after records let the production inventory expose source changes. Already saved final responses are reused on restart, so the completed source manifest remains byte-stable.

Success writes:

- original-input.json: exact bound source input.
- original-intake.json: complete operation receipt, accepted files, original attempts and final checks.
- files/<publisher-sha256>.bin: full original version bytes.
- checks/<sha256>.json: unchanged final metadata response bodies.
- source-manifest.json: directly importable production source with relative original byte paths.

The catalog in Git is complete metadata; it does **not** claim the 17 binary files have already been received. Only the successful collector receipt and the production decoder establish that completion.

## Complete operator continuation

Node 24 is required by the original SQLite workspace. Assemble the verified relative-file manifest into the production self-contained source:

    node scripts/osf_cli.mjs assemble-source \
      --source /absolute/owned/original-source-intake/source-manifest.json \
      --output /absolute/owned/original-source-intake/original-source.json

Import into the original receiving workspace using one retained request:

    node scripts/osf_cli.mjs import \
      --workspace /absolute/original/receiving-workspace \
      --source /absolute/owned/original-source-intake/original-source.json \
      --name "Avalanche study — original OSF project and every file version" \
      --actor "Receiving operator" \
      --request /absolute/owned/requests/osf-2sz48-import.json

Then use the returned source identity in template and the mounted OSF page to select continuing work and its explicit destination. Reuse the original retained DSpace profile, collection and item captures; do not acquire a replacement institution snapshot or repeat its original completed publication cohort.

The original mapping can keep records on OSF without a DSpace destination, or prepare a reviewed DSpace draft against an explicitly selected original capture. Native preparation is distinct from execution. A public research-source download never authorizes a repository write, contributor change, rights change or published archive.

Review the exact mapping/source hash, prepare its retained records→metadata→files phases where applicable, inspect the original source and target conflicts, and create the complete portable handover. Use the existing preview, receive, read and export commands to reopen it into a separate explicit destination while retaining the original workspace. Every command's request file must remain available for its same-ID resume.

The browser and CLI retain full source bytes, historical file versions, selected native plan and execution notes. They preserve later staff edits and failed original requests; keep those histories in the final delivered workspace and handover.
