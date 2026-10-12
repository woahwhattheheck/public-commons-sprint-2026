"""MIT. Source-selected availability evaluation without invented recurrence or capacity."""
from __future__ import annotations
import calendar
from datetime import date,datetime,time,timedelta,timezone
from decimal import Decimal,InvalidOperation
import re
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from directory_runtime import InputError
DAYS={"MO":0,"TU":1,"WE":2,"TH":3,"FR":4,"SA":5,"SU":6}

def instant(raw,label="Selected instant"):
    if not isinstance(raw,str):raise InputError(label+" must retain an ISO8601 instant with its UTC offset")
    try:value=datetime.fromisoformat(raw.replace("Z","+00:00"))
    except ValueError:raise InputError(label+" is not an ISO8601 instant")
    if value.tzinfo is None:raise InputError(label+" must state its original UTC offset")
    return value

def decimal(raw,label):
    if type(raw)is bool or isinstance(raw,(dict,list)) or raw in (None,""):raise InputError(label+" must retain a finite numeric token")
    try:value=Decimal(str(raw))
    except (InvalidOperation,ValueError):raise InputError(label+" is not a decimal number")
    if not value.is_finite():raise InputError(label+" must be finite")
    return value

def day(raw,label):
    if not isinstance(raw,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",raw):
        raise InputError(label+" requires an original YYYY-MM-DD date")
    try:return date.fromisoformat(raw)
    except ValueError:raise InputError(label+" is not a calendar date")

def integer(raw,label,minimum=1,maximum=1000000):
    v=decimal(raw,label)
    if v!=v.to_integral_value() or v<minimum or v>maximum:raise InputError(label+" is outside the supported integer range")
    return int(v)

def zone(raw,default=None):
    if raw is None or raw=="":return default
    try:return ZoneInfo(raw)
    except (ZoneInfoNotFoundError,ValueError,TypeError):raise InputError("The selected IANA timezone is unavailable or invalid")

def numbers(raw,label,lo,hi):
    if raw in (None,""):return []
    if not isinstance(raw,str):raise InputError(label+" retains its comma-separated source text")
    result=[]
    for token in raw.split(","):
        token=token.strip()
        if not re.fullmatch(r"-?[1-9][0-9]*",token):raise InputError(label+" contains an unsupported token")
        n=int(token)
        if n<lo or n>hi:raise InputError(label+" contains an out-of-range token")
        result.append(n)
    return result

def weekdays(raw,monthly=False):
    if raw in (None,""):return []
    if not isinstance(raw,str):raise InputError("byday retains its original comma-separated value")
    result=[]
    for token in raw.split(","):
        match=re.fullmatch(r"([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)",token.strip())
        if not match or match[1] and not monthly:raise InputError("The selected byday token does not match its recurrence frequency")
        result.append((int(match[1]) if match[1] else None,DAYS[match[2]]))
    return result

def recurrence(raw,candidate):
    """Return whether this local start date occurs; COUNT uses exact dated events."""
    freq=raw.get("freq");start=day(raw["dtstart"],"dtstart") if raw.get("dtstart") else None
    if raw.get("until") and candidate>day(raw["until"],"until"):return False
    if start and candidate<start:return False
    if raw.get("byweekno") or raw.get("byyearday"):
        raise InputError("This original schedule retains byweekno/byyearday; the source-specific recurrence needs an explicit receiving interpretation")
    if freq not in ("WEEKLY","MONTHLY",None,""):raise InputError("The original schedule frequency is outside HSDS WEEKLY/MONTHLY")
    every=integer(raw.get("interval") or 1,"interval")
    if every!=1 and not start:raise InputError("A repeated interval requires its original dtstart")
    if not freq:
        if not start:raise InputError("The schedule supplies no dated occurrence or recurrence frequency")
        if any(raw.get(k) for k in ("byday","bymonthday","count","interval")):raise InputError("The original recurrence fields require an explicit frequency")
        return candidate==start
    byday=weekdays(raw.get("byday"),monthly=freq=="MONTHLY")
    bymonthday=numbers(raw.get("bymonthday"),"bymonthday",-31,31)
    if freq=="WEEKLY" and bymonthday:raise InputError("A WEEKLY source with bymonthday requires an explicit interpretation")
    def occurs(d):
        if start and d<start:return False
        if freq=="WEEKLY":
            wk=raw.get("wkst") or "MO"
            if wk not in DAYS:raise InputError("The original week-start token is invalid")
            if start and every!=1:
                a=start-timedelta(days=(start.weekday()-DAYS[wk])%7)
                b=d-timedelta(days=(d.weekday()-DAYS[wk])%7)
                if ((b-a).days//7)%every:return False
            selected={x[1] for x in byday} if byday else {start.weekday()} if start else None
            if selected is None:raise InputError("A weekly recurrence needs original byday or dtstart")
            return d.weekday() in selected
        if start and ((d.year-start.year)*12+d.month-start.month)%every:return False
        length=calendar.monthrange(d.year,d.month)[1]
        if bymonthday and d.day not in {n if n>0 else length+n+1 for n in bymonthday}:return False
        if byday:
            matches=False
            for ordinal,dow in byday:
                if d.weekday()!=dow:continue
                if ordinal is None or ordinal>0 and (d.day-1)//7+1==ordinal or ordinal<0 and -((length-d.day)//7+1)==ordinal:
                    matches=True
            if not matches:return False
        if not byday and not bymonthday:
            if not start:raise InputError("A monthly recurrence needs byday, bymonthday or dtstart")
            return d.day==start.day
        return True
    if not occurs(candidate):return False
    if raw.get("count") not in (None,""):
        count=integer(raw["count"],"count")
        if not start:raise InputError("A finite occurrence count needs its original dtstart")
        if (candidate-start).days>36600:raise InputError("The exact COUNT evaluation exceeds the declared100-year calendar window")
        found=0;cursor=start
        while cursor<=candidate:
            if occurs(cursor):
                found+=1
                if found>count:return False
            cursor+=timedelta(days=1)
    return True

def local_interval(raw,start_date,selected_zone=None,fhir=False):
    start_raw=raw.get("availableStartTime") if fhir else raw.get("opens_at")
    end_raw=raw.get("availableEndTime") if fhir else raw.get("closes_at")
    if fhir and raw.get("allDay") is True:
        z=zone(selected_zone)
        if z is None:raise InputError("FHIR allDay requires the selected service's explicit timezone")
        return datetime.combine(start_date,time.min,z),datetime.combine(start_date+timedelta(days=1),time.min,z),"selected-IANA"
    if not start_raw or not end_raw:raise InputError("The original schedule does not state both opening and closing times")
    try:a=time.fromisoformat(str(start_raw).replace("Z","+00:00"));b=time.fromisoformat(str(end_raw).replace("Z","+00:00"))
    except ValueError:raise InputError("The original opening or closing time is not an ISO8601 time")
    if (a.tzinfo is None)!=(b.tzinfo is None):raise InputError("The original interval mixes offset-aware and offset-free times")
    basis="original-time-offset"
    if a.tzinfo is None:
        if fhir:
            z=zone(selected_zone)
            if z is None:raise InputError("FHIR local service hours require an explicitly selected IANA timezone")
            basis="selected-IANA"
        else:
            offset=decimal(raw.get("timezone") if raw.get("timezone") not in (None,"") else 0,"HSDS UTC offset")
            if abs(offset)>=24:raise InputError("HSDS timezone is an explicit UTC offset smaller than24 hours")
            seconds=offset*3600
            if seconds!=seconds.to_integral_value():raise InputError("The HSDS UTC offset needs exact whole seconds")
            z=timezone(timedelta(seconds=int(seconds)));basis="original-HSDS-offset" if raw.get("timezone") not in (None,"") else "HSDS-default-UTC"
        a=a.replace(tzinfo=z);b=b.replace(tzinfo=z)
    begin=datetime.combine(start_date,a);finish=datetime.combine(start_date,b)
    if finish==begin:raise InputError("Equal opening and closing times do not establish an all-day schedule")
    if finish<begin:finish+=timedelta(days=1)
    # Ambiguous local wall times require an explicit source offset, not an implicit fold.
    for dt in (begin,finish):
        if isinstance(dt.tzinfo,ZoneInfo):
            if dt.replace(fold=0).utcoffset()!=dt.replace(fold=1).utcoffset():
                raise InputError("This interval crosses an ambiguous or missing daylight-saving wall time; retain an explicit offset")
            if dt.astimezone(timezone.utc).astimezone(dt.tzinfo).replace(tzinfo=None)!=dt.replace(tzinfo=None):
                raise InputError("The selected local wall time does not exist in its timezone")
    return begin,finish,basis

def schedule_result(raw,at,selected_zone=None,fhir=False):
    observed={"state":"unknown","selectedAt":at.isoformat(),"original":raw}
    try:
        if fhir:
            z=zone(selected_zone)
            if z is None:raise InputError("FHIR availableTime needs a selected service timezone")
            current=at.astimezone(z)
        else:
            opening=raw.get("opens_at")
            try:t=time.fromisoformat(str(opening).replace("Z","+00:00")) if opening else None
            except ValueError:t=None
            if t and t.tzinfo:z=t.tzinfo
            else:
                offset=decimal(raw.get("timezone") if raw.get("timezone") not in (None,"") else 0,"HSDS UTC offset")
                if abs(offset)>=24:raise InputError("HSDS timezone is outside a valid UTC offset")
                z=timezone(timedelta(seconds=float(offset*3600)))
            current=at.astimezone(z)
        # Current and prior local day cover ordinary and overnight intervals exactly.
        intervals=[]
        for start_date in [current.date()-timedelta(days=1),current.date()]:
            if not fhir:
                if raw.get("valid_from") and start_date<day(raw["valid_from"],"valid_from"):continue
                if raw.get("valid_to") and start_date>day(raw["valid_to"],"valid_to"):continue
                if not recurrence(raw,start_date):continue
            else:
                days=raw.get("daysOfWeek") or []
                if any(d not in {"mon","tue","wed","thu","fri","sat","sun"} for d in days):
                    raise InputError("Original FHIR daysOfWeek contains an unsupported token")
                if days and ["mon","tue","wed","thu","fri","sat","sun"][start_date.weekday()] not in days:continue
                if not days and raw.get("allDay")is not True:raise InputError("Original FHIR availableTime omits daysOfWeek; retain an explicit service-day interpretation")
            begin,finish,basis=local_interval(raw,start_date,selected_zone,fhir)
            intervals.append({"start":begin.isoformat(),"end":finish.isoformat(),"basis":basis})
            if begin<=at<finish:
                return {**observed,"state":"open","interval":intervals[-1],"reason":"Selected instant falls in the exact original interval"}
        return {**observed,"state":"closed","intervals":intervals,"reason":"Selected instant is outside the original supported intervals"}
    except (InputError,OverflowError,ValueError) as error:
        return {**observed,"reason":str(error)}

def capacity_result(raw,requested):
    result={"state":"unknown","original":raw,"requested":requested}
    try:
        as_of=instant(requested["asOf"],"Capacity assessment");updated=instant(raw.get("updated"),"Original capacity update")
        available=decimal(raw.get("available"),"Original available capacity");minimum=decimal(requested["minimum"],"Selected minimum")
        age=Decimal(str((as_of-updated).total_seconds()))/3600
        result.update({"updatedAt":updated.isoformat(),"ageHours":str(age),"availableToken":str(available)})
        if available<0:raise InputError("Original available capacity is negative")
        if age<0:raise InputError("Capacity update is later than the selected assessment instant")
        if age>decimal(requested["maximumAgeHours"],"Maximum observation age"):
            return {**result,"state":"stale","reason":"Original observation exceeds the selected age"}
        if raw.get("maximum") not in (None,""):
            maximum=decimal(raw["maximum"],"Original maximum capacity")
            if maximum<0 or available>maximum:
                return {**result,"state":"conflicting","reason":"Original available and maximum counts are inconsistent"}
        return {**result,"state":"sufficient" if available>=minimum else "insufficient","reason":"Comparison uses the exact selected unit and original dated observation"}
    except InputError as error:return {**result,"reason":str(error)}
