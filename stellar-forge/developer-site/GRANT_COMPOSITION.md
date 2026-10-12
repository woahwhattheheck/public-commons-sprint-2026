# Compose the maintained SCF application

The reviewer page, application download, product and finance companion, and source index are one edition. The composer refreshes that edition from the complete maintained manuscript and the installed product sources.

Run from this developer-site directory with Node.js:

```bash
node grant-compose.mjs \
  --manuscript /path/to/current-canonical-application.md \
  --fred-commit be44be564e35b63af23246bad531a95374bbb4c0 \
  --coops-commit 92eb1c73a3cab9781ef7dbabdc12067344fb6aa2 \
  --datasette-commit b1a6ad827c02cdf95c613b23ef07ce1996400fd6 \
  --datasette-publisher-commit ab876f6dc2ad24b7938f6b928202d78fbdeef777 \
  --source-pins-output /path/to/current-grant-source-pins.json
```

The example selects the installed economic, coastal and Datasette sources received on October 12, 2026. For a later product edition, select its actual source commit. An omitted product option retains the corresponding current source-index selection. Both Datasette source commits travel together.

## Receive the complete manuscript

The manuscript has one “Reviewer application” heading followed by the nine answers in their original order, then “Detailed application and source material.” The command extracts those answers and replaces the corresponding prose in the original reviewer shell. The existing tenth section, installed examples, film, budget, and other static assets remain in the same site.

The economic, coastal and Datasette modules receive their selected complete customer installations. The customer module also receives the complete accepted Webhook and referral-implementation sections and both OpenFn paragraphs, preserving the companion's other chapters and its six-package allocation table. An H2 section ends before the next H1 or H2; its more detailed headings remain part of that section. Repeated composition updates those sections in place.

The Markdown download retains sibling links to the companion. The HTML reader resolves those same links through grant-data. Public correspondence labels retain their substance while private Slack and mailbox destinations are removed from the public edition. The complete original manuscript remains the editorial source.

The source register follows the public customer source URLs. A changed source URL invalidates its former file-blob identity until that file is explicitly received. Public index generation removes private correspondence links and computes file sizes and hashes after projecting the complete text.

## Publish the complete edition

Composition writes these existing files:

- dist/grant.html
- dist/grant-data/application.md
- dist/grant-data/product-and-finance.md
- dist/grant-data/source-index.json

The emitted source-pins JSON contains exactly those four routes and their resulting Git blob identities. Supply it as sourcePins to the existing grant receiving operation. Its original default pins remain available for the original edition. The browser asset manifest separately selects the complete installed UI and its dependencies.

Publish the same complete dist directory through the established Site project. Keep the application and source index together when transferring the edition: the submission editor receives the original application size and hashes from that index.

## Continue editorial work

The submission workspace reads this same application and source index. Receiving a newer original edition updates untouched answers while preserving manually edited answers and their earlier baselines. The operator can compare those changes, explicitly receive an answer, retain a saved version, or export the complete working draft.

The funded amount, hours, duration and nine-answer ordering are retained by the composer. Product and customer updates belong in the complete source manuscript and companion; the source join carries them into the existing application.
