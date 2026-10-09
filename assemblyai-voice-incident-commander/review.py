"""Offline transcript review page built only from a replay-verified packet."""
from __future__ import annotations

from collections import Counter
from html import escape
import json
from typing import Any

from incident_core import IncidentError, verify_packet

KINDS = {
    "observation": "Observation",
    "hypothesis": "Hypothesis",
    "diagnostic_proposal": "Diagnostic proposal",
    "action_proposal": "Action proposal",
    "decision_record": "Spoken decision record",
    "note": "Note",
}

STYLE = """
:root{font-family:system-ui,sans-serif;color:#152a38;background:#eef2f5;line-height:1.5;color-scheme:light}
body{margin:0}main{max-width:1050px;margin:auto;padding:2rem 1rem}h1{font-size:clamp(1.8rem,5vw,3rem);margin:.3rem 0}
h2{font-size:1.15rem}a{color:#164b75}.eyebrow{font-weight:750;letter-spacing:.09em;color:#375e75}
.notice{border-left:5px solid #9b6500;background:#fff5df;padding:1rem}.digest{overflow-wrap:anywhere;font-size:.85rem}
.counts{display:flex;gap:.65rem;flex-wrap:wrap;padding:0;list-style:none}.counts li{background:white;border:1px solid #c8d5df;border-radius:7px;padding:.55rem .8rem}
.controls{display:flex;gap:1rem;flex-wrap:wrap;background:#dfe9ef;padding:1rem;border-radius:8px}
label{display:grid;gap:.25rem;font-weight:650}input,select,button{font:inherit;padding:.5rem;border:1px solid #7790a2;border-radius:5px;background:white;color:inherit}
button{align-self:end;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}.exports{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1rem}.event:focus{outline:3px solid #164b75;outline-offset:3px}input{min-width:200px}.events{list-style:none;padding:0;display:grid;gap:1rem}
.event{background:white;border:1px solid #c8d5df;border-left:5px solid #487990;border-radius:8px;padding:1.2rem}
.event[data-kind="action_proposal"],.event[data-kind="diagnostic_proposal"]{border-left-color:#a76816}
.event[hidden]{display:none}.event h2{margin:0;display:flex;gap:.75rem;flex-wrap:wrap}.event p{white-space:pre-wrap;overflow-wrap:anywhere}
.meta{color:#36586e;font-size:.9rem}.kind{font-size:.85rem;background:#edf2f5;padding:.15rem .5rem;border-radius:5px}
details{border-top:1px solid #d6dfe5;padding-top:.75rem}summary{cursor:pointer}code{overflow-wrap:anywhere}dt{font-weight:650}dd{margin:.25rem 0 1rem;overflow-wrap:anywhere}
@media print{:root{font-size:14px;background:white}body{background:white}main{max-width:none;padding:0}.controls,.exports,#export-status{display:none}.event{break-inside:avoid}}
"""

SCRIPT = r"""
const speaker = document.getElementById('speaker');
const kind = document.getElementById('kind');
const search = document.getElementById('search');
const rows = [...document.querySelectorAll('.event')];
const status = document.getElementById('filter-status');
const exportStatus = document.getElementById('export-status');
const markdownButton = document.getElementById('export-markdown');
// Preserve Python's serialized numbers and the complete receipt-bearing packet.
// This inert JSON is escaped at generation time, not interpolated into JS source.
const packetJson = document.getElementById('packet-data').textContent;
const packet = JSON.parse(packetJson);
const turns = new Map(packet.turns.map(turn => [turn.turn_order, turn]));
const events = new Map(Object.entries(packet.incident)
  .filter(([key]) => key !== 'event_count')
  .flatMap(([, group]) => group.map(event => [event.turn_order, event])));

function applyFilters() {
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const row of rows) {
    const matches = (!speaker.value || row.dataset.speaker === speaker.value)
      && (!kind.value || row.dataset.kind === kind.value)
      && (!query || row.querySelector('.transcript').textContent.toLocaleLowerCase().includes(query));
    row.hidden = !matches;
    if (matches) visible += 1;
  }
  status.textContent = 'Showing ' + visible + ' of ' + rows.length + ' recorded turns.';
  document.getElementById('no-results').hidden = visible !== 0;
  markdownButton.disabled = visible === 0;
}
function resetFilters() {
  speaker.value = ''; kind.value = ''; search.value = ''; applyFilters();
}

// Fences outlast every backtick run, so transcript text cannot become Markdown
// links, HTML, or headings when the handoff is opened in a Markdown renderer.
function quoteEvidence(value) {
  const text = String(value);
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((length, run) => Math.max(length, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return fence + 'text\n' + text + '\n' + fence;
}
function filteredMarkdown() {
  const selected = rows.filter(row => !row.hidden);
  const filters = {
    speaker: speaker.value ? speaker.selectedOptions[0].textContent : 'All speakers',
    event_type: kind.value || 'All types',
    transcript_contains: search.value.trim(),
  };
  const sections = [
    '# Voice Incident Commander — filtered handoff',
    'Source packet receipt SHA-256: ' + packet.receipt_sha256,
    'Selected turns: ' + selected.length + ' of ' + rows.length + '.',
    'This is a derived view, not a replay-verifiable packet. Retain the full JSON packet for replay. '
      + 'The source receipt identifies that packet; it is not a hash of this Markdown file.',
    'Human review only. Action proposals and spoken decisions do not approve or execute commands, '
      + 'rollbacks, deployments, or pages. Replay verifies internal consistency, not source '
      + 'authenticity or statement accuracy. Live provider execution remains unverified.',
    '## Applied filters',
    quoteEvidence(JSON.stringify(filters, null, 2)),
  ];
  for (const row of selected) {
    const order = Number(row.id.slice('turn-'.length));
    const event = events.get(order);
    const turn = turns.get(order);
    sections.push(
      '## Turn ' + order + ' — ' + event.kind,
      'Speaker:',
      quoteEvidence(turn.speaker_label === null ? 'Unlabeled speaker' : turn.speaker_label),
      'Original transcript:',
      quoteEvidence(turn.transcript),
      'Provider end-of-turn confidence: ' + turn.end_of_turn_confidence
        + '. This is not confidence that the statement is true.',
      'Transcript SHA-256: ' + turn.transcript_sha256,
      'Event SHA-256: ' + event.event_sha256,
    );
  }
  return sections.join('\n\n') + '\n';
}
function downloadText(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to start reading the Blob before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
document.getElementById('download-packet').addEventListener('click', () => {
  downloadText(packetJson + '\n', 'application/json;charset=utf-8',
    'voice-incident-' + packet.receipt_sha256.slice(0, 12) + '.json');
  exportStatus.textContent = 'Full JSON packet download requested. It contains ALL recorded turns; filters are not redaction.';
});
markdownButton.addEventListener('click', () => {
  if (!rows.some(row => !row.hidden)) return;
  downloadText(filteredMarkdown(), 'text/markdown;charset=utf-8',
    'voice-incident-handoff-' + packet.receipt_sha256.slice(0, 12) + '.md');
  exportStatus.textContent = 'Filtered Markdown download requested. Only the currently visible turns were included; retain the full JSON for replay.';
});

function revealLinkedTurn() {
  if (!/^#turn-(0|[1-9][0-9]*)$/.test(window.location.hash)) return;
  const target = document.getElementById(window.location.hash.slice(1));
  if (!target) return;
  if (target.hidden) resetFilters();
  target.focus({preventScroll: true});
  target.scrollIntoView({block: 'start'});
}
speaker.addEventListener('change', applyFilters);
kind.addEventListener('change', applyFilters);
search.addEventListener('input', applyFilters);
document.getElementById('reset').addEventListener('click', resetFilters);
window.addEventListener('hashchange', revealLinkedTurn);
applyFilters();
revealLinkedTurn();
"""


def render_review(packet: dict[str, Any]) -> str:
    if not verify_packet(packet):
        raise IncidentError("packet must verify before rendering a review")
    # A script element uses raw-text parsing even for application/json. Escape
    # delimiters so a literal transcript closing tag cannot end the data block.
    packet_json = json.dumps(
        packet, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    )
    for char, escaped in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"),
                          ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        packet_json = packet_json.replace(char, escaped)
    events = sorted(
        (event for key, group in packet["incident"].items() if key != "event_count" for event in group),
        key=lambda event: event["turn_order"],
    )
    turns = {turn["turn_order"]: turn for turn in packet["turns"]}
    speakers = list(dict.fromkeys(event["speaker_label"] for event in events))
    counts = Counter(event["kind"] for event in events)
    speaker_options = "".join(
        f'<option value="{index}">{escape(speaker if speaker is not None else "Unlabeled speaker")}</option>'
        for index, speaker in enumerate(speakers)
    )
    kind_options = "".join(f'<option value="{kind}">{label}</option>' for kind, label in KINDS.items())
    totals = "".join(f'<li><strong>{counts[kind]}</strong> {label}</li>' for kind, label in KINDS.items())
    cards = []
    for event in events:
        order = event["turn_order"]
        speaker = event["speaker_label"]
        transcript = turns[order]["transcript"]
        cards.append(
            f'<li class="event" id="turn-{order}" tabindex="-1" data-kind="{event["kind"]}" data-speaker="{speakers.index(speaker)}">'
            f'<article><h2><a href="#turn-{order}">Turn {order}</a> '
            f'{escape(speaker if speaker is not None else "Unlabeled speaker")} '
            f'<span class="kind">{KINDS[event["kind"]]}</span></h2>'
            f'<p>{escape(event["text"])}</p>'
            f'<p class="meta">Provider end-of-turn confidence: {event["end_of_turn_confidence"]}. This is not confidence that the statement is true.</p>'
            '<details><summary>Original transcript and evidence identifiers</summary>'
            f'<p class="transcript">{escape(transcript)}</p><dl>'
            f'<dt>Transcript SHA-256</dt><dd><code>{event["transcript_sha256"]}</code></dd>'
            f'<dt>Event SHA-256</dt><dd><code>{event["event_sha256"]}</code></dd>'
            '</dl></details></article></li>'
        )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>Voice Incident Commander — transcript review</title><style>{STYLE}</style></head><body><main>'
        '<p class="eyebrow">VOICE INCIDENT COMMANDER</p><h1>Transcript review</h1>'
        '<p>Inspect what was recorded, who said it, and which statements were proposals.</p>'
        '<p class="notice"><strong>Human review only.</strong> An action proposal or spoken decision does not execute a command, approve a rollback, or page anyone. Packet replay verifies internal consistency; it does not establish source authenticity or statement accuracy. Live provider execution remains unverified.</p>'
        f'<p class="digest">Source packet receipt: <code>{packet["receipt_sha256"]}</code></p>'
        '<p>This identifier belongs to the verified JSON packet, not this HTML review copy. Retain the JSON for replay.</p>'
        f'<ul class="counts" aria-label="Recorded event counts">{totals}</ul>'
        '<div class="controls" role="search" aria-label="Filter recorded turns">'
        f'<label>Speaker<select id="speaker"><option value="">All speakers</option>{speaker_options}</select></label>'
        f'<label>Event type<select id="kind"><option value="">All types</option>{kind_options}</select></label>'
        '<label>Transcript contains<input id="search" type="search" autocomplete="off"></label>'
        '<button id="reset" type="button">Reset filters</button></div>'
        f'<p id="filter-status" role="status">Showing {len(events)} of {len(events)} recorded turns.</p>'
        '<p id="no-results" hidden>No recorded turns match these filters.</p>'
        '<div class="exports" role="group" aria-label="Local evidence downloads">'
        '<button id="download-packet" type="button">Download full JSON packet</button>'
        '<button id="export-markdown" type="button">Export filtered Markdown</button></div>'
        '<p id="export-status" role="status">Downloads are generated locally; no server request is sent.</p>'
        '<p><strong>Filters are not redaction.</strong> This HTML and its full JSON download contain all '
        'recorded turns. Share them only with people authorized to read the complete transcript. '
        'The filtered Markdown is a derived handoff, not a substitute for the replay-verifiable packet.</p>'
        f'<ol class="events">{"".join(cards)}</ol>'
        '<p>Filters change only this view. All recorded turns remain in the document; no request is sent and no packet is changed.</p>'
        f'</main><script type="application/json" id="packet-data">{packet_json}</script>'
        f'<script>{SCRIPT}</script></body></html>\n'
    )
