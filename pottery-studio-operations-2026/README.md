# Pottery studio operations

A complete offline operating application for memberships, teaching, studio access, maker pieces and kiln work. The application connects the person who owns a piece to the class or membership that produced it, retains the actual staff decisions through each load, and keeps the complete workspace available for another operator.

## Open and operate

Open `pebblesky-studio-operations.html` in a current desktop browser. It contains the entire core, interface, source catalogue and example builder. Start an empty workspace or build the explicitly labelled six-studio demonstration. Actual people, resources, programmes, entitlements and times are entered by the operator.

The full application guide is `OPERATING-GUIDE.md`. Save a complete working JSON export before closing. Reopening that JSON validates the catalogue, record references, complete change history, original CSV bytes and ledger linkage before replacing the selected workspace.

## Complete operating flow

1. Enter actual people and physical resources. Website wheel/kiln counts remain source context.
2. Configure class, open-studio, member-access and firing-dropoff programmes and sessions. Approve each exact resource/time/capacity selection.
3. Configure each membership's actual validity and access mode. Choose a total balance or leave its ceiling explicitly unlimited; independent calendar-week/month allowances retain their own units.
4. Request and review each participant's place. Confirmation respects actual capacity, conflicting bookings and membership allowances. An unbooked member can be checked into a reviewed member-access session directly.
5. Record attendance once. Absences use an explicit consume/no-consume decision. A correction retains and reverses the original debit.
6. Intake every piece with its owner, original booking/reference, material and exact cone string. Review original CSV rows with explicit create/link/ignore decisions.
7. A technician clears each actual piece for the selected firing programme. Approve the whole kiln load and its contents before starting; record actual firing, cooling and unload transitions.
8. Choose each unloaded piece's actual result. Finished, damaged, refire and intermediate outcomes remain separate. Prepare a collection notice, record an actual send reference, and record pickup per piece.
9. Export the full workspace for continued operation, with previous decisions and original source intact.

## Published source and operator choices

Nineteen refreshed public source rows cover six independent studios. Stone's Throw has separate throwing, handbuilding and sculpting capacities; Garret's dimensioned shelf allowance is not converted into visit credit; West End's firing-only route is a distinct dropoff session; Mudworks' full members retain unbooked access; Longtom's weekly and monthly wording remains explicit; Zed Alley's conflicting firing-fee wording creates no default charge.

Cone strings preserve leading zeros and ranges. Programme text does not infer firing temperature, duration, body compatibility, kiln capacity or safe unloading. Kiln-specific technical operation **Needs expert review** by the responsible studio technician. The application records their actual decisions and does not operate kiln hardware.

Every example participant, asset identifier, event and transition is labelled as a demonstration. The source catalogue carries public operating facts. Commercial correspondence and actual native customer records remain in their existing authorized workspaces.

## Source and rebuild

- `pebblesky-core.cjs`: dependency-free browser/CommonJS operating engine.
- `pebblesky-examples.cjs`: complete six-studio example built through the same API.
- `source-catalogue.json`: dated public studio source, rules and exact URLs.
- `pebblesky-ui.js`, `pebblesky-template.html`: complete original interface sources.
- `build.cjs`: deterministic standalone assembly from these full source files.
- `API.md`: complete command/receiving contract.
- `OPERATING-GUIDE.md`: full customer operating guide.
- `SOURCE-REFRESH.json`: current primary-source review.
- `AGENTS.md`: owner-supplied rendered-product/all-attachment controls.
- `LICENSE`: MIT source license.

Run `node build.cjs` from this directory to create the standalone HTML. No package installation, server, external API, build service or Actions workflow is required. In Node, load the core with `require('./pebblesky-core.cjs')`; the complete example uses `require('./pebblesky-examples.cjs').build(core, catalogue)`.

## Complete receiving and source operation

The source programme performs 163 actual engine mutations across all six studio workflows, including a full class, a retained seventh request, a weekly limit, firing-only dropoff, course makeup, unbooked attendance, original debit correction, reviewed pending and completed kiln loads, explicit damage/refire, partial pickup and complete source CSV link/create. The complete resulting working JSON exports, receives and exports byte-identically. These are actual application operations using explicitly labelled demonstration inputs.

The browser course must open the exact outgoing HTML at desktop and 390 px, look at the real screens, operate the important forms and review controls, download the complete JSON and reopen it. Review empty, populated, loading and rejected-input states. Open the guide, source files and the complete contents of any archive in their ordinary recipient-facing applications. Source execution alone does not report the rendered experience. Use the existing admitted customer-browser operation and retain its actual images/outcomes against the outgoing file identity.

## License and attribution

New reusable application source is MIT licensed, copyright 2026 TokenJunkieLabs contributors. Source facts link to their original studio publishers; their names and published policies are attributed to those sources. The software is an independently authored operating companion and does not assert a native integration with the studios' current booking tools.
