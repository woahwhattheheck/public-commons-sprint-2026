# Station service and editorial integration

This is an independent development candidate for the KZFR redesign opportunity. It has not
been deployed to KZFR or accepted by the station. The listener-facing templates show the
intended radio experience; this document records development status and source limitations.

## Staff workflow

In **Appearance → Customize → Station service links**, an administrator can preview and
save the Listen live, Audio archives, Program schedule and Donate destinations. WordPress
stores these as child-theme settings and requires its `edit_theme_options` capability.
Clearing a field hides that service's calls to action. Invalid values receive a native
Customizer validation error and cannot replace the saved destination.

The homepage, header, footer, program profiles and program archive share those settings.
Links open in a separate tab with a screen-reader announcement. Service URLs are restricted
to the relevant existing station or Creek HTTPS hosts; user-info, explicit ports and
control characters are rejected. No service request is made while saving settings or
rendering pages. An independently corrupted stored setting falls back to its source default.

## Verified source defaults

The official [station homepage](https://kzfr.org/) supplied these links on October 10, 2026:

| Service | Default | Source observation |
|---|---|---|
| Listen live | `https://kzfr.org/listen` | Official footer Listen destination; page also links to `listen.kzfr.org`. |
| Audio archives | `https://kzfr.studio.creek.org/archives/` | Official Archive destination; JavaScript app. |
| Program schedule | `https://kzfr.org/programs` | Official header Shows destination; returned weekday navigation and scheduled shows. |
| Donate | `https://kzfr-donate.creek.org/` | Official Donate destination; JavaScript app. |

The old footer Shows link to `/programlist` returned 404 and is deliberately not used.
These observations confirm public destinations, not live audio playback, Creek API access,
donor transactions or an authorized integration with the station's accounts.

## Existing editorial data

- `kzfr_creek_url` supplies the program's audio link, using the companion plugin's sanitizer.
- `kzfr_event_date` supplies the event date. Homepage and archive queries show published
  upcoming events, sorted by that date; event pages use semantic `time` elements and the
  WordPress date format/timezone. Event archive pagination reaches subsequent records.
- `kzfr_underwriter_site` supplies the website link on underwriter cards and detail pages,
  using the companion plugin's HTTPS sanitizer.

The theme creates no program, event or underwriter records. Empty data produces an empty
state. Program-profile publication-date filters remain explicitly labeled; they are not
represented as broadcast-date filters. Staff panels and CSV import belong to the companion
plugin and are unchanged by this theme contribution.

## Review and operation

Requires the existing Twenty Twenty-One parent and Editorial Bridge companion plugin.
The change extends their current templates; it introduces no new runtime or test suite.
Source was reviewed locally; real WordPress runtime acceptance is owned by the shared
staging integration lane and is not claimed here. Existing work still needs authorized
station content, actual Creek integration, accessibility/performance acceptance and
deployment review before live use. No fabricated live/on-air state, donor results or
program schedule is supplied by the theme.
