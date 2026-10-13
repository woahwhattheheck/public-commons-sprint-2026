"""Current composed report edition used by delivery receiving and its browser."""
from .client_economics import CLIENT_REPORT_EDITION
from .scientific_report import REPORT_VERSION

REPORT_EDITION = CLIENT_REPORT_EDITION + "|" + REPORT_VERSION
