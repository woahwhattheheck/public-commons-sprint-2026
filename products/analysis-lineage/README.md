# Analysis lineage and complete handover

Review an existing customer's completed analysis, publish its original dependency history to the configured OpenLineage collector, and deliver the exact events, native source bindings, receipt history and portable workspace.

The product combines the original Analysis database and browser, the maintained OpenLineage collector, the native Analysis MCP tools and the existing retained-file download engine. A saved plan owns its exact source and publication identity across interrupted responses, collector restarts and offline receiving.

Start with [OPERATING.md](OPERATING.md) for the selected installation, Applications setup, collector connection and browser/agent workflow. [RECEIVING.md](RECEIVING.md) joins the original complete native operation, its existing input and the full source/portable result. The detailed [Python and browser contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/ANALYSIS_LINEAGE.md) and [MCP contract](../../stellar-forge/mcp-paid-agent/ANALYSIS_LINEAGE.md) are included.

The named source selection is `analysis-lineage`. It includes the original `python`, `openlineage-workspace` and `analysis-lineage` contributions, the complete Python/native components and the original runtime installer. Use the selected release's Node 22.16+ runtime and Python 3.12+ installation.
