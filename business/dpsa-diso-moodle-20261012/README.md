# Complete DISO course for Moodle 4.5

This project turns the thirteen-module DPSA DISO curriculum into one editable Moodle course. It includes the complete learning material, native assessments, practical workbooks, worked answers, glossary, diagrams, and narrated module presentations. The delivery program imports the course with Moodle's own APIs, creates an ordinary course backup, restores that backup into a second course, and receives the learner workflow.

## Course content

| Component | Complete edition |
| --- | ---: |
| Modules | 13 |
| Learning units | 26 |
| Authored learning chapters | 78 |
| Application chapters | 26 |
| Personal practice workbooks | 26 |
| Scenario exhibits | 30 |
| Editable working tables | 55 |
| Practical decision prompts | 78 |
| Worked-answer and reflection pages | 26 |
| Native question-bank questions | 312 |
| Single-answer multiple choice | 155 |
| Multiple-answer multiple choice | 52 |
| True/false | 52 |
| Matching | 26 |
| Select missing words | 13 |
| Drag words into text | 12 |
| Drag labels onto diagrams | 2 |
| Glossary entries | 58 |
| Module presentations | 13 |
| Narrated presentation scenes | 52 |
| Primary source records | 33 |

Every unit contains twelve assessment questions, a practical deliverable, its review rubric, and reflection. Each module includes a source-linked public-sector example and explicitly fictional application material. The video scripts contain complete original narration, editable screen text, and source references. The image questions retain their editable layout and SVG as well as the PNG background Moodle imports.

The course uses a 75% pass mark, unlimited attempts, the highest result, and immediate computer-graded feedback. Completion requires all twenty-six unit assessments. A personal workbook submission opens the corresponding suggested answer and reflection page through Moodle's completion-based availability. The learner book and handbook contain each exercise, its concrete scenario exhibits, working tables and decision prompts. The separate instructor guide and completion-gated guidance contain the worked reasoning and calculations. Each practical unit also compiles to an editable Markdown working document, and the complete practice handbook brings all twenty-six together.

## Source layout

- curriculum/course.json: ordered course and module identities.
- curriculum/modules/: all thirteen editable module sources.
- curriculum/workbooks.json: thirty authored scenario exhibits, fifty-five working tables and complete worked guidance across all twenty-six practical units.
- curriculum/sources.json: original official source catalog and scope notes.
- curriculum/glossary.json: fifty-eight definitions with references.
- curriculum/media/scripts.json: thirteen complete four-scene presentations.
- curriculum/images/diagrams.json and the SVG backgrounds: editable diagrams and native question coordinates.
- curriculum/render_diagrams.py: deterministic PNG/SVG rendering.
- curriculum/EDITING.md: detailed authoring and maintenance guide.
- tools/build_media.py: grayscale 960×540 MP4, VTT/SRT captions, transcript, poster, editable frames, and MP3 narration.
- tools/compile_course.py: whole-course compiler, Moodle XML, books, handbooks, source identity and file manifest.
- tools/import_course.php: original Moodle import, completion configuration and native MBZ backup.
- tools/receive_course.php: original enrolment, question, grade, completion and backup/restore receiving.
- tools/receive_browser.mjs: ordinary learner browser workflow.
- tools/native_moodle.py: the owned original Moodle installation and local services.
- tools/run_receiving.py: the complete retained operation and delivery archive.

The Moodle source is the original MOODLE_405_STABLE commit 215f44380bdc3ccf852a3a22e34f8423ff64033a. It is obtained from its original repository and installed by admin/cli/install_database.php. A worker may supply the exact retained archive and its observed SHA256, or select its existing owned Moodle4.5 installation.

## Run the complete delivery

Copy RECEIVING.example.json to the worker's private operation directory and replace its path values with the actual existing PHP, MariaDB, Node, Playwright, Chromium, speech and FFmpeg runtime paths. Keep the operation directory separate from this source checkout.

Run:

    python3 -B tools/run_receiving.py /absolute/private/receiving.json

The whole operation performs these phases:

1. Render both editable assessment diagrams.
2. Render all thirteen narrated, captioned module presentations.
3. Compile all twenty-six books, assessments, practical activities and guidance pages, plus the learner, instructor and practical workbooks.
4. Start the owned MariaDB database and original Moodle4.5 installation, or use the configured original local installation.
5. Import all course resources through original Moodle APIs and create the complete native course backup.
6. Restore that backup into a second original Moodle course, retaining the restore target and controller identities.
7. Exercise every question with the original question engine in both courses, receive fifty-two passing assessments, and receive original course completion.
8. Use the ordinary learner browser to save a workbook, open its guidance, play the captioned presentation, complete an unsuccessful assessment and a successful retry, use all seven question formats, reopen the received course, and receive desktop/mobile views and logout.
9. Package the editable source, generated learning material, native MBZ, receiving results, and screenshots into the complete course ZIP.

The ordinary browser runner waits for Moodle's asynchronous start/submit confirmation or the actual destination page, and receives the complete PHP output after its streams close. It keeps the same learner attempt through those transitions.

The program keeps its original course, question-bank, learner, attempt, restore and backup identities. Reopening a completed import preserves later course edits. Each completed module presentation is saved with its exact script, renderer, voice, binary and output identities, so an interrupted thirteen-module render continues from its completed presentations. A completed compiled course is also reused when its exact files remain present.

Media PCM, FFmpeg temporary files and browser profiles use the operation's own temporary directory. Their storage stays within the selected operation footprint even when the host's shared temporary volume is full. The original Moodle archive is marked complete only after every member is received. An interrupted extraction reuses exact complete files and finishes exact partial prefixes; different existing source remains available for an explicit source correction. Partial native phases retain their actual course state and logs for continuation in the same operation.

The speech mode for the complete receiving configuration is require. Use an installed local speech voice; the builder supports espeak-ng, espeak, or macOS say. The generated MP4 and MP3 timing comes from the actual PCM audio. Captions and transcripts contain the complete authored narration. The captioned mode can also generate a complete video edition when an editor explicitly chooses it.

For a complete media/content build on a machine without Moodle, run:

    python3 -B tools/run_receiving.py /absolute/private/receiving.json --build-only

A BUILT artifact contains the complete editable course and rendered material. Completing the same operation with Moodle adds the native MBZ and actual learner receiving to that delivery.

## Runtime setup

Use the worker's existing PHP8.1–8.3 runtime and a Moodle4.5-supported MariaDB. The receiving example sets max_input_vars to5000 and uses a private PHP configuration. PHP needs its original ctype, curl, DOM, fileinfo, GD, iconv, intl, JSON, mbstring, mysqli, OpenSSL, SimpleXML, sodium, tokenizer, XML, XMLReader, ZIP and zlib modules. Python needs Pillow; media encoding uses installed FFmpeg with H.264/AAC and MP3 support.

A portable existing native prefix can provide bin/php8.3, bin/mariadb, sbin/mariadbd and bin/mariadb-install-db. Its original dependency libraries belong in the child environment's LD_LIBRARY_PATH, and PHP_INI_SCAN_DIR can be empty when the worker selects its own php.ini. The receiving program uses those configured tools and installs no global packages.

The fresh local installation uses only the operation's source, database, Moodle data, private configuration and local account files. Its services bind to127.0.0.1. Native mail is disabled in that development installation. The delivered MBZ is made before receiving learners are created and uses Moodle's users=false backup setting.

## Delivery

The completed operation writes:

- delivery/DPSA_DISO_Complete_Editable_Course_20261012.zip
- delivery/DELIVERY.json
- native/DPSA_DISO_Complete.mbz
- compiled/Complete_DISO_Course.html
- compiled/Instructor_Guidance.html
- compiled/Complete_DISO_Practice_Workbook.html and compiled/workbooks/ with all twenty-six editable Markdown working documents
- compiled/package.json and SOURCE_MANIFEST.json
- browser/ with the actual learner receiving and screenshots

The ZIP contains editable source, learner and instructor material, all presentation assets, native question-bank XML, the complete original Moodle backup, and actual receiving output. Private site credentials, database passwords, local account files, and service logs remain in the owned operation directory.

To hand the course to another original Moodle4.5 installation, restore the delivered MBZ with Moodle's ordinary course restore, select the destination category, review the institution's branding and permissions, and publish that course. The native import can also create the complete course directly from compiled/package.json with the target administrator's selected PHP/Moodle paths.

## Tender and editorial basis

Original RFP: https://www.dpsa.gov.za/dpsa2g/documents/tenders/DPSA003_2026.pdf

The course follows the RFP's thirteen-module curriculum, native learning/assessment formats, application/reflection model, glossary and editable Moodle-compatible delivery. A full editable tool chain is included because the RFP permits a fully compatible editable alternative to the institution's preferred Articulate360 tooling.

Institutional logos, naming conventions, supplied source updates and review comments are applied through the existing editable sources and the destination Moodle theme. Legal requirements, public-sector directives and general security guidance remain distinguished in the source catalog. Use the primary-source references when maintaining the course or applying a departmental policy.
