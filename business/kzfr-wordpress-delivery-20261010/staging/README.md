# Run the existing candidate in WordPress

This launcher mounts the existing sibling theme and plugin in an isolated WordPress
installation. It creates a fresh disposable SQLite database on each launch. Stopping
the process discards editorial changes in that database; the source files remain.
It does not connect to a customer database, Creek API or payment processor.

Requirements: Node 24.18 or newer, npm and internet access for official WordPress,
the official Twenty Twenty-One theme and PHP-WASM downloads. No PHP, MySQL or Docker
installation is required. WordPress is pinned to 6.8.3, PHP to 8.3, and the official
Playground CLI to 3.1.57. This is a reproducible compatibility target, not a claim that
6.8.3 is the current production release. Choose supported versions for production.

From this directory:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm start
```

Open the printed local address, then `/wp-admin/`. Playground's local demonstration
login is enabled. Five unmistakably fictional program, event and underwriter records
are seeded. They exercise the actual WordPress database, plugin, child theme and
official parent theme. A past event is intentionally omitted from the upcoming page.
`KZFR_STAGE_PORT` optionally changes the default port 9413. On a proxy-managed Node
24 installation, set `NODE_USE_ENV_PROXY=1` using the existing proxy configuration.

## Staff walkthrough

1. In **Programs**, edit **Demo: Evening Jazz**. The **Station details** panel contains
   the labeled Creek URL field; program genres use WordPress's native taxonomy panel.
2. Save an approved Creek archive URL, then view the program. The audio handoff uses
   the same existing trusted provider. A blank value deliberately removes the link.
   An invalid nonblank value keeps the previous link and presents a correction notice.
3. In **Community Events**, edit **Demo: Open Studio** with the date picker. The event
   archive uses the station's configured `America/Los_Angeles` calendar date. Change
   the date to the past and review its removal from upcoming events.
4. In **Underwriters**, edit **Demo: Community Books** and its approved HTTPS website.
5. Review `/programs/`, `/events/`, `/underwriters/` and the home page. These are real
   PHP-rendered WordPress templates, not a separate static mockup.

For the one focused editor integration check, run `npm run check:editor`. It runs the
actual WordPress save hook and metadata API, renders four routes, records status and
page byte counts, and exits. Output goes in ignored `output/`. It does not run existing
unit harnesses, a repository suite, browser acceptance, performance or accessibility
audits. It is intended only to verify this editor/runtime slice when it changes.

The remaining delivery work is actual owner-approved migration, documented Creek
integration, supported production hosting and updates, formal accessibility/performance
acceptance and staff handover. The fictional local content is never migration input.

Runtime documentation: https://wordpress.github.io/wordpress-playground/guides/programmatic-playground-cli/
