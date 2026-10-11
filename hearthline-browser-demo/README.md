# Hearthline: household workboard and live MCP

Hearthline turns a household storm plan into work people can finish: assign a task, record what is on hand, complete a restock, and return to the same saved workspace. The browser uses the original Hearthline MCP service over local HTTP. Shopping handoffs and household reminders retain the original explicit approval and execution flow.

## Start and return to your work

From the repository root, with Node.js 20 or later:

~~~sh
node hearthline-browser-demo/server.mjs
~~~

Open **http://127.0.0.1:8790/**. The host creates or reopens `data/hearthline-browser-store.json`, relative to the directory from which you started it. Start from the same directory to return to that workspace. Stop the host with Ctrl+C; the worker finishes accepted store writes before exiting.

Choose a particular workspace when you want a different household or are reopening a downloaded copy:

~~~sh
HEARTHLINE_STORE=/absolute/path/to/household.json node hearthline-browser-demo/server.mjs
~~~

In PowerShell, set `$env:HEARTHLINE_STORE = 'C:\\path\\household.json'` before the Node command. The file uses the original version-1 JSON store with additive workboard fields. Existing missions, approvals, operation IDs, receipts and local outbox entries are retained. Use one running host for each selected file; the JSON store serializes writes within that host.

A fresh workspace gets the four sample stock counts once. Creating another mission never resets your stock. For an explicitly disposable demonstration, set `HEARTHLINE_EPHEMERAL=1`; its temporary workspace lasts for that host invocation, including MCP-worker restarts.

The host remains restricted to its own loopback Host and Origin. The browser needs no API key, cloud account, paid service or model installation. The supplied weather scenario is a clearly labeled fixture. The original production weather provider remains in the MCP core.

## Complete a household mission

1. **Create household mission** prepares the original storm plan using the current stock. **Open saved mission** returns to existing work without creating or approving anything.
2. **Assignments and supplies** starts with restocking tasks for the original supply gaps and a household check-in. Expand a task to assign a person, choose a due date, add notes or move it into progress. **Add a household task** records other work, such as securing outdoor furniture.
3. **Household stock** records actual counts on hand. Save only when a count changes. Current supply gaps update immediately; the task's target stays tied to the plan that created it.
4. For a supply task, you can enter the new stock count and mark it done in one save. Completion requires the recorded count to meet that task's target. Both changes commit together. A failed validation changes neither stock nor the task.
5. **Mark done** and **Reopen task** keep the assignment and notes. Reopening does not consume or undo inventory. If stock later falls below a previously completed task's target, the current gap remains visible independently of that task's completion.
6. Filter the board to see work still to do, in progress or completed. The top of the page shows completed tasks, current gaps and saved missions.

Task and inventory revisions detect a change made through another client. An outdated save is rejected and the browser reloads the current saved state, so you can review before trying again. Adding a task uses a stable request ID for retries of the same form, avoiding a second task after an uncertain response.

A mission supports up to 256 tasks. Inventory supports up to 128 distinct item names, with nonnegative whole counts up to 10,000. Existing stores with more names retain their contents; they can update existing counts without adding more names. Titles, names, dates and notes are checked by the MCP service as well as the form.

## Prepared shopping and household reminders

Open **Prepared shopping and household reminder** to review the original content and choose an action. Approve it, then execute it as a separate step. A shopping action prepares a local handoff; a reminder writes the local household outbox.

Workboard edits do not rewrite an already prepared or approved action. For example, the shopping quantities that were approved before a restock remain in that action and receipt. Create a new mission when you need a new plan based on the updated stock.

**Local runtime and operation details** contains the existing preapproval probe, MCP-worker restart, receipt replay and session-detail download. Reloading a page, restarting the worker or restarting the complete host preserves the same saved mission. Replay returns the original completed operation, without adding another local effect.

## Download and reopen the complete workspace

**Download saved workspace** downloads the actual saved JSON: all missions, tasks, stock, approvals, operations, receipts and local outbox entries. It is a coherent completed-write snapshot. Keep it somewhere appropriate for household names and notes.

To reopen it, stop the host, select that downloaded file with `HEARTHLINE_STORE`, and start again. This is a complete workspace replacement selected at startup; it does not merge two households or silently overwrite another open workspace. The browser's separate **Download session details** captures the current session and selected mission for diagnosis.

## Use the same workboard from another MCP client

The existing seven tools are joined by five native tools:

| Tool | Purpose |
| --- | --- |
| `hearthline_get_inventory` | Read the saved item counts and inventory revision. |
| `hearthline_get_workboard` | Open a mission's tasks, assignments, completion and current supply gaps. |
| `hearthline_add_task` | Add a task; an optional stable task ID makes an uncertain retry recoverable. |
| `hearthline_update_task` | Save task fields against the expected task revision; optionally update supply stock atomically. |
| `hearthline_update_inventory` | Save changed counts against the expected inventory revision. |

Use the input schemas returned by `tools/list`. The browser negotiates MCP 2025-11-25, sends `notifications/initialized`, lists all 12 tools and makes real `tools/call` requests. The service's existing approval requirements continue to apply to shopping and reminder execution.

## Record the complete product workflow

The Node recorder drives the actual forms and reads results from the same native MCP endpoint. It assigns and completes work, restocks supplies, stops and reopens the whole host, opens a second mission without resetting inventory, returns to the first mission and downloads the saved workspace.

With Playwright and its Chromium/ffmpeg already available:

~~~sh
node hearthline-browser-demo/record-workboard.mjs --output hearthline-workboard-recording
~~~

The recorder refuses an existing output directory and uses its own persistent file and an available local port. It never opens your default household store. Optional `--dwell 2` sets readable pauses; `--no-video` runs the same journey with screenshots and the downloaded workspace. `PLAYWRIGHT_MODULE` can select an installed Playwright module and `CHROMIUM_BINARY` an existing browser executable. No dependency install is performed by the recorder.

Outputs include the actual downloaded workspace, before/after host-reopen snapshots, desktop and narrow-screen captures, a concise journey result, server log and the recorded WEBM when enabled. If ffmpeg and ffprobe are on PATH, the recorder also creates a single-threaded MP4 and verifies the captured duration is under three minutes.

The earlier `record.py` remains available for its focused approval/restart/replay demonstration; it now opts into a disposable workspace and the current 12-tool interface. Run recordings locally. No hosted Actions execution or paid service is required.

## Submission and source

Real in this demonstration: the browser, native MCP negotiation and calls, saved household work, durable writes, explicit approvals, local action execution and process restarts. The sample household/weather, local shopping handoff and local reminder outbox are identified in the interface. The recording does not represent an Alexa device session, model call, purchase or delivered household message.

This supplements the existing original entrant's work and compensation/prize rights. The original entrant retains the public video and final submission step. The official Amazon Build Ship Shape rules require a video under three minutes on YouTube or Vimeo; provide that URL and the public runnable source in the correct entry. Current rules and any entry-specific instructions govern the final submission.

- Official rules: https://amazonappdev2026.devpost.com/rules
- Official Alexa+ FAQ: https://amazonappdev2026.devpost.com/details/faqs
- Original source/judge material: `../hearthline-alexa-mcp/JUDGE_PACKET.md`

License: MIT; the existing copyright and license at `../hearthline-alexa-mcp/LICENSE` apply and remain unchanged.
