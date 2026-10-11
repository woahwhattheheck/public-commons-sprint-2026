# Sumter template library: operator guide

Use this workspace to prepare a selected library of solicitation and contract templates, manage project revisions and supporting files, review the resulting documents, and transfer an approved release into the prime's selected procurement platform. The original `template-library.mjs` compiler remains the document renderer. The workspace supplies the people, version history, attachments and handover around it.

This guide uses the October 2, 2026 RFQ and October 9 Addendum One listed in [Source documents](#source-documents). Its first-project companion is [INITIAL_PROJECT_PLAYBOOK.md](INITIAL_PROJECT_PLAYBOOK.md).

## Open the workspace

Use Python 3.12 or newer on Linux or another POSIX host, with Node 22 available as `node`. Both parts use standard libraries. From the source directory containing `template-library.mjs` and the `workspace` package, replace the path and name below with the intended local values:

```sh
python3 -m workspace --data /absolute/private/sumter-workspace init
python3 -m workspace --data /absolute/private/sumter-workspace bootstrap --name "Named administrator"
python3 -m workspace --data /absolute/private/sumter-workspace serve --port 8775
```

Bootstrap prompts privately for a password of at least 16 characters. Open `http://127.0.0.1:8775/` and sign in. Reuse the same data directory after restarting. With an existing TLS reverse proxy, add its exact browser origin to `serve --origin https://your-selected-host`; the application continues listening on loopback.

In Operators, create the intended accounts and choose administrator, author, reviewer or viewer. Assign their separate project roles in the project's Access tab. Project authors edit, reviewers record decisions and viewers read; administrators can operate every project. Changing an account's role or active state closes its previous sessions.

## Prepare the library

The Library starts with seven existing template families. Select and version the individual records actually needed for the project. The initial names are a configuration proposal: request for information, request for quotation, invitation for bid, request for proposal, addendum/Q&A, contract administrative record/renewal notice, and award/public summary. Addendum Q11 describes an initial requirement of at least five to seven configured templates; it does not specify those seven names or establish a permanent maximum. The RFQ's Documents section calls for unlimited templates. [RFQ, PDF p12; Addendum, Q11, PDF p6.]

Use New template or open a retained record to edit required fields, sections, clause keys, attachment prompts and proposed operator steps. Write each section as `Section heading | field_key` and include its field in Required field keys. Use New clause for actual source text. The Original source reference and retained library source file IDs stay with each record; Record source review approves its exact revision for local implementation use or requests changes. Retain the common agency, project title, solicitation ID, procurement contact and submission-instructions fields when defining a custom template. Save a changed template or clause as a new immutable revision of that record. Projects pin the selected revision of each record; they continue using those pins until an author deliberately adopts newer ones.

Keep clause text with its source document, page or section, and revision. A previous district document can be a source; Addendum Q15 accepts a library of the district's own solicitations, templates and clauses. A source attribution identifies where text came from. A named review decision records who accepted that exact revision for the present use. These are separate records. [Addendum, Q15, PDF p6.]

## Create a project and prepare its documents

Create one project for the actual solicitation or contract being prepared. Choose Solicitation or Contract record, the starting template, and Operator source content. In Authoring, select the required template revisions and enter that project's own fields. A deadline, supplier or contract identifier from another project should never arrive merely because the same template family was selected.

The browser Use option Operator source content corresponds to `operator` mode. Enter the companion JSON's values in Project content; the browser does not import that context file. The standalone compiler can read it directly. Use `operator` mode for real source and operator input. The original compiler's other mode, `demonstration`, is reserved for the supplied fictional example. A complete set of fields makes the document renderable; authority to issue it comes from the project's actual review and release decisions.

Draft each section with the relevant source open. A section lock belongs to a named user and section, so other operators can continue on the remaining sections. Save against the revision you reviewed. The workspace merges changes to separate sections from an earlier open revision. If another operator has changed the same section, it keeps that conflict explicit; reload the current content and reconcile the intended edit before saving. Use the recorded lock owner to arrange a handover; any administrative reassignment should remain attributable in project history. The per-user section requirement comes from the RFQ's Documents section. [RFQ, PDF p12.]

Choose exact clause revisions for the document. If a clause or kit is updated later, inspect its effect before adopting it. Adoption creates a new current revision and a new review opportunity. A previously frozen release continues to identify the content it actually contained.

## Attach the actual files

Use Library → Original library source files for reusable sources, or the project's Sources tab for project attachments and native evidence. Retain original file accepts up to 20 MiB and preserves its original filename, content type, hash, size, source/version reference and a new file ID. Select the precise attachment version for the document or project that needs it. An attachment prompt in a template is a place to supply a file; it is not an attached file by itself.

Describe each file's source and purpose in Source or version reference. In the Selected file register, check the intended file IDs, select Internal handover, Public copy, or Withheld from exports, choose optional template destinations, and Save file selection with a revision note. No template destination selection applies the attachment to the whole project. Select public-copy files deliberately for that release. Internal handover includes selected bytes in the Implementation ZIP. Public copy also includes them in the public ZIP when project-wide or linked to a publicly selected template. Withheld omits the bytes from both release ZIPs; the internal register still retains their metadata. The administrator's complete workspace transfer preserves every retained file for private recovery, including withheld files. A file already published by the issuer may be a useful source without belonging in every outgoing package. The RFQ supports direct attachments to both Solicitations and Contracts projects, and the addendum specifically confirms that documents must be attached in the system. [RFQ, PDF p12; Addendum, Q10, PDF p5.]

When replacing a document, add a new version and adopt it where intended. Preserve the old version for releases that already reference it. Releasing the project should package its selected versions, rather than every file ever uploaded to the workspace.

## Review, freeze and amend

Choose Preview rendered copy to run the original compiler on the saved project revision; save field edits before regenerating it. Read the generated document together with the selected clauses and attachment list. Unresolved fields and clauses identify the input still needed. Inspect submission wording, dates, selected template family, public-copy content and the underlying source changes as part of the actual procurement work.

In Reviews, complete missing fields and the indicated library reviews. Configure sequential review stages and assign named reviewers; an empty stage list of reviewers allows any assigned project reviewer or administrator. Approve stages in order on the same current revision using Record decision. Freeze implementation handover is available only when content, library reviews and all configured stages are complete. Repeating freeze for the same project revision returns the existing release. The frozen handover should preserve the rendered document, selected kit and clause revisions, source and attachment identities, review decision, and release identity. Keep the editable project available for the next change.

In Releases → Amendment and archive, choose Start amendment from a frozen release, the Exact parent release and a reason. This begins a new current revision from that parent's content. Select the affected document and addendum template as needed. Describe the changes, attach the new source version, and prepare an addendum under the same solicitation identity. Review and freeze that amended revision separately. Earlier releases continue to show what they contained; editing current source does not rewrite an issued addendum. Archive the project retains it; Reopen the current content for editing creates a new editable revision. Addendum One's amendment provision preserves terms that have not been modified. [Addendum, PDF p3.]

The contract template is an administrative record and renewal preparation aid. Use the executed agreement as its source for dates, obligations and attachments. An award summary requires the actual authorizing decision and selected supplier. A blank award field or absent executed contract is useful information; an operator should not manufacture either to complete a template.

## Transfer a release into the selected platform

Open the prime's agreed platform and environment using the implementer's authorized account. Use its supported template and document interface. Addendum Q10 does not establish a third-party integration requirement and does not confirm API availability, so native configuration can be performed through the platform's UI. [Addendum, Q10, PDF p5.]

In Releases, choose Record platform handover and the template in that exact frozen release. Complete the actual fields below; source mappings come from the original frozen selection.

| Browser field / retained key | What to record |
|---|---|
| Record type / `kind` | Actual native configuration (`native_configuration`) or a labeled Internal handover exercise (`internal_exercise`). |
| Platform / `platform`; Environment / `environment` | Actual product and workspace or tenant. |
| Native project ID / `native_project`; Module / `module` | Actual destination project identifier and module, such as Solicitations or Contracts. |
| Native template ID / `native_id` | Actual configured template identifier for this selected template. |
| Platform operator / `operator` | The person who performed the native work; the signed-in recorder is retained separately. |
| Field, clause, attachment and role maps | Every listed original field, clause key, selected file ID and review-stage ID mapped to its native destination or explicit retained handling. |
| Original native review or export / `evidence_file` | A retained project file showing the resulting configuration or review. Upload it through Sources first. |
| Decision / `decision`; Transfer and acceptance note / `note` | Record transfer, Accept reviewed transfer, or Request corrections, with the actual outcome and remaining work. |

The selected template form reopens the latest retained native identifiers and mappings. Recording another decision keeps the earlier one in its attributable history. Read the resulting native document and attachments with the intended operators before recording acceptance. Accept reviewed transfer requires a project reviewer or administrator and a retained project evidence file. Accepted handover ZIP requires the latest handover decision for every selected template to be accepted. It contains the original implementation ZIP, named handover records and original evidence files. A package containing an internal exercise retains that fact in its handover metadata. Local review and freeze prepare the work; the native destination records and result establish the transfer.

## Transfer and recover the private workspace

An administrator chooses Transfer complete workspace from Projects. It retains the database, named history, source bytes and frozen releases with a file manifest. Reusable passwords and browser sessions are removed; names and roles remain for attribution.

Use the same application source on the receiving POSIX host and a new data directory:

```sh
python3 -m workspace --data /absolute/private/restored-sumter restore --archive /absolute/path/sumter-workspace-transfer.zip
python3 -m workspace --data /absolute/private/restored-sumter reset-access --name "Existing administrator name"
python3 -m workspace --data /absolute/private/restored-sumter serve --port 8775
```

The `--data` option precedes the command. Restore verifies the manifest, file hashes and database references. Reset the original administrator's password privately. Reset other retained operators with the same `reset-access` command when access is needed; it preserves their existing roles. Review workspace and project assignments in the application. Keep the original data directory available until the receiving workspace is in use.

## Exact procurement boundaries

| Source | Consequence for this implementation |
|---|---|
| RFQ, PDF pp12–13 | The procurement covers a broader integrated system: vendors, solicitations, evaluation, contracts, insurance, public-works bidding, emergency information, transparency, training and operational controls. This template workshare serves its document/configuration component. |
| Addendum Q3–4 and Q6, PDF pp3–4 | Several access categories are answered with two users. The answers do not establish that there are only two distinct people. There is no stated test-environment requirement. |
| Addendum Q5, PDF p4 | The district does not request AI features at this time. Prepare source-based templates and clause selections. |
| Addendum Q2, PDF p3; Q8–9 and Q12, PDF pp5–6 | Hosting acceptance, legacy file/record volumes and workflow counts are not established by these answers. Record the actual environment and inventory when agreed. |
| RFQ, PDF p12; Addendum Q7, PDF p4 | The RFQ names Adobe Acrobat Sign. The answer that the district currently lacks a signature system does not remove that named capability. |
| Addendum Q16–18, PDF p7 | The addendum does not provide unconditional approval of uploaded bid-bond documents, answers differently delivered equivalent features as nonresponsive, and leaves the vendor-application-form question unanswered. Keep these matters visible in the prime's platform and bid work. |
| RFQ cover and Addendum Q19, PDF p7 | The stated offer deadline is October 23, 2026 at 11:00 a.m.; no time zone is printed there. The required route is a sealed package containing one hard copy and one USB copy. A workspace export or partner email is not that submission. |

## Source documents

Page references above are **PDF page numbers**. Addendum Questions 1–3 begin on PDF p3, whose printed number is 1.

- [Original RFQ, 20 pages](https://drive.google.com/file/d/1J_ubcwLrU-bdbGnvEHooerM4R7FrolVB/view), issued October 2, 2026. SHA-256: `90dbc9f5507696df56604185857f2b91709451a676ea486b1a659575e5a908c8`.
- [Addendum One, seven pages](https://drive.google.com/file/d/1p7WwFwUvGP8BD4wDqRiMb22hVqRzaRHC/view), issued October 9, 2026. SHA-256: `81c7b68cb1a071a746fdcee2dbd75a1b9648fa7ab49f08113f908ebcd36861b8`.
- [Issuer solicitation index](https://finance.sumterschools.net/procurement/solicitations) and [issuer addendum index](https://finance.sumterschools.net/procurement/addendums). Review subsequent issuer publications before final native configuration or bid preparation.
