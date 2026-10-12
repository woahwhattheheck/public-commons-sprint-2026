# 360Giving publisher edition review

Prepare a complete 360Giving publisher file for the original NDJSON workspace and native file jobs. The operator receives the original package, source and registry identity, official schema results, a complete grant inventory, an editable review, exact-value native mapping and a portable receiving edition.

The profile uses the original NDJSON engine for immutable source intake, projection, queries, keyed comparisons and customer project receiving. The domain adapter adds the 360Giving package and publisher review steps.

## Installed publisher command

The maintained Starforge distribution includes this entire profile: the publisher program, local review, exact source examples, official schemas, attribution and complete receiving workflow. Use `starforge dataset-360giving` with the same arguments as `publisher.py`. The `example` subcommand runs the original complete two-fund workflow.

Select Python 3.11 or later with `jsonschema>=4.23,<5` and `referencing>=0.35,<1` installed, as declared in this profile's `requirements.txt`. The command uses `SF30_NDJSON_PYTHON` when set, or `python3` (`python` on Windows). A leading `--python` selects an explicit executable for this invocation.

~~~sh
starforge dataset-360giving --python /absolute/venv/bin/python prepare \
  --source /absolute/publisher-original.json \
  --source-url https://publisher.example/grants.json \
  --registry /absolute/original-registry-record.json \
  --capture /absolute/acquisition.json \
  --out /absolute/publisher-edition

starforge dataset-360giving candidate \
  --workspace /absolute/publisher-edition \
  --decisions /absolute/review-decisions.json \
  --out /absolute/publisher-candidate

starforge dataset-360giving export \
  --workspace /absolute/publisher-edition \
  --decisions /absolute/review-decisions.json \
  --candidate /absolute/publisher-candidate \
  --out /absolute/publisher-receiving.zip

starforge dataset-360giving receive \
  --file /absolute/publisher-receiving.zip \
  --out /absolute/second-operator-edition

starforge dataset-360giving example --out /absolute/scvo-publisher-work
~~~

Set `SF30_NDJSON_PYTHON` once when all commands use the selected environment, or supply `--python` before the subcommand each time. Standard input, output and errors pass through to the original Python program, including the complete JSON result and its exit status. `prepare --help` and `example --help` show the original arguments.

Use `starforge registrations --command dataset-360giving` to inspect this command's original source registration. The installed review and receiving packages carry their own complete Python operator, so a second operator can continue from the exported edition.

## Receive the source

Use Python 3.11 or later with the dependencies in requirements.txt. Retain the original HTTP response and decoded JSON when acquisition uses compression. Point --source at the decoded original package and --transport at the original transport file. The optional capture JSON contains the original acquisition metadata.

The registry file is the complete matching dataset record from https://registry.threesixtygiving.org/data.json . Its distribution.downloadURL selects the publisher file. Registry modified describes registry metadata; it is kept with that record.

~~~sh
python publisher.py prepare \
  --source /absolute/publisher-original.json \
  --source-url https://publisher.example/grants.json \
  --registry /absolute/original-registry-record.json \
  --capture /absolute/acquisition.json \
  --transport /absolute/original-response.bin \
  --out /absolute/publisher-edition
~~~

Open publisher-edition/review.html. It is a complete local review with grant search and pagination, original JSON for every grant, schema results, review questions, saved browser drafts and downloadable decisions.

The command reads every grant. It preserves the original package bytes and numeric token spelling in the generated grant JSON Lines. Unknown grant properties remain in the full original-grant column. The source is decoded as UTF-8, with duplicate members and non-finite numbers reported as errors.

## Schema and publisher questions

The original pinned 1.4.3 package schema currently references the 1.4.2 grant schema. Both original resources are resolved locally and verified against their Git blob identities. The 1.4.3 grant schema is retained alongside them. Validation uses Draft202012Validator with format checking and exact decimal values; it does not fetch schema references at runtime.

Schema errors identify the complete grant path and official keyword. Publisher questions are presented separately: a date sequence needing context, an identifier scheme needing confirmation, a mismatch with the registered grant prefix, or duplicate grant identities. These questions do not supply replacement facts. The profile sums awarded amounts separately for each original currency.

An original package may contain only grants. The review offers package metadata already present in the retained registry: publisher, licence, title and source locations. These fields are added only when selected in the operator's decision file. Existing different package metadata is retained until the publisher supplies an explicit correction.

## Use the existing native engine

The prepared directory contains grants.ndjson and mapping.json. The mapping preserves monetary values as exact strings and exposes matching state columns for optional data. It retains all organisation, programme and location arrays and the complete original grant. Native equality filters, date ranges, ordering and the grant identifier key remain available.

~~~sh
starforge dataset-ndjson --workspace /absolute/native-workspace init
starforge dataset-ndjson --workspace /absolute/native-workspace source \
  --file /absolute/publisher-edition/grants.ndjson --label "Original publisher edition"
starforge dataset-ndjson --workspace /absolute/native-workspace plan \
  --file /absolute/publisher-edition/mapping.json
starforge dataset-ndjson --workspace /absolute/native-workspace build \
  --source SOURCE_ID --plan PLAN_ID
starforge dataset-ndjson --workspace /absolute/native-workspace query \
  --build BUILD_ID --params '{"where_currency":"GBP","sort":"grant_id","limit":"50"}'
~~~

Use the exact identifiers returned by the preceding commands. For an active browser console, operate its existing HTTP or MCP connection instead of opening a second workspace process. The existing complete file-job application can receive these same two prepared files and an optional real baseline, then return its full native project and review package. Select sourceFormat=ndjson for grants.ndjson. The same job accepts the original JSON package with sourceFormat=json-array and sourceArrayPointer=/grants, retaining that envelope as a sealed original input; the profile's mapping applies to each selected grant.

Separate funds remain separate datasets. Compare actual editions of the same dataset under the same mapping. Reopening or refetching an unchanged publisher file correctly produces an unchanged comparison.

## Record and apply an operator decision

Download a decision file from the review. Its sourceSha256 selects the exact original edition. Each changed grant field carries the original grant identifier, JSON pointer, expected JSON text, replacement JSON text, reason and publisher/source reference. Numeric replacements remain text until the exact native JSON parser reads them.

~~~sh
python publisher.py candidate \
  --workspace /absolute/publisher-edition \
  --decisions /absolute/review-decisions.json \
  --out /absolute/publisher-candidate
~~~

The candidate command preserves the original package and review. It creates candidate-package.json, exact grants.ndjson, the original mapping, the complete entered decisions and a candidate identity. It checks selected original values before changing them and validates the complete candidate against the same official schema.

Add the candidate JSON Lines to the existing native workspace, build it with the original plan and compare the exact two native builds. Carry candidate-package.json and the reviewed changes into the publisher's normal hosting process. The publisher's stable download URL and subsequent source acquisition identify the published edition.

## Complete receiving

~~~sh
python publisher.py export \
  --workspace /absolute/publisher-edition \
  --decisions /absolute/review-decisions.json \
  --candidate /absolute/publisher-candidate \
  --out /absolute/publisher-receiving.zip

python publisher.py receive \
  --file /absolute/publisher-receiving.zip \
  --out /absolute/second-operator-edition
~~~

The ZIP includes original decoded and transport bytes when supplied, acquisition metadata, the complete registry record, all grant JSON Lines, native mapping, official schemas and attribution, the whole review and its editable decision template, and this complete operator source. Receiving checks every declared member and reopens the original source identity. The second operator can reopen the review and continue the same native project using the NDJSON application's original export/import commands.

The original source-project ZIP remains the native engine's complete reconstructable project. Deliver that project with the publisher receiving ZIP when transferring both the domain review and the selected native build.

## Results and errors

Every command prints one JSON result. Successful native-ready preparation and completed candidate/export/receiving return exit 0. Preparation returns exit 2 with a complete review when official schema errors or duplicate grant identifiers need resolution before the keyed native workflow. File, parsing, schema-resource and selected-source conflicts return exit 1 with a specific message.

Output directories preserve existing bytes. Repeating an unchanged preparation resumes the same original source edition; a different source or changed operator program uses a new edition directory.

## Operate the complete retained publisher editions

The examples contain the exact HTTP-decoded SCVO Digital Ethics Fund 2022 and Connecting to Care Fund 2024 packages, their complete registry entries, acquisition identities and the production profile's generated native mappings. Their SHA-256 values match the original HTTP acquisition. Each fund is a separate dataset.

After installing requirements.txt, run the complete publisher workflow:

~~~sh
python examples/run_publisher_workflow.py --out /absolute/scvo-publisher-work
~~~

The command prepares every original grant, runs the pinned official schema, keeps each original grant value during review, adds the operator-selected registry metadata, creates the candidate and full receiving ZIP, and reopens that ZIP and candidate in a second operator directory. It retains all review questions and decisions. Supply --source-root for the same exact original JSON files in another receiving directory and --transport-root when the matching original .transport.bin files are available.

The resulting publisher-operation.json points to both complete editions and their candidate and receiving outputs. Each edition's grants.ndjson and mapping.json also feed the original native file job; the complete original package can feed its /grants JSON-array intake directly.

Supply --decisions and --candidate on export to hand over completed work. The receiving ZIP then includes the exact entered decision file, every candidate file and a review that opens with those saved choices. The second operator reapplies the received decisions using only the received source and program. Omitting those options exports the original prepared source edition for an operator who is starting review.
