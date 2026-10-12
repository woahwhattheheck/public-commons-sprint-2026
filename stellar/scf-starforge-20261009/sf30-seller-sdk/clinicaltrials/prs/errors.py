"""Public error type for the retained PRS XML workflow."""
class PrsError(ValueError):
    def __init__(self, message, code="INVALID_REQUEST", details=None):
        super().__init__(message)
        self.code = code
        self.details = details
    def as_dict(self):
        return {"error": {"code": self.code, "message": str(self), "details": self.details}}
