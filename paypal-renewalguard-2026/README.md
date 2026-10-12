# RenewalGuard · Merchant renewal case desk

RenewalGuard turns a PayPal sandbox subscription portfolio into a retained support
work queue. An operator can assign renewal work, save plan editions, prepare an
AI support note, review the exact plan against fresh PayPal facts, resolve the
support case, and reopen it later with its full history.

The same interface includes portfolio intake, overdue and ready-work queues,
source history, original document downloads, a complete handover, and a calendar
task. It runs locally with Node 22 or newer and has no package dependencies.

## Start the workspace

From this directory:

~~~sh
node src/server.mjs
~~~

Open **http://127.0.0.1:8787**. The demonstration source contains three explicitly
fictional subscriptions. It works immediately and retains its own case history.

The server uses the following process configuration:

| Variable | Purpose |
| --- | --- |
| PORT | Local HTTP port; default 8787 |
| RENEWALGUARD_DATA_DIR | Retained data directory; default .renewalguard-data beside this README |
| PAYPAL_CLIENT_ID | Authorized PayPal sandbox application client ID |
| PAYPAL_CLIENT_SECRET | Matching sandbox application secret |
| OPENAI_API_KEY | Optional original AI note adapter |
| OPENAI_MODEL | Model identifier for that adapter; existing default gpt-4o-mini |

Use the existing configured process or set credentials through your usual local
environment. Then choose **PayPal sandbox account**. **Read current portfolio**
performs the real PayPal list operation. **Open by subscription ID** uses the
actual show-subscription endpoint and also works for subscriptions beyond the
loaded list limit.

The server binds to loopback and checks Host, Origin and Fetch Metadata. This
application is a local operator workspace. A public deployment needs its own
authenticated session and tenant binding.

## Complete a renewal case

1. **Read current portfolio.** The retained list records its source scope, read
   time, page count and coverage. Select subscriptions and choose **Open selected
   cases**. The batch retains each completed original child request, so an
   interruption resumes the remaining intake.
2. **Assign the work.** Open a saved case, set its title, owner, due date,
   priority and next action. Record investigation notes. **Save work plan**
   creates a numbered edition tied to the current facts fingerprint.
3. **Prepare a support note.** The original provider adapter reads current
   subscription facts before generating the note. The saved note records its
   source, generation kind and complete returned text. **Use text in work plan**
   copies it into the editable plan. Save the edited plan to retain that version.
4. **Prepare the resolution.** Mark work **Ready for review**, choose an
   outcome, and write the resolution summary. The work owner and outcome are
   part of this saved plan.
5. **Save the resolution review.** Enter a reviewer and review summary. The
   server reads PayPal again and binds an immutable review to the exact plan
   document and source fingerprint.
6. **Resolve support case.** The server checks the current saved review and
   reads PayPal once more. A matching source closes the local support case and
   retains its resolution. The displayed subscription status is the status
   reported by PayPal.
7. **Download the handover.** The JSON includes every original source, plan,
   note, review, resolution and timeline event, with individual document
   checksums and a complete-envelope checksum. The work sheet and calendar
   task are useful smaller exports of the saved plan.
8. **Reopen when more work arrives.** Record a reason. The original resolution
   and all earlier editions remain in the case history.

The note assistant passes the existing minimized status, triage rationale,
renewal date and disclosed failure date to the configured AI adapter. When the
adapter is unconfigured, the interface identifies its rule-based preview.
Subscription identifiers, subscriber identities, payment instruments and
credentials are absent from the model input.

## Changes, interruptions and concurrent edits

**Changed PayPal facts.** A different facts fingerprint during note preparation,
review or resolution saves a new source event. The existing work plan remains
available. Compare the new facts, update the work if needed, save a new edition,
and review it. A review of an older plan cannot resolve a newer plan.

**Newer local work.** Writes carry the case revision that the operator opened.
If another operator saves first, the original edited fields remain in the
browser. The interface shows the newer saved plan and provides explicit actions
to keep those edits on the newer case or use its saved plan.

**A dropped response.** Every command uses a stable request ID and a retained
input hash. **Recover original request** finds the original result or continues
the unfinished operation. The **Recent retained operations** drawer can recover
a request after browser storage was cleared. It uses the server's complete
original input.

**Provider interruption.** Subscription reads can resume under the retained
request. Once an AI response has been durably saved, recovery reuses its exact
note. If the process died before saving a provider response, retrying the
interrupted operation can make another provider request.

**Saved case, missing response record.** The operation first saves its prepared
case commit. Recovery locates the journal entry by the original operation ID
before attempting another publication. It then records the existing result.

**Retained data.** JSON documents are addressed by their SHA-256. A document is
fully written and synced before it is linked into an immutable journal ordinal.
Publication of a case revision refuses replacement atomically. Case history
therefore survives process restart without a writable lock file that must be
manually cleared. Operation workers retain their process identity, and another
live server process cannot take over an active request.

Choose a durable, local filesystem for RENEWALGUARD_DATA_DIR. Filesystem hard
links and directory sync must be supported. The data directory is ignored by
Git. Keep it when updating the software. Saved scope identity separates
demonstration work from each configured sandbox application; rotating an app's
secret keeps that application's retained workspace.

## Complete handover receiving

In **Subscription intake**, choose a downloaded RenewalGuard handover JSON and
select **Restore retained case**. The receiver checks the complete envelope,
source scope, case identity and every original document hash before publication.

A case can be restored into an empty matching source workspace. Restoring the
same accepted handover is idempotent. If that destination already contains
different case work, it remains available for comparison; import does not
overwrite its history. The received case keeps the original case, source and
document IDs and records its original source revision alongside the new local
receiving event.

To exercise a second destination, start another instance with a different
RENEWALGUARD_DATA_DIR and PORT, using the same source mode and sandbox app.

## CLI and host integration

The CLI operates the original local server:

~~~sh
node src/cli.mjs workspace --mode sandbox --output saved-workspace.json
node src/cli.mjs command --mode sandbox --request-id ORIGINAL_REQUEST_ID --action capture --input capture-input.json --output capture-result.json
node src/cli.mjs resume --mode sandbox --request-id ORIGINAL_REQUEST_ID --output recovered-result.json
node src/cli.mjs export --mode sandbox --case ORIGINAL_CASE_ID --output complete-handover.json
~~~

The command input file contains the action's input object. For capture, that is
a subscription_id property. Use node src/cli.mjs --help for all operations.
Existing output files containing different bytes are preserved; choose a fresh
filename for a different result.

The local API provides the same original commands as the interface. Its request
body is:

~~~json
{
  "mode": "demo",
  "request_id": "operator-renewal-20261012-example1",
  "action": "capture",
  "input": {"subscription_id": "I-DEMOSUSPEND1"}
}
~~~

Use a new stable request ID for a new input. Reuse the original request ID for
recovery. Source mode and the process-configured sandbox app determine the
retained scope; a caller cannot supply a different scope identifier.

| Route | Operation |
| --- | --- |
| GET /api/settings | Local adapter configuration indicators |
| GET /api/workspace?mode=demo | Saved queue, retained portfolio, recent original operations |
| GET /api/case?mode=demo&case_id=… | Current case, plan and review plus complete history references |
| GET /api/document?mode=demo&case_id=…&sha=… | One complete original case document |
| GET /api/export?mode=demo&case_id=… | Complete portable case handover |
| POST /api/command | Start or recover an original command with its exact input |
| GET /api/operation?mode=demo&request_id=… | Read its durable state and progress |
| POST /api/resume | Resume by mode and request_id using the retained original input |

Commands are refresh_portfolio, intake, capture, save_plan, ai_note, review,
resolve, reopen and restore. The original /api/list, /api/detail and /api/draft
routes remain available to existing receivers.

Case work commands use case_id and expected_revision. save_plan adds the work
object. review adds the current plan_id, reviewer and summary. resolve adds the
current review_id. reopen adds a reason. intake uses the original portfolio_sha
and distinct subscription_ids. restore uses the complete handover envelope.

## PayPal portfolio coverage and source fields

The original list adapter reads consecutive pages of at most 20 records, up to
10 pages / 200 subscriptions. It checks IDs, duplicate IDs and the next-page
boundary. A full final page causes a confirming next-page read even if the
provider omitted a next link. If the cap is reached while more records may
exist, the interface labels the retained list **Partial portfolio** and keeps
the manual subscription-ID intake available. A filtered count refers to that
retained list.

Source snapshots retain the original minimized facts contract:

- subscription ID and plan ID;
- subscription status and its reported update time;
- next billing time;
- last disclosed failed-payment time;
- original triage tier, rationale and fingerprint.

An absent date is displayed as **Not provided**. Resolving a case records a
support outcome; it does not infer settled money from a subscription status.

Official API references:

- [List subscriptions](https://developer.paypal.com/api/subscriptions/v1/subscriptions-list/)
- [Show subscription](https://developer.paypal.com/api/subscriptions/v1/subscriptions-get/)

## Competition delivery

The [PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules)
set the submission deadline at **November 12, 2026, noon Pacific**. The entry
requires central PayPal sandbox and AI use, a functional runnable experience,
a public source repository with setup instructions, and a demonstration video
under three minutes.

Use the existing configured sandbox and AI receiving operation to record a
real merchant case from intake through saved review, resolution and reopening.
Include the retained case handover with that source/run packet. The
demonstration portfolio provides an immediately runnable product walkthrough.

This subtree is covered by the repository's MIT license.
