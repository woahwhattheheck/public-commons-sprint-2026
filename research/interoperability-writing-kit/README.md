# Attribute-based access interoperability writing kit

TJLabs · edition 2026-10-13.1

Start with SAMPLE.md for the complete narrative and twelve authored WR reporting requirements. SCENARIO_PLAN.json contains twelve complete scenario designs. Copy RUN_RECORD.template.json for each actual execution, and use REPORT.template.md to compose the results. COMMENT_RESOLUTION.sample.csv demonstrates exact editorial issues and proposed changes; its ten entries remain proposed until an actual reviewer resolves them.

## Working procedure

1. Select the actual profile/contract, implementation versions, controlled fixtures and source editions. Complete each scenario's contract clause and environment-specific expectation before execution.
2. Assign a separate record ID to every execution. Preserve the pre-execution scenario edition and original expected behavior. Record actual authentication, authorization, enforcement and transport observations separately.
3. Retain native request/response evidence through the team's authorized storage route. Populate the run record from that evidence and identify any transformation or redaction.
4. A reviewer compares the exact assertion with the observation, records an assessment and reason, and leaves previous runs intact.
5. Compose the report, resolve document comments against exact editions, then open the final narrative and every distributed attachment in the recipient's normal tools.

## Vocabulary and templates

The JSON schemas named here identify this authored reporting convention; they are not OpenTDF request schemas. null fields are unfinished inputs. In particular, observed.obligations remains null until the actual response is observed; [] represents a response known to contain no obligations. not-executed and not-assessed preserve that state. A real execution gets its own observations and assessment.

The scenario plan contains design work, with no execution IDs assigned. The comment CSV contains worked editorial examples, with disposition proposed. Keep those examples separate from your programme's actual review log.

Use the full source register in SOURCES.md for the current primary references. The public sample addresses generic document and reporting work. The selected implementation/profile and the responsible technical team determine the actual protocol requirements.

## Recipient use

Both JSON files are UTF-8 and open in standard editors. The CSV uses quoted RFC 4180-style fields and CRLF rows; import all columns as text to preserve identifiers and editorial wording. The Markdown files retain complete content, ordinary tables and links. An HTML reader is supplied with the same source bodies and original download controls. Save that reader together with these editable members.

The producer opens and visually inspects the exact outgoing HTML, rendered Markdown/PDF if used, JSON and CSV. Use the reader at desktop and 390px; follow every section, download the files and reopen them. Source-level checks complement that actual receiving operation.
