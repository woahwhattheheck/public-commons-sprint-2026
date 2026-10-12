# Gravity referrals in Applications

Open the complete Gravity referral workspace from the installed Runtime workspace's **Applications** library. The same saved workspace holds original FHIR sources, reference graphs, source and recipient configuration, referral editions, all published requirements and reviewed fields, assessments, decisions, conditional exchanges, monitoring and complete receiving files.

The application runs the original `gravity-referrals serve` command. The maintained Applications lifecycle manages the selected runtime, saved settings, process, private address and Start/Stop history. The Gravity provider checks the original workspace UUID and the live Gravity operator instance before publishing its private address.

## Receive the complete product

Build and install the `gravity-referrals` selected product, or receive a cumulative source distribution containing both contributions:

| Contribution | Installed behavior |
| --- | --- |
| `gravity-referrals` | Complete native domain, private operator, original Gravity source/profile, native CLI, published-example operation and browser receiving |
| `gravity-referrals-connected` | Applications provider, complete connected merchant tools, typed local/merchant clients and full installed receiving |

The complete native source is `stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/`. It composes the original FHIR/eLTSS, XML, dataset, merchant and customer engines. Receive the full selected release so Python modules, browser assets, source notices, original guidance and dynamically opened files are present.

Use the retained builder and runtime installer described in the product's operating guide. Select the actual installed **READY** runtime in Applications. Node 22 or newer runs the native command and installed receiving; use the selected Python environment required by the original source release.

## Initialize or restore the workspace

Initialize a private directory with the installed command:

~~~sh
starforge gravity-referrals init --workspace /absolute/private/referral-workspace
starforge gravity-referrals status --workspace /absolute/private/referral-workspace
~~~

To continue a delivered workspace, initialize the receiving directory and import the complete original archive:

~~~sh
starforge gravity-referrals init --workspace /absolute/private/received-referrals
starforge gravity-referrals workspace-receive \
  --workspace /absolute/private/received-referrals \
  --input /absolute/originals/Gravity_Complete_Editable_Workspace.zip
~~~

The archive's original UUID and saved records become the identity of the restored workspace. Reopen its actual `status` after receiving, and select that restored directory in Applications.

| Original workspace item | Purpose |
| --- | --- |
| `workspace.json` | Maintained FHIR/eLTSS workspace marker |
| `eltss/identity.json` | Original workspace UUID shared by the inherited source and Gravity domain |
| `workspace.sqlite` | Original native records and referral collections |
| `referral/` | Referral operation state and the live Gravity connection descriptor |

The original marker is `stellar-forge.eltss-workspace.v1`. Gravity adds `stellar-forge.gravity-referral.v1` to the same native state. This keeps original source, graph and dataset operations in the same editable workspace.

## Save and start the application

1. Open **Applications** in the Runtime workspace and choose **New application**.
2. Enter a useful display name and select the complete READY runtime.
3. Select **Gravity Referrals**.
4. Set **Initialized Gravity referral workspace** to the actual private directory.
5. Select an existing private **Authentication profiles** file when the chosen FHIR source or exchange uses one.
6. Select the ordinary environment file when the runtime needs configured environment variables. Keep **Local port** at 0 to select an available loopback port.
7. Choose **Review application** and inspect the selected runtime and workspace.
8. Choose **Save application**. Continue the original managed runtime connection if the screen presents that saved operation.
9. Choose **Review start**, then **Start reviewed application**.
10. Follow **Open application** to the complete private referral workspace.

The saved launch request includes the original UUID. Before launch the provider reopens the private marker and identity. At startup it verifies the emitted workspace, expected connection-file path, loopback URL, Gravity instance and authenticated original state.

Source additions, successor reviews, authored decisions and completed exchanges remain normal saved work within that same application. The provider binds the workspace identity while allowing its native records to evolve.

## Operate the complete referral programme

| Work | Saved result |
| --- | --- |
| Original source | Complete provider or published source, original member bytes and exact resource locators |
| Configuration | Selected source/intermediary/target roles, server topology, programme and source version |
| Referral editions | Explicit Task cohort with original resource, ServiceRequest and reference relationships |
| Requirements and field review | All 57 published requirements, all 24 field rows, original profile definitions and authored review decisions |
| Assessment | Complete Task/field observations, findings, source locators, timing and selected topology |
| Decisions | Explicit scoped decisions with actor, source edition and predecessor relationships |
| Correction | Frozen preview of exact original resource changes, followed by the saved request hash and successor source/edition |
| Exchange | Original read or conditional write request, the same operation ID, actual provider result and retained readback |
| Monitoring | Selected original Task search/history request and saved source result |
| Handoff and receiving | Complete selected referral package, destination result, original operation identity and editable workspace restoration |

The private operator exposes the full native catalog and original source guidance. The source profile retains the original Gravity 3.0.0 publication, 57 requirements, 24 profile definitions, five actor capability sources and 24 operating field reviews. The workflow keeps the source requirement and the authored implementation decision together.

Use the original resource locators and graph when reviewing a referral. Save a successor edition or review when the source or implementation choice changes. Compare those retained editions and inspect the complete changes file.

When preparing an exchange, select its original source, destination connection, method and request. Continue the same saved operation to receive its actual result and readback. Reopening the application resumes the saved request and provider timing from the existing native state.

## Receive complete files

The operator and connected clients expose complete original source files, full assessments, all edition changes, original exchange packets, referral handoffs and the complete editable workspace. Interactive pages carry the original next offsets; complete file routes carry the full selected bytes.

Use a referral handoff for its selected source, cohort, configuration, requirement/field review, decisions and downstream receiving material. Use the complete editable workspace to move the entire saved programme and operation history to its receiving host.

The private connection descriptor is `referral/operator-connection.json`, with schema `stellar-forge.gravity-referral-operator-connection.v1`. Startup uses `stellar-forge.gravity-referral-startup.v1`. Its live access token stays with the private host. Connected tools selecting that same running workspace borrow the original operator through this descriptor.

## Stop and reopen the same work

Use **Stop application** to end the process owned by Applications. Reopen the Runtime workspace and select the same saved application. Review its start, start it and open the private workspace again.

The application retains the original UUID, source members, saved editions, reviewed fields, assessments, exchange journals, monitoring and receiving records. Whole-workspace restoration at a different selected directory is identified explicitly in the receiving journal.

## Run the complete installed receiving journey

First complete the original native published-example operation and retain its full `OPERATED_GRAVITY_REFERRAL.json` plus complete editable workspace. Use that unchanged result and the actual restored directory when receiving on another host.

~~~sh
node /ABS/SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/operate_installed_applications.mjs \
  --runtime-directory /ABS/ready-gravity-runtime \
  --runtime-workspace /ABS/private-runtime-workspace \
  --receiving /ABS/originals/OPERATED_GRAVITY_REFERRAL.json \
  --workspace /ABS/received-referrals \
  --out /ABS/gravity-applications-receiving \
  --playwright /ABS/installed/playwright/index.mjs \
  --chromium /ABS/installed/chromium
~~~

Omit `--workspace` to use the directory in the original native result. The browser arguments are optional when the selected environment already resolves Playwright and Chromium. `--credentials-file`, `--environment-file` and `--label` select the existing private inputs and application label.

The installed journey:

1. Opens the existing Runtime workspace host and attaches the selected READY runtime.
2. Finds the existing saved Gravity application for that runtime and workspace, or reviews and saves it.
3. Starts the original native command through Applications and verifies its private operator.
4. Opens the actual application and runs the complete private browser workflow.
5. Receives and reopens the full editable workspace download.
6. Stops the original managed process and reopens the Runtime workspace host.
7. Starts that same saved application again and verifies all original records plus the work authored by the first browser journey.
8. Stops the second managed process and saves its complete result and history.

The result is `OPERATED_GRAVITY_REFERRAL_APPLICATIONS.json`. It retains the exact original receiving-file SHA256, original and selected workspace paths, UUID, runtime source/manifest, saved application ID, both managed starts, before/after original records, complete workspace packet, screenshots and original application requests.

Keep the same receiving input, runtime, runtime workspace, selected native workspace and output directory when continuing. `APPLICATIONS_JOURNEY.json` identifies the existing application and runs, so recovery can continue their saved operations and retained browser files.
