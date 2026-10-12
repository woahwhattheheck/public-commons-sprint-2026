from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
SOURCE_SHA = '31ad185f5770c3c4a3d341df260ef8c7bf0027fec6b04b115fdfb59fe2ed4c32'
assert hashlib.sha256((ROOT / '1442341-event.pdf').read_bytes()).hexdigest() == SOURCE_SHA

groups = []
questions = []
page = 0
group = None
question = None

def finish_question():
    global question
    if question is not None:
        question['text'] = '\n'.join(question.pop('lines')).strip()
        questions.append(question)
        question = None

for original_line in (ROOT / '1442341-event.txt').read_text().splitlines():
    line = original_line.rstrip()
    page_match = re.fullmatch(r'PAGE (\d+)', line)
    if page_match:
        page = int(page_match.group(1))
        if page >= 10:
            finish_question()
        continue
    if not 5 <= page <= 9:
        continue
    if not line.strip() or re.fullmatch(r'(28 September 2026)+', line.strip()):
        continue
    match = re.match(r'^Group (\d+\.\d+):\s*(.*)$', line)
    if match:
        finish_question()
        group = {'id': match.group(1), 'title': match.group(2),
                 'source_page': page, 'instructions_lines': []}
        groups.append(group)
        continue
    match = re.match(r'^(\d+\.\d+\.\d+)\s*(.*)$', line)
    if match:
        finish_question()
        question = {'id': match.group(1), 'group_id': group['id'],
                    'source_pages': [page], 'lines': [match.group(2)]}
        continue
    if question is not None:
        if page not in question['source_pages']:
            question['source_pages'].append(page)
        question['lines'].append(line)
    elif group is not None and not line.startswith('Instructions:'):
        group['instructions_lines'].append(line)
finish_question()
for item in groups:
    item['instructions'] = '\n'.join(item.pop('instructions_lines')).strip()
    item['question_ids'] = [q['id'] for q in questions if q['group_id'] == item['id']]

expected = {'1.1': 7, '2.1': 8, '3.1': 3, '3.2': 6, '3.3': 48,
            '3.4': 15, '4.1': 7, '4.2': 4, '4.3': 5, '5.1': 3, '6.1': 3}
actual = {g['id']: len(g['question_ids']) for g in groups}
assert actual == expected, actual
assert len({q['id'] for q in questions}) == len(questions) == 109
assert all(q['text'] and q['id'].rsplit('.', 1)[0] == q['group_id'] for q in questions)

catalog = {
    'schema': 'umich.internal-audit-rfp.event-catalog/v1',
    'source': {'filename': '1442341-event.pdf', 'sha256': SOURCE_SHA, 'pages': 11,
               'event_id': '1442341', 'rfp': 'RFP-0012413-TECH-2026',
               'original_thread': 'C0BTTA66TK3/1791758494.393019',
               'public_listing': 'https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UMich'},
    'normalization': 'Question IDs, wording, source page spans and group identities are preserved from the original PDF text extraction; repeated date footers and page markers are excluded from question text. Group4.2 and4.3 remain distinct despite their identical titles. An empty original Group5.1 title is retained.',
    'event': {'title': 'Internal Audit Software', 'currency': 'USD',
              'released_as_printed': '9/28/2026, 6:00 PM EDT',
              'open_as_printed': '9/28/2026, 6:30 PM EDT',
              'close_as_printed': '11/2/2026, 12:00 PM EST',
              'close_iso': '2026-11-02T12:00:00-05:00',
              'payment_terms_as_printed': '0% 0, Net 45', 'source_page': 1},
    'contacts': [
        {'name_as_printed': 'MAKENZIE COULING', 'email': 'mcouling@umich.edu', 'phone': '+1 734-764-1817', 'source_page': 1},
        {'name_as_printed': 'ANUSHALIE DIAS WEERASINHA', 'email': 'aydw@umich.edu', 'phone': '+1 734-647-0503', 'source_page': 1}
    ],
    'conference': {'date_as_printed': 'October 5, 2026, 10:30 a.m.- 11:30 a.m. EST',
                   'mandatory': False, 'source_page': 3},
    'question_submission': {'route': 'Question and Answer Board',
                            'requires_intent_to_bid': True, 'deadline': None,
                            'deadline_source_to_retrieve': 'Buyer Attachments: planned procurement schedule',
                            'source_page': 3},
    'prerequisites': [{'number': i+1, 'label': label, 'action_as_printed': 'Read & Certify', 'source_page': 4}
                      for i, label in enumerate([
                          'SCOPE OF OPPORTUNITY', 'REQUIREMENTS AND SPECIFICATIONS',
                          'PLANNED PROCUREMENT SCHEDULE', 'EVALUATION CRITERIA',
                          'SUPPLIER CODE OF CONDUCT', 'SUBMISSION DIRECTIONS',
                          'RIGHTS RESERVED BY THE UNIVERSITY AND RESTRICTIONS ON SOURCING EVENTS',
                          'ELECTRONIC SIGNATURE'])],
    'groups': groups, 'questions': questions,
    'line_items': [
        {'id': 'P1', 'label': 'Total Pricing', 'quantity': 1, 'uom_as_printed': 'LS - Lump Sum',
         'instruction': 'Enter total proposal cost and complete Attachment F pricing spreadsheet in Buyer Attachments.', 'source_page': 10},
        {'id': 'S1', 'label': '[Placeholder Service Item]', 'quantity': 1, 'uom_as_printed': 'EA - Each',
         'instruction': 'Update the placeholder to the actual services applicable to the response.', 'source_page': 11}
    ],
    'issued_attachments_to_join': [
        {'role': 'Detailed project scope, functional and technical requirements', 'source_page': 3},
        {'role': 'Planned procurement schedule and Q&A deadline', 'source_page': 3},
        {'role': 'Evaluation criteria and submission directions', 'source_page': 4},
        {'role': 'Agreement', 'question_ids': ['3.2.1', '3.2.4', '3.2.5']},
        {'role': 'Business Associate Agreement', 'question_ids': ['3.2.2']},
        {'role': 'Data Security Agreement', 'question_ids': ['3.2.3']},
        {'role': 'Attachment F Excel pricing workbook', 'question_ids': ['4.1.6', '4.1.7'], 'source_page': 10},
        {'role': 'Current Q&A, conference clarifications and amendments', 'source_page': 3}
    ]
}
out = ROOT / 'event-catalog.json'
out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'path': str(out), 'bytes': out.stat().st_size,
                  'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
                  'groups': len(groups), 'questions': len(questions), 'counts': actual}))
