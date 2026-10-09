"""Focused offline checks for portable review evidence; no provider calls."""
from __future__ import annotations

import copy
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from incident_core import IncidentError, compile_packet, verify_packet
from review import SCRIPT, render_review


class ReviewData(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.scripts = []
        self.current = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.current = {"attrs": dict(attrs), "text": ""}
            self.scripts.append(self.current)

    def handle_data(self, data):
        if self.current is not None:
            self.current["text"] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.current = None


def fixture():
    return compile_packet([
        {"type": "Turn", "turn_order": 0, "end_of_turn": True,
         "transcript": "OBS: Synthetic checkout delay", "speaker_label": "A"},
        {"type": "Turn", "turn_order": 1, "end_of_turn": True,
         "transcript": "ACTION: Review rollback — not approved\n```\n</script><script>bad()</script> & café\u2028end",
         "speaker_label": "B <untrusted>"},
        {"type": "Turn", "turn_order": 2, "end_of_turn": True,
         "transcript": "HYP: Synthetic worker delay", "speaker_label": "A"},
    ])


# Run the actual generated page script under Node's standard-library VM with a
# narrow DOM double. This checks event wiring/download bytes, not browser layout.
NODE = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const packet = JSON.parse(input.packetJson);
const listeners = new Map();
const blobs = new Map();
const downloads = [];
const timers = [];
const revoked = [];
let focused = null;
let scrolled = null;
class Element {
  constructor(id) {
    this.id = id; this.value = ''; this.textContent = '';
    this.hidden = false; this.disabled = false; this.dataset = {};
  }
  addEventListener(name, fn) { listeners.set(this.id + ':' + name, fn); }
  focus() { focused = this.id; }
  scrollIntoView() { scrolled = this.id; }
  get selectedOptions() { return [{textContent: input.speakers[Number(this.value)]}]; }
}
const ids = ['speaker', 'kind', 'search', 'filter-status', 'export-status',
  'export-markdown', 'packet-data', 'no-results', 'download-packet', 'reset'];
const elements = new Map(ids.map(id => [id, new Element(id)]));
elements.get('packet-data').textContent = input.packetJson;
const events = Object.entries(packet.incident).filter(([key]) => key !== 'event_count')
  .flatMap(([, group]) => group);
const rows = packet.turns.map(turn => {
  const row = new Element('turn-' + turn.turn_order);
  const event = events.find(event => event.turn_order === turn.turn_order);
  row.dataset = {speaker: String(input.speakers.indexOf(turn.speaker_label)), kind: event.kind};
  row.querySelector = selector => {
    assert.equal(selector, '.transcript');
    return {textContent: turn.transcript};
  };
  elements.set(row.id, row);
  return row;
});
const window = {location: {hash: input.hash || ''},
  addEventListener: (name, fn) => listeners.set('window:' + name, fn)};
const document = {
  getElementById: id => elements.get(id) || null,
  querySelectorAll: selector => { assert.equal(selector, '.event'); return rows; },
  createElement: tag => {
    assert.equal(tag, 'a');
    return {click() { downloads.push({blob: blobs.get(this.href), filename: this.download}); },
      remove() { this.removed = true; }};
  },
  body: {appendChild() {}},
};
const context = vm.createContext({document, window, Blob,
  URL: {
    createObjectURL: blob => { const url = 'blob:offline-' + blobs.size; blobs.set(url, blob); return url; },
    revokeObjectURL: url => revoked.push(url),
  },
  setTimeout: (fn, delay) => { assert.equal(delay, 1000); timers.push(fn); },
});
vm.runInContext(input.script, context);
const get = id => elements.get(id);
const fire = (id, event) => listeners.get(id + ':' + event)();
(async () => {
  if (input.scenario === 'downloads') {
    get('speaker').value = '1'; fire('speaker', 'change');
    get('kind').value = 'action_proposal'; fire('kind', 'change');
    get('search').value = ' rollback '; fire('search', 'input');
    assert.deepEqual(rows.map(row => row.hidden), [true, false, true]);
    assert.equal(get('export-markdown').disabled, false);
    fire('export-markdown', 'click');
    const markdown = await downloads[0].blob.text();
    assert.match(markdown, /Selected turns: 1 of 3\./);
    assert.match(markdown, /## Turn 1 — action_proposal/);
    assert.ok(!markdown.includes('## Turn 0'));
    assert.ok(!markdown.includes('## Turn 2'));
    assert.ok(!markdown.includes(packet.turns[0].transcript));
    assert.ok(markdown.includes('````text\n' + packet.turns[1].transcript + '\n````'));
    assert.ok(markdown.includes(packet.receipt_sha256));
    assert.ok(markdown.includes(packet.turns[1].transcript_sha256));
    assert.ok(markdown.includes(events.find(event => event.turn_order === 1).event_sha256));
    assert.match(markdown, /not a replay-verifiable packet/);
    assert.match(markdown, /do not approve or execute/);
    assert.match(downloads[0].filename, /^voice-incident-handoff-[a-f0-9]{12}\.md$/);
    fire('download-packet', 'click');
    const full = await downloads[1].blob.text();
    assert.equal(full, input.packetJson + '\n');
    assert.deepEqual(JSON.parse(full), packet);
    assert.match(get('export-status').textContent, /ALL recorded turns/);
    get('search').value = 'no match exists'; fire('search', 'input');
    assert.equal(get('export-markdown').disabled, true);
    fire('export-markdown', 'click');
    assert.equal(downloads.length, 2);
    fire('download-packet', 'click');
    assert.equal(downloads.length, 3);
    assert.equal(get('packet-data').textContent, input.packetJson);
    timers.forEach(fn => fn());
    assert.equal(revoked.length, 3);
    process.stdout.write(JSON.stringify({full, markdown}));
  } else if (input.scenario === 'links') {
    assert.equal(focused, 'turn-2'); // initial deep link
    get('speaker').value = '1'; fire('speaker', 'change');
    window.location.hash = '#turn-1'; fire('window', 'hashchange');
    assert.equal(get('speaker').value, '1'); // visible target preserves filters
    window.location.hash = '#turn-0'; fire('window', 'hashchange');
    assert.equal(get('speaker').value, '');
    assert.equal(focused, 'turn-0'); assert.equal(scrolled, 'turn-0');
    assert.ok(rows.every(row => !row.hidden));
    get('kind').value = 'hypothesis'; fire('kind', 'change');
    for (const hash of ['#turn-999', '#turn-01', '#turn-0[bad]', '#other']) {
      window.location.hash = hash; fire('window', 'hashchange');
      assert.equal(get('kind').value, 'hypothesis'); assert.equal(focused, 'turn-0');
    }
    process.stdout.write('{}');
  } else if (input.scenario === 'empty') {
    assert.equal(get('export-markdown').disabled, true);
    assert.equal(get('no-results').hidden, false);
    fire('download-packet', 'click');
    assert.deepEqual(JSON.parse(await downloads[0].blob.text()), packet);
    process.stdout.write('{}');
  } else { throw Error('unknown scenario'); }
})().catch(error => { console.error(error); process.exitCode = 1; });
"""


class ReviewExportTests(unittest.TestCase):
    def test_embedded_packet_is_replayable_and_cannot_close_script(self):
        packet = fixture()
        parsed = ReviewData(render_review(packet))
        self.assertEqual(len(parsed.scripts), 2)
        data, executable = parsed.scripts
        self.assertEqual(data["attrs"], {"type": "application/json", "id": "packet-data"})
        self.assertNotIn("<", data["text"])
        self.assertNotIn("\u2028", data["text"])
        decoded = json.loads(data["text"])
        self.assertEqual(decoded, packet)
        self.assertTrue(verify_packet(decoded))
        self.assertEqual(executable["text"], SCRIPT)

    def test_tampered_packet_is_rejected_before_exports(self):
        packet = fixture()
        packet["turns"][0]["transcript"] = "tampered"
        with self.assertRaises(IncidentError):
            render_review(packet)

    def run_node(self, packet, scenario, hash_=""):
        parsed = ReviewData(render_review(packet))
        result = subprocess.run(
            ["node", "-e", NODE],
            input=json.dumps({"script": SCRIPT, "packetJson": parsed.scripts[0]["text"],
                              "speakers": list(dict.fromkeys(t["speaker_label"] for t in packet["turns"])),
                              "scenario": scenario, "hash": hash_}),
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    @unittest.skipUnless(shutil.which("node"), "Node is required for page-script behavior")
    def test_filtered_markdown_and_full_json_downloads(self):
        packet = fixture()
        original = copy.deepcopy(packet)
        result = self.run_node(packet, "downloads")
        self.assertTrue(verify_packet(json.loads(result["full"])))
        self.assertEqual(packet, original)

    @unittest.skipUnless(shutil.which("node"), "Node is required for page-script behavior")
    def test_initial_and_filtered_deep_links(self):
        self.run_node(fixture(), "links", "#turn-2")

    @unittest.skipUnless(shutil.which("node"), "Node is required for page-script behavior")
    def test_empty_packet_keeps_full_download_available(self):
        self.run_node(compile_packet([]), "empty")


if __name__ == "__main__":
    unittest.main()
