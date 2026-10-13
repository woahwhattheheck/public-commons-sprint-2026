# Named team access for the scientific operator

The existing operator now supports named people with explicit project access.
Its scientific engines, source identities, retained task queue, detached native
workers and project-transfer formats remain the original maintained application.

## Start and assign the installation

Use the same scientific Python environment and retained directories:

~~~sh
python -B operator/server.py \
  --workspace /absolute/projects/upper-savannah \
  --operator-state /absolute/installations/scientific-operator \
  --port 8765
~~~

Use a fixed local port for access links that remain usable after a normal restart.
The listener retains its original 127.0.0.1 boundary and Host/Origin checks.
Team access works in separate browser profiles on that installation, or through
an existing authenticated local forwarding arrangement that preserves the exact
operator origin. This change does not create a public network listener.

Keep operator state outside every scientific workspace and outside application
source. The server rejects configurations that would put its private access
registry inside a scientific/application archive. A restored workspace can live
under the receiving directory inside operator state: its own project directory
must still exclude the enclosing installation state.

Open the complete startup URL printed by the original server. That process-local
capability identifies the local installation owner. In the sidebar choose
**Manage team access**, add each person, choose their project roles, and give
that person the displayed private link through the intended private channel.

The link appears once. The installation retains its SHA-256 hash, not the raw
credential. If the link is lost, replace it in the team desk. Replacing a link
retains the person's stable identity and project grants, and invalidates the
previous credential and file sessions.

## Roles

| Access | Available work |
| --- | --- |
| Viewer for a project | Inspect that project's retained inputs, studies, comparisons, reports and task state; use reviewed preview/read routes; download existing authorized files. |
| Analyst for a project | Viewer capabilities plus upload/import project sources, save selections and notes, create and run original tasks, cancel eligible tasks, resume authorized work and create project exports. |
| Installation administrator | All projects, team changes, shared source directories/manifests, global acquisition controls and project receiving/registration. |
| Local installation owner | Process-local administrative recovery access from the current startup URL. |

Administrator access applies to the installation. Viewer/analyst grants use the
operator's exact workspace keys, so a newly restored copy receives a distinct
access assignment even when it retains the same scientific project identity.
The team desk shows the available original and received workspaces.

An administrator may import shared sources into the intended project. Analysts
then use the retained project collection. Administrative source roots and
registered manifests are hidden from project-only catalogues. Project uploads
retain their original immutable blob IDs; a separate private grant associates
an uploaded object or preview with the project into which it was received.
Possession of an upload ID, preview ID, task ID or file ticket does not grant
access to another project.

## Use and manage access

Open a private link to connect. The browser removes its token from the address
and keeps it in that tab's session storage, as the original operator did.
The workbench shows the person's name and current project role. Project choices
contain only the current person's assignments. The connection form accepts a
complete private link when a tab has signed out or an older credential expires.

**Edit access** changes a person's project grants. Existing file sessions end;
the same access link reconnects with the updated permissions. **Disable** rejects
that person's credential. **Reactivate with new link** restores access using a
new credential. The desk prevents replacing or disabling the administrator's
own current credential; use another administrator or the local startup link.

Sign out removes the tab's connection and revokes its file session. Every file
request resolves the current person, credential revision and project grant.
File cookies use an installation-specific name and expire after eight hours.
They are HttpOnly and SameSite Strict; the server accepts them only for file
reads. API mutations continue to require the bearer credential and original
Host/Origin checks. Reopening the operator drops all in-memory file sessions;
the current named link starts a fresh one.

The team desk shows the most recent 200 activity entries. The installation
retains the full append-only activity journal. Credentials and complete
scientific payloads are omitted from that journal.

## Task identity, supervision and attribution

A new task retains its admitting person's ID and display name in requested_by.
The original request selection, request_sha256, workspace/operation_id identity,
coalescing rules and completed-result reuse remain unchanged. A repeated request
returns its original task and attribution.

Every queued task rechecks the recorded person's current active project access
before starting. Work that already entered its original native operation keeps
that admitted operation. Revocation blocks subsequent API access and new work;
it does not replay, cancel or relabel a running scientific calculation.

An explicit resume records execution_requested_by and a timestamped resumption,
preserving requested_by. The same task and scientific selection continue.
The original detached worker request already retains task_id and operation_id;
those fields join back to the attributed task. Its hashed request/execution
identity is unchanged. Existing tasks without a named actor retain the original
local-operator interpretation.

This source composes the maintained native supervision and TaskRequests
catalogue. It preserves observation-support controls, saved programme
supervision, native console routing and the existing source-refresh handler.
Source-refresh plans require analyst access even though they use a legacy
handler override. Pure difference previews remain available to viewers.

## Extension integration

team_route_policy.json records the reviewed route classification for the 57
active installed manifests: 228 method-specific routes, 11 file routes and
168 task actions. It includes 85 permitted viewer POST reads,
explicit mutating POST paths, and shared-source administrative paths.
Unknown POST paths default to analyst access. HTTP method alone does not
determine permission: for example GET of a saved paired view is a read, while
POST to save that view requires analyst access.

Every registered route still selects an authorized project. Extensions obtain
the request-local principal in their explicit binding context when requested.
The context is isolated per handler/task; no global current person is stored on
the shared Operator. Workspace reads, task lookup, upload materialization and
verified ticket transport also enforce project access.

Shared filesystem boundaries have provider-specific handling:

- Source preparation and annual-reference catalogues filter uploads and shared
  roots before returning them.
- Watershed context retains workspace source/network choices and omits global
  candidates before filesystem scanning for project-only users.
- Regional-soil capture/continue operates on an installation-wide retained
  acquisition pointer and therefore requires administrator access. Project-only
  preparation/composition keeps its ordinary analyst workflow.
- Parcel global receiving/preparation and shared-directory/capture selection
  require administrator access; retained project editions and rows remain
  readable in their project.
- Published-study and parcel catalogues hide global root labels. Nested source
  selectors, including evidence selections, receive the same administrative
  check as top-level selectors.
- Global extension diagnostics are restricted to administrators; project
  catalogues do not expose another project's raw error messages.

Installed providers remain trusted application code. New source-root readers,
direct writers or handler subclasses should integrate with the same explicit
scope and add their actual read/write contract to the maintained policy.

## Project delivery and installation recovery

Scientific exports contain the authorized project's existing source, results,
application and requested task history. The private installation files
team-access.json, team-resources.json and team-activity.json stay in the
separate operator-state directory. Named people/grants are installation
configuration, not scientific project content.

For a complete installation transfer, finish/drain the operator and use the
existing filesystem backup procedure to retain its workspace directories,
operator state and installed source as separate private components. Preserve
workspace paths if retaining their workspace keys. On the receiving installation,
with the operator stopped, run:

~~~sh
python -B operator/team_recover.py \
  --operator-state /absolute/installations/scientific-operator
~~~

The recovery command acquires the original operator lock, preserves staff IDs,
grants and activity, replaces the installation identity and invalidates every
old named credential. Start the original server and use its new local startup
link to issue fresh named links. A normal same-installation restart preserves
named credentials and requires no recovery command.

## Focused native receiving

Run against the complete current scientific application and its installed
dependencies:

~~~sh
python -B operator/team_receiving.py \
  --directory /absolute/receiving/team-access-20261013
~~~

The directory must be new and separate from application/project source. The
receiving exercise starts the real HTTP operator with two empty original
Workspaces, checks named access, current task identities, upload/file scoping,
cookie/credential lifecycle and the actual portable archive, and retains its
JSON result. It starts no scientific model. This complements the original native
supervision receiver; it does not replace or rerun the saved scientific cohort.

For the browser receiving pass, use the retained operator with an administrator,
an analyst and a viewer in separate browser contexts. Add/edit/disable/reactivate
a person, inspect the filtered project selector, inspect an authorized result,
download its original file, sign out and reconnect. Run those workflows at a
desktop and a narrow viewport and retain actual screenshots with the receiver's
original output. The existing native supervision flow continues on its original
task/run identities.

## Source and licensing

This is an additive contribution under the application's existing permissive
license. It changes operator access, source scope and attribution; interpretation
of scientific findings continues to use the original source documentation and
qualified review. The source bundle includes exact preimage identities for shared
files so concurrent changes can be composed before publication.
