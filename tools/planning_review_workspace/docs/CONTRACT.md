# Supplied production-plan review contract

This is a complementary, offline review of retained source and supplied plans. The owning planning product retains optimization, dispatch and its customer model.

## Original inputs

All nine tables are selected from retained CSV, TSV or JSON. Decimal meanings are exact strings (JSON numeric lexemes are preserved); no currency or unit conversion is inferred. Mapping names are output fields and values are exact source columns or JSON pointers. The exported `TABLE_FIELDS` and `blankInput()` are the complete schema.

- jobs: identity, product, output quantity/unit and due time.
- operations: one contiguous phase, job, family, resource class, required minutes, capacity demand/unit, optional earliest/latest bounds, queued/in_progress/completed and explicit start/end/resource locks.
- resources: exclusive or cumulative capacity, exact unit, initial family, declared/none changeover policy, optional rate, assignment_hour or capacity_unit_hour rate basis and currency.
- availability: explicit available windows with capacity, or unavailable windows with zero capacity. Half-open intervals. Overlapping available declarations are ambiguous; unavailable overlays take precedence.
- supplies: explicit opening stock and later receipts by material/unit/time.
- requirements: exact operation demand, with start/end consumption timing. Same-time supply precedes grouped demand. Missing unit-matched stock yields a visible shortage.
- precedence: explicit predecessor/successor with minimum and optional maximum lag in minutes. A maximum lag can express a declared hold-time boundary; no CIP/hold duration is invented.
- changeovers: one exact resource/from-family/to-family rule, minutes and optional separate fixed setup cost. Same-family transitions need a rule under declared policy. First transition begins with the declared initial family. Setup occupies the immediately preceding gap and must lie in resource availability. Model cleaning as an explicit operation when it consumes additional shared resources.
- assignments: supplied operation/resource/start/end. Split phases require separate operation IDs and explicit precedence. Simultaneous multi-resource tasks require an agreed extension or separately reviewed upstream representation; synchronization is not inferred. No automatic scheduling occurs.

The horizon, as-of, currency and clock are explicit. Naive timestamps require a single declared fixed UTC offset; daylight-saving changes are not inferred. Completed work requires exact start/end/resource locks. In-progress work keeps start/resource; an explicit locked end is respected. Queued work cannot start before as-of.

Owner declarations cover operations, availability, materials, precedence and changeovers. An empty optional table is valid only under that explicit completeness declaration. These declarations are visible assumptions, not independently verified plant knowledge.

## Calculation

Every resource segment shows capacity, demand, active operations and exact source references. Exclusive occupancy is separate from numeric capacity. The source report also includes all material ledger occurrences, precedence lags, changeover gaps, job completion/lateness and schedule rows. Available/occupied minutes and utilization expose their denominators. Execution cost uses the stated hourly basis; separate changeover cost is never silently included twice. Missing cost rates produce known totals and a null complete total. No overtime premium, late fee, change penalty or carrying cost is invented.

Comparisons keep both source populations, exact changed rows, unmatched operations, movement and cost/delivery deltas. Changed constraints or scope are explicit caveats. A named proposal binds the complete comparison digest; PLANNING/OPERATIONS decisions bind that exact proposal. Review-complete is an internal package state, not dispatch or physical feasibility certification.

## API

`createPlanningAPI({encode,decode,sha256,toBase64,fromBase64})` is synchronous. `sha256` accepts string or bytes. All returned workspaces are deeply frozen; `validateWorkspace` reuses only the engine's own trusted immutable instances and fully replays foreign input.

- createWorkspace({title,createdAt,id?})
- addSource(w,{name,mediaType,content_base64},meta) -> {workspace,sourceId}
- readSource(w,id); inspectSource(w,id,{format,arrayPointer}); mapRows(w,id,{format,arrayPointer,mapping})
- analyse(input,w) -> full report
- saveEdition(w,{name,input,parentEditionId?,preparedBy?,note?},meta) -> {workspace,editionId,report}
- compare(w,leftEditionId,rightEditionId) -> full comparison
- propose(w,{name,baseEditionId,candidateEditionId,preparedBy,reason},meta) -> {workspace,proposalId,proposal}
- review(w,{proposalId,comparisonSha256,discipline,decision,reviewer,note},meta) -> workspace
- proposalStatus(w,id); handoff(w,id)
- exportWorkspace(w) -> {filename,content,sha256}; importWorkspace(content); validateWorkspace(w)
- blankInput(), fields, parseJSON(text), canonical(value)

Every mutation receives `{operationId,expectedRoot,at}`. Same-ID exact replay is idempotent; changed replay and stale roots reject. Original source maximum20MiB, total originals64MiB, complete workspace128MiB. The whole operator handover has its own128MiB limit.

## Authored scenario

Three fictitious batch jobs use a1000L exclusive tank and one-batch fill line. The baseline contains6 phases and costs USD470 under supplied rates. A retained fill-line outage creates2 findings. The manually supplied recovery moves2 fill operations while preserving completed/in-progress work and maximum lags; B becomes30minutes late and C60minutes late. Total known cost remains470. All3 editions and original availability/assignments remain. No actual customer plan or measured improvement is represented.

## Retained invalid populations

Invalid or duplicate supply/requirement rows remain in the full mapped tables and findings, but do not contribute accepted ledger quantities. Job completion uses every declared operation belonging to that job, including invalid or unassigned phases; a rejected phase cannot silently shorten the job. Original duplicate/invalid evidence is retained in the private source course.

If any declared phase prevents job completion, that job's finish and lateness are unknown; the aggregate total lateness is also unavailable. Comparing an invalid received scope preserves its missing fields as null comparison context rather than throwing away the edition.
