"""Property surveys and purpose-specific comparable selections in the study workspace."""

from .service import PropertyResearch, install, overview


def handlers(workspace):
    service = PropertyResearch(workspace)
    return {
        "property.status": service.status,
        "property.document.import": service.import_document,
        "property.document.read": service.document,
        "property.intake": service.intake,
        "property.study.freeze": service.freeze_study,
        "property.edition.read": service.edition,
        "property.edition.packet": service.packet,
        "property.edition.revise": service.revise,
        "property.comparison.create": service.compare,
        "property.comparison.read": service.comparison,
        "property.review.apply": service.review,
        "property.selection.freeze": service.select,
        "property.selection.read": service.selection,
        "property.selection.report": service.report,
        "property.selection.export": service.export,
    }
