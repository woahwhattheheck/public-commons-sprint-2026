# Native staff, opportunities, public settings and reporting

This extension stays inside the CSKT Reviewed Migration WordPress plugin. It uses native posts, media, taxonomies, revisions, menus and WordPress capabilities. Activation registers the types and routes; it creates no people, vacancies, procurement notices, pages or media. Existing migration releases, attachment bytes and Engagement records keep their original ownership.

## Native staff and opportunity workflow

**Staff → Add Staff member** opens the normal WordPress editor. The native title is the person's name; content is the biography, excerpt is the list summary and the native featured image is the selected portrait. Departments and Topics use ordinary taxonomy controls.

The **Public details** box holds role/job title, public email, public telephone, office, hours and optional related profile URL. Save, Publish and Update use normal WordPress controls. Public fields are visible only for published, unprotected records. Archive keeps a published historical profile available to the explicit archive filter. Draft or Private removes public access.

**Opportunities → Add Opportunity** uses the same native editor. Choose Career or Procurement, reference, location, opening and closing times, state, application/bid URL, contact information and selected media-library files. Dates are entered in the site's WordPress time zone, including seconds, and stored as exact UTC dates. A closing time must follow the opening time. The picker stores distinct native attachment IDs, up to forty. Remove file removes that selection without deleting the media.

The saved state is open, closed, awarded, cancelled or archived. An open item is scheduled before its opening time, open until its closing time and closed at that time. An absent date stays absent. Native revisions retain public detail metadata and the archive marker. Restoring a revision returns those fields with the original native content. To unarchive without reverting other edits, choose the intended non-archived status and Update.

The block editor retains legacy detail-box DOM between saves. A successful normal metabox save therefore receives a read-only confirmation that its complete submitted fields equal current native metadata. Only that confirmed fingerprint becomes the next form's expected state. A competing edit or an unconfirmed save requires a reload to review the native record; confirmation never rewrites fields.

## Public settings and announcements

**Settings → Public site settings** edits public email, phone, address and hours. It selects existing published, unprotected native pages for these landing roles:

| Key | Role |
| --- | --- |
| home | Home |
| about | About |
| projects | Projects |
| documents | Documents |
| news | News |
| notices | Notices |
| staff | Staff |
| opportunities | Opportunities |
| contact | Contact |
| gis | Maps and GIS |

A zero ID means no selection. These choices supply links and native introduction pages to the theme. WordPress General and Reading retain actual site name, tagline and home-page behavior. The form links to those native settings.

Primary, Footer and Utility select existing WordPress menus. Other theme menu locations remain intact; menu items continue to be edited in the native Menus screen. Each change binds the original request UUID, settings revision, active theme and selected menu IDs. A concurrent change is rejected. Replaying an accepted UUID with its identical complete request returns the original receipt even if a selected resource is later withdrawn.

The optional announcement is one selected existing published, unprotected, unarchived native Notice. Its original type and start/end times determine when the banner can appear. Future and expired selections return no announcement; no notice is generated and public requests do not scan all notices.

The same form enables or disables aggregate reporting. Disabling collection retains previously recorded aggregate history and does not alter Engagement forms or submissions.

## Reporting desk

**Dashboard → Site reporting** presents an inclusive UTC range of up to 366 days. It shows daily totals, content/download activity with native edit links, and search-result buckets: no results, 1–9, 10–49 and 50 or more. Complete CSV and JSON downloads contain the selected range. The original Engagement desk is linked separately.

- Page views are observed first-party browser events, not distinct visitors.
- Searches retain only collection and result bucket. Raw queries, referrers, IP addresses, user agents and visitor IDs are not stored.
- Download-link clicks measure use of selected native links, not completed transfers.
- Users with the edit_pages capability do not emit public page events. Use an anonymous browser context for receiving.
- Browser blocking, cached pages with expired descriptors and rejected requests can reduce recorded counts. No third-party analytics service is required.

Each event has a random single-event UUID and a signed native descriptor. The same UUID cannot increment its bucket twice or identify another event. A short-lived hash receipt supports deduplication. Native cron removes expired receipt options; aggregate counters are retained. There is no configurable aggregate-retention control in this release.

## Theme and integration contract

### Types and metadata

| Native object | Stored data |
| --- | --- |
| cskt_staff | _cskt_staff, complete JSON string |
| cskt_opportunity | _cskt_opportunity, complete JSON string |
| Both types | _cskt_archive, string "1" or "0" |
| Both types | cskt_department and existing cskt_topic terms |

Staff JSON is exactly:

~~~json
{"roleTitle":"","email":"","phone":"","office":"","hours":"","profileUrl":""}
~~~

Opportunity JSON has kind, reference, location, opensAt, closesAt, state, applyUrl, contactEmail, contactPhone and attachmentIds. Dates are null or YYYY-MM-DDTHH:mm:ssZ; IDs are distinct native integers. Complete updates reject unknown and missing fields. Ordinary forms convert local date input to this representation.

Derived indexes _cskt_site_kind, _cskt_site_state, _cskt_site_opens and _cskt_site_closes support native date-sensitive queries. They follow accepted metadata saves and restoration. Original JSON and archive flag remain authoritative.

### Public functions

csktm_site_entry($postOrId) returns null for unavailable, draft, private or password-protected resources. Common fields are id, type, title, url, summary, contentHtml, modifiedAt, thumbnail, departments, topics and archived. Content HTML is sanitized stored content; this helper never recursively applies the_content.

The staff object holds the public fields above. The opportunity object holds its public fields, effectiveState, isCurrent and attachments, excluding the internal attachmentIds array. A selected public file descriptor is:

~~~text
{id, title, url, downloadName, mimeType, bytes, altText}
~~~

Bytes may be null when an offloaded native file exposes no size. A file attached to a private, password-protected or unavailable parent is omitted. Unattached media can be public when explicitly selected by a published owner. Missing files do not hide the whole opportunity.

The plugin appends one escaped cskt-site-details panel through normal the_content for singular staff/opportunity pages. Themes should call the_content once and use DTOs for list cards instead of adding a second detail panel.

csktm_site_query_args($args, $filters) composes existing tax/meta query relations with departmentId, opportunityKind (all/career/procurement), and opportunityState (all/scheduled/open/closed/awarded/cancelled/archived). Existing clauses remain nested intact. Themes retain their generic current/all/archived selection and avoid an opposing current-only clause when requesting archived opportunities.

csktm_site_config() returns:

~~~text
{
 schema:"cskt.site.public.v1", revision, siteName, tagline, homeUrl,
 contact:{email,phone,address,hours},
 pages:{role:{id,title,url}|null,...},
 menus:{primary,footer,utility},
 announcement:{id,title,url,summary,type,startsAt,endsAt}|null,
 reportingEnabled
}
~~~

This public DTO excludes settings request history, user IDs, private reports and Engagement submissions.

csktm_site_download_attributes($postId, $attachmentId=0) returns an escaped HTML attribute string or the empty string. Use it directly on the corresponding selected native download anchor; do not escape the returned string again. With one selected file, attachmentId may be omitted. The plugin annotates its original singular document link only when its URL exactly matches the selected native attachment.

### REST namespace cskt-site/v1

| Route | Access | Behavior |
| --- | --- | --- |
| GET /config | Public | Selected public configuration |
| GET /staff | Public | Current staff by default |
| GET /opportunities | Public | Open opportunities by default |
| GET /entries/{id} | Public | One published public DTO |
| POST /events | Original signed descriptor and same-origin request | Aggregate native event |
| GET /settings | manage_options | Complete private settings/history/menu identity |
| POST /settings | manage_options + edit_theme_options | Native settings CAS and original-ID replay |
| POST /editor-confirmation | Original editor nonce + edit_post | Read-only accepted-form confirmation |
| GET /report | edit_pages | Complete selected UTC range |

Collections accept page, perPage (up to 100), search, departmentId and archive (current/all/archived). Opportunities also accept opportunityState and opportunityKind. Responses include items, total, totalPages, next and evaluatedAt. Follow next until null.

Settings POST is {operationId,expectedRevision,expectedSelectionSha256,values}. Values contains contact, all ten page keys, all three menu keys, announcementNoticeId and reportingEnabled. Preserve the same body and original UUID when recovering; do not generate a new ID to retry an uncertain write.

A theme with a selected-page secondary search exposes its cached original WP_Query through the cskt_site_search_query filter only for a nonempty actual search. The reporting helper consumes its original found_posts and selected type. A theme may materialize that cached query on the filter call before the script is enqueued, then reuse the identical object in the template. The reporting helper performs no second query. Single-type post_type arrays retain their native collection scope.

## Native receiving and reopen

The companion site-browser-receiving.mjs exports:

~~~javascript
await receiveSiteCMS({
  browser,          // original owner's existing Playwright Browser
  adminContext,     // already authenticated on the original WordPress
  input,            // reviewed real source, no credentials
  directory         // original operation's private receiving directory
});
await inspectReceivedSiteCMS({adminContext, siteUrl, directory});
~~~

The callback launches no browser, PHP service, database or controller. The caller owns those resources and the original WordPress backup/restore. The callback creates temporary pages and an anonymous visitor context inside the supplied browser and closes only those objects.

Input schema is cskt.site.receiving.input.v1. Retain operationId, siteUrl, review {sourceReference,sourceSha256,reviewedBy,reviewedAt}, records, complete settings, a real source-based searchQuery and optional attachmentSha256 map keyed by native attachment IDs. Each record supplies stable key, native type, existing id or no id for reviewed new content, title, content, excerpt, complete details, departmentIds and topicIds. Supply an actual staff member and at least one available sourced opportunity. Both kind filters are checked, including an empty career result when no real vacancy exists.

The callback captures auto-draft IDs before Publish and preserves original source/operation identity. It publishes/edits supplied records, archives through a second meaningful Save in the same block-editor session, then restores accepted native revisions. It checks public details, department/kind filters, selected files, settings/menu/history, anonymous page/search/download events, same-event deduplication and complete native report downloads.

After the caller closes and restores the exact WordPress database and original media, inspectReceivedSiteCMS reads the same native IDs, publication state, complete text, taxonomy selections and public metadata. It reopens each retained native revision and downloads the same selected attachment ID, comparing its complete byte count and SHA-256 with the original receiving. Settings history, menu selections and complete daily/content/search aggregates must remain equal. Repeating the read-only inspection reuses its existing original-result-bound receipt after these checks; it does not replace the accepted receipt with a new timestamp. It creates no replacement records. Journals and exports belong in the original private operation artifacts, not public source.

An uncertain submitted native form is reconciled against its original ID. A submission that no longer matches the accepted expected result is not repeated automatically: retain the journal and review native state. A completed result reopens directly instead of replaying the browser workflow. Actual PASS receipts must come from this original run; syntax validation alone is not website receiving.
