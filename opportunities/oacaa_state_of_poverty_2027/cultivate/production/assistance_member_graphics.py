"""Source-bound assistance, health-coverage and labour content in the original SocialService."""
from reports.data_members import mapping, generated
from social.model import normalize

DEFINITIONS = (
    ("assistance-ohio-uninsured", "health", "assistance-health-39-one-year", "rate", "percent", 1,
     "Ohio health coverage", "of Ohio's civilian noninstitutionalized population had no health insurance. This is the one-year ACS release."),
    ("assistance-ohio-unemployment", "labour", "assistance-laus-39", "rate", "percent", 1,
     "Ohio annual unemployment", "was Ohio's annual unemployment rate in the revised source. The earlier release was 4.3% for the same measurement year."),
    ("assistance-ohio-snap", "snap", "assistance-snap-statewide", "members", "integer", 0,
     "Ohio SNAP recipients", "Ohio residents received SNAP benefits in the selected month. Monthly recipients are distinct from an annual population share."),
    ("assistance-pike-heap", "heap", "assistance-heap-39131", "applications", "integer", 0,
     "Pike County energy assistance", "HEAP applications were reported for Pike County. The downloaded source labels the count applications; it does not identify approved payments."),
    ("assistance-pike-medicaid", "medicaid", "assistance-medicaid-39131", "enrolled", "integer", 0,
     "Pike County Medicaid snapshot", "Medicaid enrollees were recorded for Pike County in HPIO's retained snapshot. The enrollment month is not stated."),
)
CREDITS = {
    "health": "U.S. Census Bureau B27001, redistributed by Census Reporter.",
    "labour": "Ohio LMI/BLS LAUS, 2025 benchmark, released May 2026.",
    "snap": "Ohio JFS Public Assistance Monthly Statistics, June 2025.",
    "heap": "Ohio Housing Finance Agency public HHHEAP county CSV.",
    "medicaid": "HPIO analysis of ODM and Census, retrieved February 19, 2025.",
}

def bindings(views):
    result = []
    for post_id, key, row_id, column, style, decimals, title, description in DEFINITIONS:
        view = views[key]
        row = next(r for r in view["dataset"]["rows"] if r["id"] == row_id)
        source_id = "assistance-" + key + "-" + view["sha256"][:20]
        copy = "{{value}} " + description + " Measurement period: {{period}}. Source: " + CREDITS[key]
        rule = mapping({
            "rowId": row_id, "column": column, "format": style, "decimals": decimals,
            "geographyColumn": "geography", "supersededSourceIds": [source_id],
            "templates": {
                "staffCopy": copy, "graphic.headline": "{{value}}",
                "graphic.summary": description, "graphic.kicker": title,
                "graphic.alt": title + ": " + copy + " Plain text on a neutral background.",
                "variants.facebook.text": copy, "variants.linkedin.text": copy,
                "link": row["values"]["source_url"],
            },
        })
        result.append({"postId": post_id, "cohort": key, "sourceId": source_id,
                       "title": title, "sourceUrl": row["values"]["source_url"], "mapping": rule})
    return result

def programme(views):
    sources = {}
    posts = []
    for item in bindings(views):
        view = views[item["cohort"]]
        fields, cell = generated(view["dataset"], item["mapping"])
        source = view["dataset"]["source"]
        # Each initial dataset source identity is retained; the native binding layer
        # gives an explicitly updated post its own managed source descriptor.
        sources[item["sourceId"]] = {
            "id": item["sourceId"], "title": source["title"][:220], "url": item["sourceUrl"],
            "checkedOn": source["retrievedAt"][:10], "validUntil": "",
            "context": "Dataset " + view["id"] + " revision " + str(view["revision"]) +
                       "; SHA-256 " + view["sha256"] + "; measurement period " + cell["period"] +
                       ". Original selected URLs, definitions and exact source representations are retained.",
        }
        posts.append({
            "id": item["postId"], "title": item["title"], "theme": "Assistance and coverage source working edition",
            "assignee": "", "date": "2027-05-04", "time": "11:30", "staffCopy": fields["staffCopy"],
            "copyOrigin": "prepared-draft",
            "editorialNote": "Review the selected population, source year and exact proof. Staff select the real member account and placement. The draft date follows the original RFP launch milestone.",
            "link": fields["link"], "sourceIds": [item["sourceId"]], "historicalContext": True, "archived": False,
            "graphic": {"kind": "card", "headline": fields["graphic.headline"], "summary": fields["graphic.summary"],
                        "kicker": fields["graphic.kicker"], "assetId": "", "alt": fields["graphic.alt"], "cropX": 0.5, "cropY": 0.5},
            "variants": {"facebook": {"text": fields["variants.facebook.text"], "date": "", "time": ""},
                         "linkedin": {"text": fields["variants.linkedin.text"], "date": "", "time": ""}},
        })
    return normalize({
        "schema": "tjl.stc.social-programme.v1", "id": "ohio-assistance-member-toolkit",
        "title": "Ohio assistance and coverage member toolkit", "period": {"start": "2027-05-04", "end": "2027-05-04"},
        "timezone": "America/New_York",
        "strategy": {
            "objectives": "Turn exact assistance, health-coverage and labour observations into editable member communication.",
            "audiences": "Community action agency members and their audiences.",
            "topics": "Health coverage, unemployment and precisely dated programme receipt and applications.",
            "voice": "Plain factual captions naming the population, measurement period and source release.",
            "workflow": "Review the original source and exact proof, designate staff reviewers and actual accounts, then record approval and native publishing outcome. Source corrections require explicit field decisions and a current proof.",
        },
        "brand": {"name": "Ohio assistance source edition", "footer": "Source period and population remain explicit",
                  "website": "https://oacaa.org/", "font": "DejaVu Sans"},
        "approvers": [],
        "channels": {
            "facebook": {"enabled": True, "accountName": "", "accountUrl": "", "composeUrl": "", "textLimit": 5000, "width": 1200, "height": 1200},
            "linkedin": {"enabled": True, "accountName": "", "accountUrl": "", "composeUrl": "", "textLimit": 3000, "width": 1200, "height": 627},
        },
        "sources": list(sources.values()), "assets": [], "posts": posts,
    })
