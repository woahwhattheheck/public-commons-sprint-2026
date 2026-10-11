"""Stable application errors; native stderr and signer output are never echoed."""


class BuyerError(RuntimeError):
    def __init__(self, code: str, *, operation=None):
        self.code = code
        self.operation = operation
        super().__init__(code)


class NativeError(BuyerError):
    def __init__(self, code: str, *, returncode=None, operation=None):
        self.returncode = returncode
        super().__init__(code, operation=operation)


class StateError(BuyerError):
    pass


class DeliveryError(BuyerError):
    pass
