# Editing the DISO course

The authoritative teaching source is the JSON in this directory. Each module contains two complete units with original chapters, a public-service case, an application exercise, a suggested answer, a reflection and a twelve-question assessment. The course contains 13 modules, 26 units and 312 questions.

## Course structure

| File | Purpose |
| --- | --- |
| course.json | Ordered module catalog and references to the shared source, glossary, media and diagram files |
| modules/M01.json through modules/M13.json | Complete editable teaching and assessment source |
| sources.json | Official source titles, URLs, editions, relevant provisions and the use made of each source |
| glossary.json | 58 original definitions linked to sources and modules |
| media/scripts.json | 13 editable videos, each with four complete narration scenes and on-screen text |
| images/diagrams.json | Exact panel layout and coordinates for the two native image-drag questions |
| images/*.svg | Editable vector backgrounds for the image questions |
| render_diagrams.py | Reproducible PNG and SVG rendering from the retained diagram layout |

The controlling procurement source is [DPSA003/2026](https://www.dpsa.gov.za/dpsa2g/documents/tenders/DPSA003_2026.pdf). Its Terms of Reference cover adult learning and assessment on physical pages 18–20, the thirteen-module map and final product on pages 21–24, and the full-course demonstration and glossary on page 27. The course source follows that map.

## Edit a unit

Keep each module, unit, chapter and question ID stable when revising the same teaching item. Edit the chapter bodyHtml and its sourceIds together. A factual statement should point to the source that supports it. Original classroom scenarios should remain recognisable as teaching exercises.

The application contains instructionsHtml, a deliverable, suggestedAnswerHtml and a ten-point rubric. The reflection contains the prompt and guidanceHtml. The native course places the worked answer and reflection guidance behind completion of the personal workbook, allowing learners to make their own attempt first.

Read the whole unit after an edit. Check that the objectives are taught, the exercise can be completed from the available information, and the suggested answer explains the reasoning. Keep the unit connected to the service responsibilities of a DISO rather than turning it into a technical configuration manual.

## Preserve source authority

The catalog distinguishes legislation, directives, policy frameworks, technical guidance and reported public-service outcomes. Retain that distinction when updating the text. For example:

- POPIA and PAIA statements should remain connected to the applicable provisions and authorised decision-maker.
- The 2022 Information Security Directive and MISS retain their own classification terminology.
- Records disposal depends on the applicable records authority.
- NIST and NCSC material provides technical background or documented examples; United States and United Kingdom requirements do not become South African mandates.
- A public-service case reports the particular outcome in the original source. Broader conclusions about security effectiveness require their own evidence.

The sources were reviewed on 12 October 2026. Before a later delivery, check current legislation, official reporting channels and source editions. Update the catalog and the affected teaching items together.

## Edit assessments

Every unit has twelve questions, a passPercent of 75 and attempts of 0, which represents unlimited attempts in the native import. Each question includes a prompt, general feedback and source references where needed. Multiple-choice answers also include answer-specific feedback.

The complete set contains 155 single-answer multiple-choice questions, 52 multiple-answer questions, 52 true/false questions, 26 matching questions, 13 select-gap questions, 12 text-drag questions and two image-drag questions.

For single-answer multiple choice, retain one answer with fraction 100 and the other answers with fraction 0. For the authored multiple-answer pattern, the two correct answers each have fraction 50 and the two incorrect answers each have fraction -50. Explain why each alternative succeeds or fails. A learner should need to interpret the scenario rather than recognise an obviously unrelated answer.

Matching questions retain their prompt–answer pairs. Gap and text-drag questions use [[1]], [[2]] and subsequent placeholders with the one-based correctChoices array and their original choice groups. Edit the prompt and correct choices as one change.

M01-U02-Q06 and M08-U02-Q12 are ddimageortext questions. Each retains a background file, editable sourceFile, dimensions and an accessible description. The drags have stable no values; each drop references its correct choice and exact xleft/ytop coordinates. The first two units collectively exercise all seven requested assessment formats.

## Render the editable diagrams

Run the renderer before the course compiler calculates its source manifest:

    python curriculum/render_diagrams.py --curriculum curriculum

The renderer requires Pillow. It uses the layout in images/diagrams.json to produce both native PNG backgrounds and editable SVGs. Keep the background dimensions, panel descriptions and question drop coordinates consistent. If a panel changes, inspect the rendered background and the native question together.

The M01 diagram assigns service, ICT, DISO and statutory information-officer responsibilities. The M08 diagram follows authentication, record/action authorisation, supplier scope and recovery dependencies through a service architecture. The full descriptions also appear in the question text and background alternative text.

## Edit narration and media

media/scripts.json contains complete original narration for all thirteen modules: 52 scenes and 3,553 spoken words. A video retains its moduleId and sourceIds. Each scene has a heading, a short onScreen list, narration and a planned durationSeconds.

Treat durationSeconds as an editing estimate. The media producer measures the actual narration and aligns captions and scene timing to that audio. Keep on-screen text brief enough for a small screen, retain a complete transcript and preserve the editable script with the resulting MP4/MP3 and captions. The visual treatment is simple, high contrast and suitable for low-bandwidth delivery.

When changing a narration claim, update its source reference and the corresponding module. The script should reinforce the module's decision process and public-service case. It should not introduce a new obligation that the teaching source does not explain.

## Native course delivery

The producer uses the pinned Moodle 4.5 source and its original question-import, course, grading, completion and backup mechanisms. The structured source supports editable native Books, personal workbooks, guidance Pages, quizzes, glossary, references and media resources.

Keep the generated course archive with the editable JSON, media scripts, diagram source and producing tools. After an editorial or importer change, use the retained native receiving process to inspect the affected course behaviour, including learner feedback, workbook guidance, grading and backup/restore. The final native result identifies the actual produced course and archive.
