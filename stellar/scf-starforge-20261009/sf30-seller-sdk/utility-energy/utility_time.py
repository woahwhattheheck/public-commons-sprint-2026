"""MIT. Exact source instants and explicit customer time-zone views."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from utility_shared import InputError

UTC = timezone.utc
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z")
NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\Z")

def decimal(value, label="Source value"):
    if isinstance(value, bool) or value is None:
        raise InputError(label + " must be a finite decimal")
    text = str(value)
    if len(text) > 512 or not NUMBER.fullmatch(text):
        raise InputError(label + " must be a finite decimal with at most 512 characters")
    try:
        result = Decimal(text)
    except InvalidOperation as error:
        raise InputError(label + " is not a decimal") from error
    if not result.is_finite() or abs(result.adjusted()) > 256:
        raise InputError(label + " is outside the supported exact decimal range")
    return result

def decimal_text(value):
    with localcontext() as context:
        context.prec = 1024
        text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text

def scale(value, exponent):
    exponent = int(exponent)
    if not -128 <= exponent <= 127:
        raise InputError("The source multiplier must be between -128 and 127")
    with localcontext() as context:
        context.prec = 1024
        return decimal_text(decimal(value) * Decimal(10) ** exponent)

def instant(value):
    """Return integer UTC microseconds; retain source offset separately."""
    if not isinstance(value, str) or not ISO.fullmatch(value):
        raise InputError("Use a complete source timestamp with an explicit UTC offset and at most six fractional digits")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elapsed = parsed.astimezone(UTC) - EPOCH
    except (ValueError, OverflowError) as error:
        raise InputError("The source timestamp is outside the supported calendar") from error
    return (elapsed.days * 86400 + elapsed.seconds) * 1000000 + elapsed.microseconds

def epoch_seconds(value):
    number = decimal(value, "Epoch seconds")
    if number != number.to_integral_value():
        raise InputError("Green Button epoch seconds must be integral")
    micros = int(number) * 1000000
    utc(micros)
    return micros

def utc(micros):
    try:
        value = EPOCH + timedelta(microseconds=int(micros))
    except (ValueError, OverflowError) as error:
        raise InputError("The source instant is outside the supported calendar") from error
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")

def duration_text(start, end):
    return decimal_text(Decimal(end-start) / Decimal(1000000))

def zone(name):
    if name in {None, "", "UTC"}:
        return UTC
    if not isinstance(name, str) or len(name) > 160:
        raise InputError("Choose a complete IANA time-zone name")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise InputError("This host does not have the selected IANA time zone") from error

def local(micros, name):
    return (EPOCH + timedelta(microseconds=int(micros))).astimezone(zone(name)).isoformat(timespec="microseconds")

def period(start, end, *, espi=False):
    parse = epoch_seconds if espi else instant
    first, last = parse(start), parse(end)
    if last <= first:
        raise InputError("The source interval must end after it starts")
    return {"start_us":first, "end_us":last, "start_utc":utc(first),
            "end_utc":utc(last), "duration_seconds":duration_text(first,last)}


def dst_rule(value, year):
    """Decode DstRuleType fields in local civil time, without an IANA guess."""
    import calendar
    if not isinstance(value,str) or not re.fullmatch(r"[0-9a-fA-F]{8}",value):
        raise InputError("A source DST rule must retain its four-byte hexadecimal value")
    number=int(value,16)
    if number==0xFFFFFFFF:
        return None
    seconds=number & 0xFFF
    hours=(number>>12) & 0x1F
    weekday=(number>>17) & 0x7
    day=(number>>20) & 0x1F
    operator=(number>>25) & 0x7
    month=(number>>28) & 0xF
    if not 1<=month<=12 or seconds>3599 or hours>23:
        raise InputError("The original DST bitmap has invalid month, hour or seconds")
    maximum=calendar.monthrange(year,month)[1]
    if operator==0:
        if not 1<=day<=maximum:raise InputError("The original DST rule has an invalid calendar day")
    else:
        if not 1<=weekday<=7:raise InputError("A relative DST rule needs an explicit weekday")
        if operator==1:
            if not 1<=day<=maximum:raise InputError("An on-or-after DST rule needs a calendar day")
            day += (weekday-1-datetime(year,month,day).weekday())%7
        else:
            first=1+(weekday-1-datetime(year,month,1).weekday())%7
            day=(first+7*((maximum-first)//7)) if operator==7 else first+7*(operator-2)
        if not 1<=day<=maximum:raise InputError("The original relative DST rule has no date in this year")
    return datetime(year,month,day,hours,seconds//60,seconds%60)

def source_local(micros, parameters):
    """Apply ESPI's standard UTC offset and exact retained DST rule."""
    if not isinstance(parameters,dict) or "tzOffset" not in parameters:
        raise InputError("The source has no LocalTimeParameters standard offset")
    standard_value=decimal(parameters["tzOffset"],"Standard UTC offset")
    extra_value=decimal(parameters.get("dstOffset","0"),"DST offset")
    if standard_value!=standard_value.to_integral_value() or extra_value!=extra_value.to_integral_value():
        raise InputError("ESPI local offsets must be whole seconds")
    standard=int(standard_value);extra=int(extra_value)
    if not -86400<standard<86400 or not -86400<standard+extra<86400:
        raise InputError("The source local offset is outside one day")
    current=EPOCH+timedelta(microseconds=int(micros))
    year=(current+timedelta(seconds=standard)).year
    use_dst=False
    if extra:
        start=dst_rule(parameters.get("dstStartRule","FFFFFFFF"),year)
        end=dst_rule(parameters.get("dstEndRule","FFFFFFFF"),year)
        if (start is None)!=(end is None):
            raise InputError("The original source supplies only one enabled DST boundary")
        if start is not None:
            if end<=start:
                raise InputError("ESPI requires the evaluated end rule after the start rule within the year")
            starts=start.replace(tzinfo=UTC)-timedelta(seconds=standard)
            ends=end.replace(tzinfo=UTC)-timedelta(seconds=standard+extra)
            use_dst=starts<=current<ends
    return current.astimezone(timezone(timedelta(seconds=standard+(extra if use_dst else 0)))).isoformat(timespec="microseconds")
