"""Current composed report edition used by delivery receiving and its browser."""
from .client_economics import CLIENT_REPORT_EDITION
from .scientific_report import REPORT_VERSION
from .client_report import REPORT_EDITION as COMPANION_EDITION

REPORT_EDITION = CLIENT_REPORT_EDITION + "|" + REPORT_VERSION + "|" + COMPANION_EDITION
