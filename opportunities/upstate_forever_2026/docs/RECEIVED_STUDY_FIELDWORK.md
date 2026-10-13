# Open the editable work behind a received scientific report

A selected Study archive contains the original saved scientific reports and, for same-project Implementation sources, their editable native plan history. The Study transfer desk now opens that received work directly.

## Receive and reopen

1. Use **Receive study archive**, or the existing Project transfer restoration, to receive the complete original archive.
2. Switch to the restored Workspace. Open **Study transfer**.
3. Under **Received studies and original fieldwork**, choose **Open study**. The title, captured date, scientific report count and editable plan count come from its retained native Study transfer.
4. Download the complete original scientific report or its individual files. Original report order, tables, figures and companions remain the saved edition.
5. In an Implementation source, choose **Open source revision**. The existing Implementation desk opens the historical revision that produced that scientific source. When later edits exist, **Open latest editable plan** opens that separately.
6. Retained plan reports appear by their actual saved revision and report date. The original source report is identified explicitly.
7. Crew packets list their original title, revision and visit count. Download the complete ZIP or original files; **Open packet’s saved plan** opens that packet’s historical revision.

The existing fieldwork editor preserves a browser draft before opening a native saved revision. Ordinary native save/reconciliation remains responsible for concurrent edits.

## Use an original crew packet

Unzip the complete crew packet. Open `field-workbench.html`, choose **Open JSON**, and load `original-plan.json`. Record actual work and export the edited plan. Import that edited file in the original Workspace using the existing fieldwork review/reconciliation controls. When the plan came from Monitoring, its maintained fieldwork-return action updates the original campaign.

Every completed deployment currently retained with the original editable plan can be opened. A packet captured with the Study is labeled accordingly; a later completed packet is shown as a later native addition. Interrupted deployment trees remain available to the existing native preparation operation and are not shown as completed packets.

## Original source identity

Whole Implementation reports, Outcomes comparisons and field-observation contexts retain their explicit producer identities. The receiving view reads the exact `study-transfers/<id>.json` record, checks its original project and identity digest, then uses the maintained selected Study dependency resolver and original report/Implementation receipt validators.

The source revision and selected report remain fixed while current native revisions and later report editions remain available. A source from a different project keeps its original project and contained plan in the scientific source files. An unrelated local plan with a matching text ID is never selected for that source.

The catalogue pages retained Study records without resolving every report. **Open study** resolves one original selection and validates its original dependencies. File downloads use the existing authenticated ticket service. This view creates no scientific run, plan, report edition, or replacement receiving identity.

## Installed application

The implementation adds `model/study_receiving.py`, `operator/study_receiving.py` and `operator/web/received_studies.mjs`, joined into the existing Study transfer provider, descriptor and panel. The current selected Study transfer continues to own capture, receiving and source resolution; the current Implementation extension continues to own plan editing. The component fragment includes the complete new paths for both installed and transferred application source.

The browser keeps only the selected Study ID. On reopen it reads the current native saved receipt again. Workspace changes and late network replies cannot switch the receiving detail or open a plan in another Workspace.
