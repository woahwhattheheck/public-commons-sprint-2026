"""Source-bound food-security member content in the original SocialService."""
from reports.data_members import mapping, generated
from social.model import normalize

DEFINITIONS = (
    ("food-ohio-child-count", "state", "food-39000-child", "count", "integer", 0,
     "Children facing food insecurity", "children under age 18 in Ohio lived in food-insecure households."),
    ("food-ohio-child-rate", "state", "food-39000-child", "rate", "percent", 1,
     "Ohio child food insecurity", "of children under age 18 in Ohio lived in food-insecure households."),
    ("food-child-income-threshold", "state", "food-39000-child", "above_threshold", "percent", 0,
     "Food insecurity and income", "of food-insecure children in Ohio had incomes above 185% of the federal poverty level. This income measure does not show actual programme enrollment."),
    ("food-cuyahoga-child-rate", "counties", "food-39035-child", "rate", "percent", 1,
     "Cuyahoga County children", "of children under age 18 in Cuyahoga County, Ohio lived in food-insecure households."),
)

def bindings(views):
    result = []
    for post_id, key, row_id, column, style, decimals, title, description in DEFINITIONS:
        view = views[key]
        row = next(r for r in view["dataset"]["rows"] if r["id"] == row_id)
        source_id = "food-" + key + "-" + view["sha256"][:20]
        copy = "{{value}} " + description + " Measurement year: {{period}}. Source: Feeding America, Map the Meal Gap 2026."
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
                       "; SHA-256 " + view["sha256"] + "; measurement year " + cell["period"] +
                       ". Original selected URLs, definitions and exact source representations are retained.",
        }
        posts.append({
            "id": item["postId"], "title": item["title"], "theme": "Food-security source working edition",
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
        "schema": "tjl.stc.social-programme.v1", "id": "ohio-food-security-member-toolkit",
        "title": "Ohio food-security member toolkit", "period": {"start": "2027-05-04", "end": "2027-05-04"},
        "timezone": "America/New_York",
        "strategy": {
            "objectives": "Turn exact food-security source observations into editable member communication.",
            "audiences": "Community action agency members and their audiences.",
            "topics": "Child food insecurity and clearly defined income thresholds.",
            "voice": "Plain factual captions naming the population and measurement year.",
            "workflow": "Review the original source and exact proof, designate staff reviewers and actual accounts, then record approval and native publishing outcome. Source corrections require explicit field decisions and a current proof.",
        },
        "brand": {"name": "Ohio food-security source edition", "footer": "2024 data · Feeding America, Map the Meal Gap 2026",
                  "website": "https://oacaa.org/", "font": "DejaVu Sans"},
        "approvers": [],
        "channels": {
            "facebook": {"enabled": True, "accountName": "", "accountUrl": "", "composeUrl": "", "textLimit": 5000, "width": 1200, "height": 1200},
            "linkedin": {"enabled": True, "accountName": "", "accountUrl": "", "composeUrl": "", "textLimit": 3000, "width": 1200, "height": 627},
        },
        "sources": list(sources.values()), "assets": [], "posts": posts,
    })
