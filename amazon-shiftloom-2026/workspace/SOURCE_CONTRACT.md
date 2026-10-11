# Get Connected source contract for the retained coverage workspace

This contract supplies the original Galaxy/ShiftLoom operating workshare in Slack parent `1791583202.741709`. It accompanies the complete official OpenAPI document recovered on 11 October 2026 and the current vendor export instructions. The maintained ShiftLoom planner remains the coverage engine; the operating workspace owns source intake, explicit mappings, coordinator decisions, corrected versions and delivery.

## Original source package

The official [Get Connected API page](https://api.galaxydigital.com/docs/) names `api.yml?v=1.9.2` in its Swagger configuration. Its exact [OpenAPI YAML](https://api.galaxydigital.com/docs/api.yml?v=1.9.2) was retrieved with HTTP 200: **160,727 bytes**, SHA-256 `a9d44ad64f28f033d88ef460e5af57a284c66cbf8599b9666d38cb8c75e63e57`. `get-connected-api.yml.receipt.json` records the original URL and capture time. `get-connected-openapi.json` is its parsed representation. `get-connected-coverage-contract.json` selects the relevant field definitions and ten documented reads, retaining their original schema pointers.

The specification declares OpenAPI 3.0.0, API version 1.9.2, and three regional base URLs: `https://api.galaxydigital.com/api`, `https://www.volunteerapi.com/api` and `https://ca.volunteerapi.com/api`. Relevant operations use the declared `Authorization` header scheme. Current [site-manager API instructions](https://learn.getconnectedvolunteer.com/en/articles/11779226-site-settings-api) state a 200-request-per-minute limit, manager-created keys and one-year token expiration. Those instructions also assign external integration implementation and troubleshooting to clients' subject matter experts.

## Bind source identities before planning

The following bindings come from the original OpenAPI schemas. The included machine-readable contract preserves complete definitions and pointers.

| Planning object | Native source binding |
| --- | --- |
| Opportunity and occurrence | `needObject.id`, `domain_id`, `need_title`, `shifts[]` |
| Shift interval and capacity | `shiftObject.id`, `start`, `end`, `duration`, `slots` |
| Existing response | `responseObject.id`, `shift`, `need`, `user`, `response_status` |
| Response provenance | `response_date_added`, `response_date_updated`, `team`, `answers` |
| User identity and state | `userObject.id`, `domain_id`, `user_reference_id`, `user_status` |
| User qualification | `userQualificationsObject.qualification_id`, `status`, `expires` |
| Qualification definition | `qualificationObject.id`, title, level and duration |
| Custom response answer | `ResponseAnswerObject.key`, `area`, `question`, `answer` |

Treat native IDs as strings and retain their source domain. Keep the opportunity ID and occurrence ID separate. Preserve complete timestamp strings, then apply the coordinator's declared site timezone to any offset-free source value. A recommendation must refer back to the exact occurrence, source row and input version.

`GET /needs/{id}/responses` returns the full response schema with the explicit shift/user relationship. The corresponding user-specific response projection has a different shape. Configure each input from the endpoint or export actually selected.

## Current exports and operator intake

[Shift schedule exports](https://learn.getconnectedvolunteer.com/en/articles/10179128-how-to-export-schedule-data) allow individual, date-selected and all-shift exports. The operator chooses the columns. The all-shift report includes historical shifts. Therefore the application should display the actual input headers, chosen reporting scope and row count, retain those originals, and save an explicit mapping before preparing a scenario.

The [agency schedule guide](https://learn.getconnectedvolunteer.com/en/articles/10179618-the-schedule-page-agency-managers) provides separate exports for the **Shifts** and **User Responses** tabs, including selected-day responses and a monthly view. The [program-manager scheduling guide](https://learn.getconnectedvolunteer.com/en/articles/10179073-scheduling-volunteers-program-managers) documents equivalent exports for Amplify program managers. Product, role and site configuration determine which path the coordinator uses.

[Site-manager response instructions](https://learn.getconnectedvolunteer.com/en/articles/10179574-need-or-opportunity-responses-site-managers) describe one response per selected shift, a date-scoped CSV export and a separate canceled-response view. Include the response's actual state when reconstructing assignments. Keep the source response count separate from filled capacity where a team reserves additional slots.

[Qualification reports](https://learn.getconnectedvolunteer.com/en/articles/11874364-amplify-site-managers-qualification-reporting) include a detail view filtered by program, qualification and status. The detail rows are the useful input for individual eligibility; aggregate counts support reconciliation. [Custom response questions](https://learn.getconnectedvolunteer.com/en/articles/10179454-response-questions-site-managers) are included in response CSV exports and apply across opportunity forms. Bind a configured question key and its actual interpretation rather than inferring meaning from an answer's text alone.

The vendor's [data-import template guidance](https://learn.getconnectedvolunteer.com/en/articles/14782791-data-imports-templates) describes user, opportunity, hours and qualification column families. Its qualification layout includes an identifier, title, user email, status, response and expiration date. These are import-preparation examples; the operating workspace should preserve the actual export's headings and offer an editable mapping.

## Qualification and availability decisions

Qualification responses carry distinct active, pending, inactive, expired, rejected and resubmit states in the API. The [qualification configuration guide](https://learn.getconnectedvolunteer.com/en/articles/12022431-center-site-managers-creating-qualifications) says duration starts at submission, when the record enters the profile. Approval may occur later. Preserve the returned expiration date and coordinator rule for evaluating that date against the scheduled interval.

The [August 2026 release notes](https://learn.getconnectedvolunteer.com/en/articles/13342576-product-release-notes-2026) add a five-year qualification duration; that value is absent from the older 1.9.2 YAML enumeration. The same notes document opportunity age requirements introduced in May. The workspace should retain unknown source values for review and use explicit current requirement mappings, so an older schema enumeration cannot silently discard valid current configuration.

Availability, preference, maximum bookings, role-to-qualification requirements and other coordinator eligibility decisions are explicit planning inputs. The source package supports retaining a volunteer/occurrence availability matrix, selected response-question interpretation or coordinator-authored decision alongside its source and timestamp. The vendor's available-volunteer screen distinguishes prior responses, waitlists and people who can be invited. Preserve that meaning when using its output.

Recommended operating flow:

1. Retain the original user, shift, response and qualification files with capture time, source role, declared scope and row counts.
2. Map exact identity, status, timestamp and relationship columns; inspect unmatched, duplicate and unresolved source rows.
3. Save coordinator requirements and explicit availability, including the interpretation of qualification expiry and existing reservations.
4. Freeze this source/rule version for the original planner. Display each candidate's source-linked reason and assigned coordinator decision.
5. Retain corrected source files as a new version, rerun the same scenario and compare the actual changes before accepting a revised recommendation.
6. Export the selected input inventory, mapping, coverage result, coordinator decisions and source-linked handoff for continued operation.

## Paging and source completeness

The YAML documents up to 150 records per collection request. The user listing explicitly includes a one-based page parameter, `links` and page metadata. Other selected collection operations document incremental filters but different response shapes. Retain actual request parameters and response continuation metadata. A selected report scope and its original row count should remain visible throughout intake and comparison. Do not silently turn an incomplete capture into the complete roster.

## Jefferson controlling-source continuation

The original [26-093026V-HSIT / 0000438892 listing](https://www.bidnetdirect.com/colorado/solicitations/open-bids/Volunteer-Management-Platform/0000438892?purchasingGroupId=8409951&origin=2) was retrieved on 11 October 2026 with HTTP 200: **54,816 bytes**, SHA-256 `0e66422143d6309aeadae1d02a476617874462d789e79130af4781eeb3830e28`. It prints publication on 1 October and closing on **22 October 2026 at 5:00 PM MDT**. The original HTML and receipt are included.

The current packet request is in the same OPE05 thread at `1791747219.767669`, operation `ope05-jeffco-rfi-source-f47a-20261011`. It asks the existing signed-in member-session carrier for the buyer's complete RFI, current addenda, contact and response instructions. That packet will supply the buyer-specific delivery and commercial scope in the existing workshare.
