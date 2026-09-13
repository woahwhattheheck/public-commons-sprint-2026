from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
VIS = ROOT / "visuals"
VIS.mkdir(exist_ok=True)

W, H = 1920, 1080


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def svg_frame(name, kicker, title, blocks, footer):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
             '<rect width="1920" height="1080" fill="#0b0d12"/>',
             '<rect x="96" y="90" width="10" height="90" fill="#e7edf7"/>',
             f'<text x="140" y="125" fill="#aeb8c7" font-family="monospace" font-size="34">{esc(kicker)}</text>',
             f'<text x="140" y="205" fill="#ffffff" font-family="sans-serif" font-size="68" font-weight="700">{esc(title)}</text>']
    y = 320
    for head, body in blocks:
        parts += [f'<rect x="140" y="{y}" width="1640" height="150" rx="24" fill="#151a23" stroke="#3a4558" stroke-width="2"/>',
                  f'<text x="185" y="{y+56}" fill="#ffffff" font-family="monospace" font-size="34" font-weight="700">{esc(head)}</text>',
                  f'<text x="185" y="{y+106}" fill="#c4cfdd" font-family="sans-serif" font-size="30">{esc(body)}</text>']
        y += 175
    parts += [f'<text x="140" y="1010" fill="#8995a8" font-family="monospace" font-size="26">{esc(footer)}</text>', '</svg>']
    (VIS / name).write_text("\n".join(parts), encoding="utf-8")


svg_frame("01-state-machine.svg", "RIP-302 / JOB LIFECYCLE", "A paid job is an explicit state machine", [
    ("OPEN → CLAIMED", "One worker wins the guarded claim transition."),
    ("CLAIMED → DELIVERED", "Only the assigned worker can submit the result."),
    ("DELIVERED → COMPLETED", "Poster acceptance is the payout boundary."),
], "Side states: disputed · expired · cancelled")

svg_frame("02-job-record.svg", "RIP-302 / PERSISTED RECORD", "The job remembers more than a chat transcript", [
    ("WHO", "poster_wallet · worker_wallet"),
    ("WHAT", "title · description · category · tags · deliverable URL/hash"),
    ("WHEN + MONEY", "timestamps · reward · escrow · platform fee · status"),
], "Source: rip302_agent_economy.py @ 8c79fba7561283ff8c880258152cd15e2610c312")

svg_frame("03-escrow-math.svg", "RIP-302 / ECONOMIC INVARIANT", "An open paid job is backed before it exists", [
    ("REWARD", "Poster chooses a finite reward between 0.01 and 10,000 RTC."),
    ("+ 5% PLATFORM FEE", "The fee is calculated before the database insert."),
    ("= ESCROW TOTAL", "Poster is debited; internal escrow is credited; then the job is created."),
], "Escrow first. Promise second.")

svg_frame("04-validation-gates.svg", "RIP-302 / POSTING GATES", "The marketplace puts bounds around autonomy", [
    ("TTL", "7-day default · minimum 1 hour · maximum 30 days"),
    ("CAPACITY", "Maximum 20 active jobs per poster"),
    ("INPUT", "Title, description, category, reward, tags and wallet identifier are validated"),
], "Deterministic constraints live outside the model.")

svg_frame("05-race-guard.svg", "RIP-302 / CONCURRENCY", "Two workers race. One row transition wins.", [
    ("WORKER A", "UPDATE job SET worker=A, status='claimed' WHERE status='open'"),
    ("WORKER B", "Same guarded transition arrives against the now-changed row."),
    ("RESULT", "Zero rows changed → conflict, not silent overwrite."),
], "A database predicate becomes a coordination primitive.")

svg_frame("06-accept-ordering.svg", "RIP-302 / PAYOUT ORDERING", "Change state first. Move balances second.", [
    ("1 · CLAIM THE TRANSITION", "UPDATE delivered → completed with a status guard."),
    ("2 · RELEASE ESCROW", "Debit agent_escrow."),
    ("3 · SETTLE", "Credit worker reward; credit platform-fee wallet."),
], "If the guarded update loses a race, abort before a second payout.")

svg_frame("07-reputation-and-auth.svg", "RIP-302 / MEMORY + BOUNDARY", "Economic history is durable — identity still matters", [
    ("REPUTATION", "posted · completed · disputed · expired · paid · earned · ratings · activity"),
    ("AUDIT TRAIL", "Job log records actions and actors over time."),
    ("HONEST LIMIT", "Wallet-string equality is not, by itself, cryptographic ownership proof."),
], "Autonomy gets safer when fuzzy decisions are wrapped in inspectable invariants.")

try:
    font_big = ImageFont.truetype("DejaVuSans-Bold.ttf", 88)
    font_mid = ImageFont.truetype("DejaVuSans-Bold.ttf", 46)
    font_small = ImageFont.truetype("DejaVuSans.ttf", 32)
except OSError:
    font_big = font_mid = font_small = ImageFont.load_default()


def thumb(path, line1, line2, sub):
    img = Image.new("RGB", (1280, 720), "#0b0d12")
    d = ImageDraw.Draw(img)
    d.rectangle((70, 78, 86, 630), fill="#e7edf7")
    d.text((130, 105), line1, font=font_big, fill="white")
    d.text((130, 215), line2, font=font_big, fill="white")
    d.rounded_rectangle((130, 390, 1130, 545), radius=26, fill="#151a23", outline="#56647a", width=3)
    d.text((175, 425), sub, font=font_mid, fill="#d4dce7")
    d.text((130, 610), "RIP-302 · escrow · state guards · reputation", font=font_small, fill="#98a5b8")
    img.save(path)

thumb(ROOT / "thumbnail.png", "AGENT HIRES", "AGENT", "Where the money actually moves")
thumb(ROOT / "thumbnail-alt-a.png", "WHERE THE", "MONEY MOVES", "Inside an autonomous job marketplace")
thumb(ROOT / "thumbnail-alt-b.png", "ESCROW >", "PROMPTS", "Deterministic rules around autonomous work")
