# Install the standards workbench 0.4.1

The standards workbench is a local application for bilingual drafting, source review, consultation, publication and delivery accounts. Version 0.4.1 includes the complete offline consultation and member-ballot exchange, the prime-application desk, and the complete native ballot/application corrections with the maintained source-edition receiver.

## Download and open

Download [scc-standards-workbench-0.4.1-source.zip](./scc-standards-workbench-0.4.1-source.zip). Python 3.10 or newer is required. Install the source ZIP and open the bilingual review example:

```sh
python -m pip install ./scc-standards-workbench-0.4.1-source.zip
standards-workbench --workspace ./review-workspace --review-demo
```

Open the local address printed by the command, normally `http://127.0.0.1:8773`. Keep the command running while using the operator application. Stop it with Ctrl+C, then use the same command and workspace path to resume.

The source package contains the Python application, browser assets, public example sources and operating guides. Its declared document dependencies are `python-docx==1.2.0`, `reportlab==4.4.9`, `pypdf==6.20.1` and `pdfplumber==0.11.10`; pip installs them with the application. Keep an available Python runtime and the same dependency wheels when preparing an offline installation. Pip supports an existing wheel directory through its ordinary `--no-index --find-links` options.

If the default port is already in use, choose another local port:

```sh
standards-workbench --workspace ./review-workspace --port 8774
```

## Choose a working project

The review example contains ten paired English/French clauses and eight worked cases based on the retained public Statistics Canada materials. It prepares a frozen edition, a consultation exercise and a recipient packet with bilingual instructions. Repeating `--review-demo` opens the retained project and preserves the work subsequently recorded in it.

Use the workspace path consistently: the application's SQLite file stores projects, original files, revisions and saved request results in that directory.

| Start command | Project to open |
| --- | --- |
| `standards-workbench --workspace ./review-workspace --review-demo` | Public-source bilingual consultation example with a ready reviewer packet |
| `standards-workbench --workspace ./draft-workspace --demo` | Public municipal drafting example |
| `standards-workbench --workspace ./exercise-workspace --authored-demo` | Separate authored committee and financial exercise |
| `standards-workbench --workspace ./project-workspace` | Existing projects in that workspace, or **New project** |

Use a separate workspace for practice when you want its records kept apart from a working engagement. The authored exercise labels its example members, costs, responses and remittances. The public-source example preserves the original paired source rows and their representation.

## Complete a consultation exchange

1. Open the saved project and select **Consultation receiving**. Prepare or select a packet tied to a frozen edition and consultation, with the intended English/French instructions and return route.
2. Download the recipient ZIP, extract it, and open `reviewer.html`. Read the paired clauses and original case rows, save a portable draft, then export the completed JSON response. **Save readable copy** also produces an HTML copy of the comments and proposed wording.
3. In the operator application, preview and receive that original JSON file. The workspace retains the complete returned bytes, its packet binding and the resulting comments.
4. Review proposed wording against the frozen and current clauses. Apply an explicit amendment where appropriate, freeze the successor edition, and record the disposition and its rationale against the chosen resolution wording.
5. For a corrected response, select its actual predecessor and review the changed entries. Unchanged decisions can be adopted explicitly; the earlier response and decisions remain available.
6. Export the selected respondent reply or publication appendix. Retain a complete private continuation when transferring or backing up the operating project.

The recipient page works offline. Its complete English/French `READ-ME.txt` travels in the packet. Browser file-storage restrictions are handled through the portable **Save draft** and **Open draft** controls. The return instructions identify the agreed channel for sending the exported response.

The operator queues keep the original return, current clause, proposed wording and disposition together. Filters and paging support longer responses. A pending save retains its original request identity after an uncertain connection result; **Retry original pending save** recovers that same operation.

Read the [consultation guide](../CONSULTATION.md) for the complete recipient and operator exchange, the [workbench guide](../README.md) for drafting and delivery accounts, and the [publication guide](../PUBLICATION.md) for editable handovers. The [API contract](../API.md) and [portable receiving guide](../delivery/CONSULTATION-RECEIVING.md) describe the existing integration and complete saved-project receiving interfaces.

## Export and restore

List the saved projects to obtain the actual project ID:

```sh
standards-workbench --workspace ./review-workspace --list
```

Create a full operating backup and restore it into a new workspace:

```sh
standards-workbench --workspace ./review-workspace \
  --export PROJECT_ID --audience private_restore --output ./project-private.zip

standards-workbench --workspace ./restored-workspace \
  --restore ./project-private.zip --list

standards-workbench --workspace ./restored-workspace
```

Replace `PROJECT_ID` with the value printed by `--list`. A complete private continuation contains the original files, full state, revision history, review records and saved request results. Restoration verifies the archive, original file identities, project state and history before adoption. Restoring an identical project reopens it; a different state under the same project ID is presented as a conflict.

Recipient packets, respondent replies and selected edition handovers contain the material chosen for that audience. Use `--audience private_restore` when the purpose is to resume the whole operating project.

## Upgrade an existing workspace

Stop the running operator application. Export and retain a complete private continuation using the current installation, then install the 0.4.1 source ZIP:

```sh
python -m pip install --upgrade ./scc-standards-workbench-0.4.1-source.zip
standards-workbench --workspace ./review-workspace
```

Use the original workspace path when resuming. Earlier workspace histories and frozen records remain available; the consultation collections are compatible with earlier saved projects and are recorded explicitly when the project is next changed. Keep the pre-upgrade private export as the recovery copy.

## Release contents and completed receiving

The complete 0.4.1 source package includes all 70 selected application files, guides, original public inputs and `SOURCE_RELEASE.json`. The manifest identifies every selected member so the extracted contents can be compared with the chosen release.

The retained 0.2.3 receiving completed the original recipient-to-operator journey: draft and response export, initial return, duplicate and corrected return, explicit adoption of unchanged decisions, clause amendment, successor edition, respondent reply, publication and full project restoration. The reviewed case includes forty desktop/phone views and paired English/French Word and PDF publications. Its authored responses remain part of that example project.

The 0.4.1 [source and receiving record](./RECEIVING-0.4.1.md) identifies the exact corrected native source and the actual completed ballot/application course. That operation preserved its original closed ballot and requests, restored the full private case independently, and completed its producer inspection of the PDF, Word, HTML and CSV outputs. The following source-edition receiver preserves those native results while retaining separate immutable indexes for new source presentations; its affected continuation remains with the same original producing operation.

The [prime-application guide](../APPLICATION-WORKBENCH.md) covers source intake, explicit reviewer decisions, original-form rendering and private application continuation. The [individual-member guide](../BALLOT-RECEIVING.md) covers the ordinary offline ballot, original returns and corrections. Keep the owner's complete rendered-product instructions in the accompanying AGENTS.md and CLAUDE.md: run the exact outgoing product, operate its important controls, inspect desktop and narrow states, open every attachment and usable archive member, and reopen the saved delivery before claiming it client-ready.

## Previous immutable packages

The earlier [0.2.0 source archive](./scc_standards_workbench-0.2.0-source.zip), [0.1.1 wheel](./scc_standards_workbench-0.1.1-py3-none-any.whl), [0.1.1 source archive](./scc_standards_workbench-0.1.1-source.zip) and [original 0.1.1 installation record](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/c58b2b78a0becfb2d7cc182a94d9423ac66b66d0/scc-standards-workbench-2026/releases/INSTALL.md) remain available for reproducing those editions. The complete [0.4.0 source archive](./scc-standards-workbench-0.4.0-source.zip) and [0.3.0 source archive](./scc_standards_workbench-0.3.0-source.zip) are also retained. Use the 0.4.1 package above for the current selected application.
