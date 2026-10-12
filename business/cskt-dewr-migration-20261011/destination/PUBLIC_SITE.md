# DEWR public website and staff operation

The DEWR theme and the Reviewed Migration plugin form one native WordPress website. The theme supplies the public navigation, page and collection layouts, search, reading styles and responsive behavior. The plugin owns reviewed migration routes, documents, maps, notices, staff, opportunities, engagement and aggregate reporting. Staff use ordinary WordPress accounts, posts, media, menus and revisions.

The source package includes the whole operating migration workspace. Keep its original database, source capture, release history and destination configuration with the native WordPress backup. The commercial migration workshare remains defined by `commercial/WORKSHARE.md`; agree any additional website implementation scope in the original commercial case.

## 1. Install on the selected WordPress site

Use the existing site selected for the migration. Preserve its database, media, installed plugin directory, active theme and current configuration before updating. The supported theme target is WordPress 6.8 or later; the native operating case uses WordPress 6.8.3 with PHP 8.3.6. Use the destination requirements in [DEPLOYMENT.md](DEPLOYMENT.md) for the migration service and permissions.

1. Copy the complete `destination/wordpress-plugin/` directory into the installed `wp-content/plugins/cskt-migration/` directory. Keep the Engagement files in the same plugin. The registration file loads the original migration and engagement modules plus the public-site extension.
2. Copy the complete `destination/wordpress-theme/` directory to `wp-content/themes/cskt-dewr/`. Its `style.css`, `functions.php`, templates, `inc/` and `assets/` must remain together.
3. In **Plugins**, activate **CSKT Reviewed Migration** if it is not already active. For an upgrade of an active installation, visit **Settings → Permalinks** and save once after installing the new post types.
4. In **Appearance → Themes**, activate **CSKT DEWR**. The theme changes presentation; the native content, attachment IDs and migration history stay in WordPress.
5. Use **Settings → General** for the actual site name, tagline, site time zone and public URLs. Select the intended published home page in **Settings → Reading**. Set the WordPress time zone before entering deadline or notice dates.
6. Open **Settings → Public site settings** to select the existing pages, menus, contact details and optional announcement. Use the published receiving site's actual values.

Activation registers capabilities, content types and routes. Staff populate the website from reviewed real content. Installation does not create sample employees, job openings, procurement notices or client testimonials.

The maintained-source ZIP is a complete engineering delivery. To use WordPress's theme ZIP uploader, package only the `cskt-dewr/` theme directory at the ZIP root; use the complete-source archive for the operating handover.

## 2. Choose the information architecture

The public settings screen selects published native pages for each landing role. The page's own content provides the introduction. For collection roles, the theme adds the corresponding search, filters and native results below that introduction.

| Public role | Native content and intended use |
| --- | --- |
| Home | The published page selected under WordPress Reading; introductory content and links into current resources |
| About | A selected native Page with the division's approved description |
| Projects | Native Projects and each project's original documents, maps and content |
| Documents | Native Documents, file descriptions, edition labels and downloads |
| News | Native Posts, publication dates and ordinary post content |
| Notices | Native Notices and their original type, location and schedule |
| Staff | Native Staff members, roles, departments and approved public contacts |
| Opportunities | Native Careers and Procurement, current status, deadlines and selected files |
| Contact | A selected native Page, with approved public contact details also used in the footer |
| Maps and GIS | A selected native Page with original map resources and their text equivalents |

Give distinct collections distinct introduction pages. The page selection supplies public navigation and presentation; **Settings → Reading** retains WordPress's home-page and posts-page configuration.

When a collection has no selected introduction page, the theme links to its native search collection at the home origin. This works when an earlier reviewed migration already owns a familiar path such as `/documents/`. Existing migration paths, adopted pages, consolidation redirects and HTTP 410 decisions remain attached to their original release. Use native WordPress URLs for search, archives, taxonomy terms, previews, feeds and sitemaps.

### Menus and page hierarchy

Create or edit menus in **Appearance → Menus**. Assign **Primary navigation**, **Utility links** and **Footer links**, or select the same existing menus in Public site settings. The primary layout displays up to three levels. Utility and footer links display one level.

A primary fallback menu links to the configured pages and available native collections. The theme omits missing About and Contact selections instead of creating a destination. Native menu items let staff choose external links deliberately.

Breadcrumbs reflect the native page hierarchy or content collection. The section navigation on a Page comes from its actual parent and published child pages. Use WordPress's page parent controls to maintain this hierarchy; changing a title does not require editing theme source.

The menu button is a normal keyboard-operated control. With JavaScript unavailable, navigation remains visible. At a narrow width, the enhanced menu opens and closes with its button; Escape closes it and returns focus.

## 3. Publish and maintain the content

### Pages, news and projects

Use the ordinary WordPress block editor for headings, paragraphs, lists, tables, images, video and supported embeds. Give each page a clear title and a logical heading sequence. The theme uses the original content once and retains the migration plugin's document, map and notice panels.

The editor includes three DEWR patterns:

- **Project overview** supplies a readable project introduction and an ordered set of content sections.
- **Project milestones** supplies dated milestones using ordinary editable blocks.
- **Before and after images** supplies the structure for two actual native images and their captions.

Patterns provide editing structure. Replace instructional text with the reviewed project material, and select the actual media from the native library before publishing.

Wide data tables retain their native headers and cells. The public script places a wide table in a labeled keyboard-focusable scroll region. The content also remains readable without the enhancement. Print styles remove navigation and controls while retaining the article, tables and document content.

### Documents and maps

The existing **Content details** panel owns the selected native document, edition, family, download name, description and file alternative text. Use **Choose or upload file** to select the intended original attachment. A later edition remains a new attachment with its own bytes; earlier versions stay in the media library and native revision history.

The original document link can emit a download-link event for the selected public native attachment. Reporting counts link use; the file is delivered through WordPress's normal media URL. Native page and opportunity templates use the same selected attachment identity.

For each GIS resource, keep the original ArcGIS item ID and published application URL. Provide the text equivalent that explains the information a reader needs when the embedded map cannot be viewed. Use the migration workspace's captured original provider data while making that editorial decision. A map link and an explanation continue to be available alongside the embed.

### Staff directory

Open **Staff → Add Staff member**. Use the person's name as the native title, an approved biography as content, an optional list summary as the excerpt and an approved portrait as the featured image. The **Public details** panel holds role, public email, phone, office, hours and a related profile URL. Department and Topic use native taxonomy controls.

Only published, unprotected public records appear. A native public portrait is rendered when its selected attachment is available to the published record. Leave unavailable biographies, office hours and portraits empty until real source material supplies them.

A current staff list is the default. **Archive** retains an historical published profile for the explicit archive view. Use Draft or Private when the content should no longer be public. Native Revisions restore the corresponding public details and archive selection with the content.

### Careers and procurement

Open **Opportunities → Add Opportunity** and choose **Career** or **Procurement**. Maintain its reference, location, opening and closing times, state, application or bid URL, contacts and actual native attachments. Dates use the configured WordPress time zone and retain UTC values in native metadata.

An open opportunity with a future opening time is scheduled. It is open after that time and closes at its closing time. Staff can select closed, awarded, cancelled or archived explicitly. An absent date stays absent. A closing time follows its opening time.

The default opportunity collection shows open items. Readers can select Careers or Procurement, change the opportunity state, select a department or topic, and use the text search. A type with no current entries shows the ordinary empty-result state. Staff use actual available openings and tenders.

### Notices and the announcement

Native Notices retain their original type, location and start/end times through the existing Content details panel. Public site settings can select one published, unprotected, unarchived Notice for the site-wide announcement. Its original schedule determines when the banner appears. An expired or future announcement stays in native content and is absent from the current banner.

Use the native title, short summary and link so readers can open the complete notice. This selection does not change engagement publication or create an extra notice.

## 4. Search and browsing

The search page covers the available public native types: Pages, Projects, Documents, News, Notices, Staff and Opportunities. Collection pages keep readers within their selected type. Results contain the native title and URL, content type, summary, update time and applicable document, staff or opportunity details.

Readers can combine a search with Topic, Department where applicable, Current or Archived publication, and Updated, Newest or Title order. Opportunity collections additionally expose type and effective state. Pagination retains the selected query and filters. Twenty results appear per page.

Search includes published, unprotected content. Staff previews use WordPress's native routes and account permissions. Existing taxonomy clauses remain part of the native query when additional filters are selected.

A selected introduction page uses its own cached WordPress query for the collection. The reporting extension consumes that same query and its actual result count through `cskt_site_search_query`. The template reuses the query when rendering results, so the recorded collection and result bucket describe the displayed search.

## 5. Presentation and accessibility

The visual system uses a neutral palette, system fonts, clear borders, square controls and ordinary text links. The content column is limited for reading and the overall layout can accommodate tables, maps and result filters. No third-party font or theme framework is required.

The theme supplies a skip link, labeled landmarks and form controls, visible keyboard focus, a single page title, native breadcrumb semantics and responsive content. Controls are at least 44 pixels high. Portraits and editorial images use actual alternative text supplied in WordPress.

A before-and-after comparison is enhanced only when the selected source contains two usable images with matching proportions. Both originals remain available. The comparison control has an accessible label and a keyboard-operated range input; choosing **Show both original images** returns to the original presentation. Use descriptive captions and an editorial text explanation for the change shown.

Staff remain responsible for the content decisions that affect accessibility: meaningful headings and links, accurate alternative text, table headers, video captions/transcripts, map equivalents and document remediation. Use the actual source material and the agreed acceptance scope when preparing them.

## 6. Reporting and engagement

Open **Dashboard → Site reporting** for page views, search outcomes and document-link activity. Select an inclusive UTC range of up to 366 days, then download the complete CSV or JSON. The report links each native content resource back to its editing screen.

The reporting settings collect first-party aggregate events. They do not store raw search queries, visitor IDs, referrers or IP addresses. Signed descriptors bind a reported event to its selected resource, and the same event UUID increments its aggregate only once. A browser with an account that can edit pages does not emit public visitor events. Use a separate signed-out browser to inspect public reporting.

The report retains its existing aggregate history when collection is disabled. Browser blocking and caching can reduce observations. Treat page views as events, searches as recorded result buckets and downloads as link clicks.

The original **Engagement** workflow remains part of the same plugin. It handles the four supported modes, their publication schedules, accepted original submissions and staff processing. Follow [ENGAGEMENT.md](ENGAGEMENT.md) for its complete account, form, export and transfer procedures.

## 7. Receive the website on its original native site

Receive changes against the chosen site's existing database, media, native accounts, migration releases and engagement records. Record the original source revision and retained native IDs. Exercise the public site in an anonymous context and editorial tasks with the site's actual staff account.

The supplied `site-browser-receiving.mjs` attaches to the caller's existing Playwright browser and authenticated WordPress context. It owns its temporary pages and signed-out visitor context. The caller owns WordPress, the migration controller, browser lifetime and native backup/restore. See [SITE_CMS_API.md](SITE_CMS_API.md) for the full input and callback contract.

Use actual source-based staff and opportunity records, complete settings, selected page/menu IDs and real attachment bytes. Preserve the same operation and original native form IDs after an interrupted response. The callback covers publishing, a second meaningful archive save in the same editor session, native revision restoration, filters, settings, announcement selection, anonymous report events and complete exports.

For the full presentation, inspect the following on the actual site:

| Area | Receiving result |
| --- | --- |
| Original routes | All selected migrated page URLs, original consolidation and withdrawal decisions, document downloads and native preview/search routes behave as intended |
| Public navigation | Home, selected landing pages, hierarchy, menus, breadcrumbs, footer contacts and narrow-screen navigation open their original native destinations |
| Content | Original page HTML, migrated image bytes, native document metadata, GIS text equivalents, staff and opportunity details remain readable |
| Search | Actual collection, query, filters, order and following pages agree with the displayed results and search report |
| Staff operation | Named native editor publishes, updates, archives and restores actual content and complete public details |
| Engagement | Original published forms and original accepted responses retain their identities through the joined plugin update |
| Reporting | A separate visitor context records actual page/search/download events and produces the complete selected report |
| Restore | Reopened native database and media retain original IDs, selected settings, accepted changes, revisions and report aggregates |

Receiving results belong to the actual retained operation. Source syntax checks and engineering review are recorded separately from the native browser outcome. A failure resumes the same original site's saved state.

## 8. Back up, restore and hand over

Keep a consistent WordPress database backup with the complete uploads directory, active plugin/theme source, site configuration and original runtime dependencies. Keep application passwords and native account material private. Preserve the migration workspace's operating export, SQLite backup, original source capture and immutable releases alongside the destination backup.

Close the original service handles before copying a stopped SQLite installation, or use its native backup API while it is running. Preserve the complete SQLite database directory, including its selected database identity. On MySQL/MariaDB, use the host's consistent native database backup. Retain media and private upload staging required by accepted or incomplete original migration operations.

Restore into the selected receiving location with the same native account, post, media, form and request identities. Adjust only the required environment paths and public URL configuration through the corresponding native process. Reopen the original site and use `inspectReceivedSiteCMS` to compare retained records, public details, settings/menu history and reporting. A migration workspace restore and WordPress content rollback remain distinct native operations.

The receiving owner should be able to edit a page, replace a document edition, revise a map explanation, change a staff contact, close a procurement notice, select an announcement, review engagement responses, export reporting and reopen a backup. Deliver the full maintained-source ZIP and the corresponding native operating archive together with the completed commercial handover.

## Source references

- [CSKT DEWR website RFP](https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf) and [original procurement page](https://csktwatercompact.com/documents-and-links/).
- [Official DEWR division and staff page](https://cskt.org/natural-resources/dewr/).
- [WordPress classic template hierarchy](https://developer.wordpress.org/themes/classic-themes/basics/template-hierarchy/), [native menu registration](https://developer.wordpress.org/reference/functions/register_nav_menus/), [theme support](https://developer.wordpress.org/reference/functions/add_theme_support/) and [main-query modification](https://developer.wordpress.org/reference/hooks/pre_get_posts/).
