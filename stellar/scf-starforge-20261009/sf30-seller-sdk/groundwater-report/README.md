# Groundwater frozen-report distribution and receiving

A complete operator desk and maintained merchant provider for publishing an existing scientific report through original SF30 `responseAsset`, preparing its original SF88 buyer configuration, and receiving the buyer's actual report into Groundwater and the selected SF47 case.

[Operator guide](OPERATOR.md) · [API and examples](API.md) · [Native continuation](native-workflow.mjs)

## Interfaces

- `GroundwaterReportDesk`: existing source reads; frozen file publication; native buyer preparation/capture; exact file receiving; original Operations association; complete export/restore.
- `startReportDesk`: authenticated local industrial UI with persistent desk identity, original-request recovery and source-bound downloads.
- `ReportDeskClient`: the same native HTTP actions and original result reads.
- `groundwater-reports` merchant provider: configured original desks, native actions and retained immutable file receiving.
- `groundwater-report` CLI: the same complete operator workflow.

The component is additive outside the frozen scientific application's 64-file source. It imports the original scientific, SF30, SF88 and SF47 contracts and does not replace their stores or native semantics.
