# Scientific setup operator desk

Open **Scientific setup** in the existing operator navigation. The desk prepares the actual saved study setup for the original customer review workflow.

## Prepare and review

Choose the saved model grid, parameter profile, baseline, and alternative scenarios. Describe the scientific question, the reporting area and contributing-domain rationale, the intended validation comparison, and the reviewer/operator responsibilities. Select additional source collections and saved observations when relevant; the backend includes source collections already bound to the selected grid, profile and scenarios.

The requested grid resolution and alternative count are comparison targets. A difference is shown as a review finding beside the actual saved definition. Clear either field when no target is requested. A new Eco setup starts with the proposed 30 m grid and two alternatives.

**Preview setup** reads the selected originals and presents the grid definition, prepared input provenance, original parameter profile, exact scenario definitions, source coverage and units, observations, validation plan and review findings. Raster headers are captured when the setup is retained.

**Retain setup and create review** uses the existing retained task API. The same operation identifier survives a network interruption; reopening the desk offers continuation of that request. Completed setups appear in the project history with their original file downloads.

**Open customer review** dispatches the original operator's `review-open` action. Review decisions, export, returned responses and reconciliation continue through Customer reviews and Returned responses.

## Continued editing

Form drafts are retained separately for each workspace and project. Reopening a saved setup shows its original captured specification. **Use as a new setup** restores that selection into the form so a revised setup can be previewed and retained without modifying the original review selection.

The desk composes through the maintained extension registry. Its descriptor registers the two browser assets, the scientific setup provider, its task action and read routes, workspace overview, task decoration and original-backup verifier. Reload the existing operator after installing all backend and browser dependencies.

The browser uses existing operator layout and task conventions with scoped neutral styles. Provider values are escaped; large original definitions remain available in expandable sections. Requested targets, unassigned roles, unavailable saved selections and raster headers awaiting capture are represented explicitly.
