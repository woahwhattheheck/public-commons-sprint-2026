# Unclassified event visibility

The Ring ingress integration can normalize an ordinary button press to a
`doorbell` event with classification `unknown`. That does not establish that a
person was detected. The existing proposal policy deliberately requires human
classification before it generates an accessibility notice.

A report containing only proposals previously omitted the context of every event
for which the policy generated no proposal. This included unclassified button
presses and quiet animal-motion events. Import retained those events correctly;
the missing step was operator visibility, not event storage.

The workbench now includes:

- `events_without_proposal` in its JSON summary, carrying the retained event ID,
  device ID, occurrence timestamp, event type and unchanged classification.
- An escaped, read-only **Events without a proposal** section in the HTML report.
  It explicitly distinguishes retained activity from an approval or external action.

No event-policy or classification rule changes. No workspace schema, stored state,
receipt, approval record or existing proposal ID changes. Existing saved
workspaces can produce the new report without migration. The report is still an
offline file and the added event context should remain in trusted local storage.

From `amazon-ring-carerelay/`:

```sh
python -m carerelay.workbench import examples/workbench_unclassified_events.jsonl --source offline-simulator --out activity-01.json
python -m carerelay.workbench report activity-01.json --out activity-review-01.html
python -m unittest discover -s tests -p 'test_activity_timeline.py' -v
```

The fixture is synthetic normalized metadata, not an official Ring capture. One
focused integration regression covers an unclassified button press, quiet animal
motion and human-classified motion together. It checks the two retained
non-proposal events, the one legitimate pending proposal, escaped HTML and
byte-identical persisted workspace. This is not a live provider integration test.
