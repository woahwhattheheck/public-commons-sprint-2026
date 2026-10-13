# Daily barn work
## Start with the actual barn
This application prepares a daily horse-care roster and shift handover. The Prairie Sky starter retains the published three daily hay feeds and six-day turnout frequency. It contains no entered horses, staff or places. Its two source routines are inactive until actual assignments, weekdays and times are entered.

Open Daily_Barn_Work.html in a normal browser. The application runs offline. Use **Save working file** at the top whenever you finish a work session. **Files & sources → Download complete ZIP** collects all operating exports and the source. Keep the latest working JSON when moving between computers. A browser save can be restored from Files & sources.

## Set up the registers
1. **People & places:** create staff and actual stalls, paddocks or other places. Use stable IDs that you will keep. A capacity of zero means the operator has not specified a numeric limit; enter the actual capacity when known. Close a location only after its horses have been moved.
2. **Horses:** create the real horse, owner/contact, home location and notes. The initial home becomes its current location. Subsequent physical moves use Horse movements.
3. **Care instructions:** enter the complete instruction from its authorized source, who authorized it, the work type and effective dates. An empty end date means ongoing. Instructions for the same horse and work type cannot overlap. Edit an existing instruction to revise it; the earlier revision remains available in the record.
4. **Routines:** open the published starter or create a routine. Select the actual horses and weekdays. Enter one time slot per line as ID | Label | HH:MM. Times are in the barn timezone. Activate the routine only after all required choices are entered.

Prairie Sky's source publishes frequency, rather than exact times, amounts or turnout weekdays. Use the operator's instructions for those choices. Stalls and attached runs in a facilities description do not establish actual availability or group compatibility.

## Run the day
Choose the working date and press **Plan this day**. Each active routine creates one task for each selected horse and slot on its selected weekday. Replanning the same tuple does not create duplicates. The plan identifies work whose authorized instruction is still missing.

Open a task and assign it to the responsible worker. Record **Completed**, **Exception**, **Skipped** or **Cancelled**, with actual time and a note. Completion requires assignment to the actual worker. Exceptions remain unfinished until resolved; a later completion retains the earlier exception event. Skips and cancellations retain the entered reason.

If a horse's instruction changes, completion of an old pending task asks you to review the new instruction. Use **Review changed instructions** with the reviewing worker and reason. The earlier instruction remains in the task events; completed work keeps the instruction used at the time.

Actual local times are interpreted in the barn timezone. For a repeated clock time at the autumn timezone change, enter its actual UTC offset. Nonexistent spring-change times are rejected. Omit the actual time only when recording work as it occurs.

## Record moves
Record the real destination, actual worker/time and handling or compatibility note. The application updates current occupancy and retains the movement history. Numeric capacities are checked against the entered register. Preserve chronological movement entry for locations shared by several horses.

Returning from turnout is a separate actual movement. Recording a task outcome does not silently move the horse. The operating record therefore shows what was done and where the horse actually is.

## Hand over the shift
Prepare a handover naming the outgoing and incoming workers. It captures unfinished tasks through the selected day, the day's movements and unplanned work requiring attention. Include relevant care exceptions in the handover note. The named incoming worker acknowledges it in the next form. The saved handover remains the original snapshot even as tasks are completed.

Close the day once its active routine work is planned and every task is complete, explicitly skipped or cancelled. Reopen a closed day with a worker and reason before correcting it. Earlier closeout details remain in history.

## Save, receive and continue
The working application JSON contains the complete record and unfinished forms. Reopen it using Files & sources. The smaller record JSON contains operating records without the current forms. CSV exports are readable handover tables; use JSON to continue editing.

Attach original source text/CSV through Files & sources to retain exact file text. Original files stay alongside normalized operating records and are returned in the complete export. The source-file form can also retain pasted text.

The full ZIP contains the application record, operating tables, routines, handovers, closeouts, history, original sources and complete executable source. It can be opened with ordinary ZIP tools. Run the Node command-line interface for batch or scripted operations.

## Command line
Use Node with the supplied source directory:
~~~sh
node source/barn_work_cli.mjs init --name "My barn" --timezone America/Los_Angeles --out Barn_Working_Record.json
node source/barn_work_cli.mjs apply --record Barn_Working_Record.json --request operation.json --out Barn_Working_Record_next.json
node source/barn_work_cli.mjs build --record Barn_Working_Record_next.json --out New_Barn_Work_Folder
~~~
The bundled CLI creates new files/directories; choose a new output path for each saved version. An operation has kind, input, operation_id and expected_revision. Readable errors identify missing values or a changed workspace. Replaying the exact operation ID/request is idempotent; a different request cannot reuse that ID.

## Published sources
- Prairie Sky boarding: https://www.prairieskyeqctr.com/boarding-info
- Prairie Sky business contact: https://www.prairieskyeqctr.com/form__map

Both were checked on 13 October 2026. Keep current operator instructions in the workspace when actual care arrangements change.
