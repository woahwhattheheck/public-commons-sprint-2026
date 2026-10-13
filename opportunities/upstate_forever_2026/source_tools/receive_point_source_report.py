#!/usr/bin/env python3
"""Receive the complete original Eighteenmile source and run the existing report course."""
from __future__ import annotations
import argparse
import base64
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import socket
import subprocess
import sys
import types

HELPER_BASE64="IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwojIHJ1ZmY6IG5vcWE6IFRJRDI1MQppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHNvY2tldAppbXBvcnQgc3NsCmltcG9ydCB1cmxsaWIuZXJyb3IKaW1wb3J0IHVybGxpYi5yZXF1ZXN0CmZyb20gZGF0YWNsYXNzZXMgaW1wb3J0IGRhdGFjbGFzcwpmcm9tIHBhdGhsaWIgaW1wb3J0IFBhdGgKZnJvbSB0aHJlYWRpbmcgaW1wb3J0IExvY2sKCgpjbGFzcyBIb3N0ZWRBcHBzRXJyb3IoRXhjZXB0aW9uKToKICAgIHBhc3MKCgpjbGFzcyBIb3N0ZWRBcHBzVG9vbEVycm9yKEhvc3RlZEFwcHNFcnJvcik6CiAgICBkZWYgX19pbml0X18oc2VsZiwgbWVzc2FnZTogc3RyLCByZXN1bHQ6IGRpY3Rbc3RyLCBvYmplY3RdKSAtPiBOb25lOgogICAgICAgIHN1cGVyKCkuX19pbml0X18obWVzc2FnZSkKICAgICAgICBzZWxmLnJlc3VsdCA9IHJlc3VsdAoKCl9NQVhfVE9PTF9MSVNUX1BBR0VTID0gMTAwCgoKZGVmIF91cmxfZXJyb3JfY2F0ZWdvcnkocmVhc29uOiBvYmplY3QpIC0+IHN0cjoKICAgIGlmIGlzaW5zdGFuY2UocmVhc29uLCBUaW1lb3V0RXJyb3IpOgogICAgICAgIHJldHVybiAidGltZW91dCIKICAgIGlmIGlzaW5zdGFuY2UocmVhc29uLCBzb2NrZXQuZ2FpZXJyb3IpOgogICAgICAgIHJldHVybiAiRE5TIgogICAgaWYgaXNpbnN0YW5jZShyZWFzb24sIHNzbC5TU0xFcnJvcik6CiAgICAgICAgcmV0dXJuICJUTFMiCiAgICBpZiBpc2luc3RhbmNlKHJlYXNvbiwgQ29ubmVjdGlvbkVycm9yKToKICAgICAgICByZXR1cm4gImNvbm5lY3Rpb24iCiAgICByZXR1cm4gIm5ldHdvcmsiCgoKZGVmIF9yZXF1aXJlX29iamVjdCh2YWx1ZTogb2JqZWN0LCBsYWJlbDogc3RyKSAtPiBkaWN0W3N0ciwgb2JqZWN0XToKICAgIGlmIG5vdCBpc2luc3RhbmNlKHZhbHVlLCBkaWN0KToKICAgICAgICByYWlzZSBIb3N0ZWRBcHBzRXJyb3IoZiJ7bGFiZWx9IG11c3QgYmUgYSBKU09OIG9iamVjdCIpCiAgICBpZiBub3QgYWxsKGlzaW5zdGFuY2Uoa2V5LCBzdHIpIGZvciBrZXkgaW4gdmFsdWUpOgogICAgICAgIHJhaXNlIEhvc3RlZEFwcHNFcnJvcihmIntsYWJlbH0ga2V5cyBtdXN0IGJlIHN0cmluZ3MiKQogICAgcmV0dXJuIHZhbHVlCgoKZGVmIF9yZXF1aXJlX3N0cmluZyh2YWx1ZTogb2JqZWN0LCBsYWJlbDogc3RyKSAtPiBzdHI6CiAgICBpZiBub3QgaXNpbnN0YW5jZSh2YWx1ZSwgc3RyKSBvciBub3QgdmFsdWU6CiAgICAgICAgcmFpc2UgSG9zdGVkQXBwc0Vycm9yKGYie2xhYmVsfSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyIpCiAgICByZXR1cm4gdmFsdWUKCgpAZGF0YWNsYXNzKGZyb3plbj1UcnVlKQpjbGFzcyBIb3N0ZWRBcHBUb29sOgogICAgbmFtZTogc3RyCiAgICBtZXRhOiBkaWN0W3N0ciwgb2JqZWN0XQoKCmNsYXNzIEhvc3RlZEFwcHNDbGllbnQ6CiAgICAiIiJDYWxsIGF1dGhlbnRpY2F0ZWQgaG9zdGVkLWFwcCB0b29scyBmcm9tIHRoZSBhY3RpdmUgQ29kZXggc2Vzc2lvbi4iIiIKCiAgICBkZWYgX19pbml0X18oc2VsZikgLT4gTm9uZToKICAgICAgICBzZWxmLmVuZHBvaW50ID0gb3MuZW52aXJvbi5nZXQoCiAgICAgICAgICAgICJDT0RFWF9BUFBTX01DUF9VUkwiLAogICAgICAgICAgICAiaHR0cHM6Ly9jaGF0Z3B0LmNvbS9iYWNrZW5kLWFwaS93aGFtL2FwcHMiLAogICAgICAgICkKICAgICAgICBzZWxmLl9yZXF1ZXN0X2lkID0gMAogICAgICAgIHNlbGYuX3JlcXVlc3RfaWRfbG9jayA9IExvY2soKQogICAgICAgIHNlbGYuX3Rvb2xzOiBsaXN0W0hvc3RlZEFwcFRvb2xdID0gW10KICAgICAgICBzZWxmLl90b29sX2xvY2sgPSBMb2NrKCkKCiAgICBkZWYgY2FsbF90b29sKAogICAgICAgIHNlbGYsCiAgICAgICAgY29ubmVjdG9yX2lkOiBzdHIsCiAgICAgICAgdG9vbF9uYW1lOiBzdHIsCiAgICAgICAgYXJndW1lbnRzOiBkaWN0W3N0ciwgb2JqZWN0XSwKICAgICkgLT4gZGljdFtzdHIsIG9iamVjdF06CiAgICAgICAgdG9vbCA9IHNlbGYuX3Rvb2woY29ubmVjdG9yX2lkLCB0b29sX25hbWUpCiAgICAgICAgcGFyYW1zOiBkaWN0W3N0ciwgb2JqZWN0XSA9IHsKICAgICAgICAgICAgIm5hbWUiOiB0b29sLm5hbWUsCiAgICAgICAgICAgICJhcmd1bWVudHMiOiBhcmd1bWVudHMsCiAgICAgICAgfQogICAgICAgIHJlcXVlc3RfbWV0YSA9IHNlbGYuX3JlcXVlc3RfbWV0YSh0b29sLm1ldGEpCiAgICAgICAgaWYgcmVxdWVzdF9tZXRhOgogICAgICAgICAgICBwYXJhbXNbIl9tZXRhIl0gPSByZXF1ZXN0X21ldGEKICAgICAgICByZXN1bHQgPSBzZWxmLl9ycGMoInRvb2xzL2NhbGwiLCBwYXJhbXMpCiAgICAgICAgaWYgcmVzdWx0LmdldCgiaXNFcnJvciIpIGlzIFRydWU6CiAgICAgICAgICAgIHJhaXNlIEhvc3RlZEFwcHNUb29sRXJyb3IoZiJ7dG9vbF9uYW1lfSBmYWlsZWQiLCByZXN1bHQpCiAgICAgICAgcmV0dXJuIHJlc3VsdAoKICAgIGRlZiBfdG9vbChzZWxmLCBjb25uZWN0b3JfaWQ6IHN0ciwgdG9vbF9uYW1lOiBzdHIpIC0+IEhvc3RlZEFwcFRvb2w6CiAgICAgICAgd2l0aCBzZWxmLl90b29sX2xvY2s6CiAgICAgICAgICAgIHRvb2wgPSBzZWxmLl9maW5kX3Rvb2woY29ubmVjdG9yX2lkLCB0b29sX25hbWUpCiAgICAgICAgICAgIHJldHVybiB0b29sIG9yIHNlbGYuX2xvYWRfdG9vbChjb25uZWN0b3JfaWQsIHRvb2xfbmFtZSkKCiAgICBkZWYgX2ZpbmRfdG9vbCgKICAgICAgICBzZWxmLAogICAgICAgIGNvbm5lY3Rvcl9pZDogc3RyLAogICAgICAgIHRvb2xfbmFtZTogc3RyLAogICAgKSAtPiBIb3N0ZWRBcHBUb29sIHwgTm9uZToKICAgICAgICByZXR1cm4gbmV4dCgKICAgICAgICAgICAgKHRvb2wgZm9yIHRvb2wgaW4gc2VsZi5fdG9vbHMgaWYgc2VsZi5faXNfdG9vbCh0b29sLCBjb25uZWN0b3JfaWQsIHRvb2xfbmFtZSkpLAogICAgICAgICAgICBOb25lLAogICAgICAgICkKCiAgICBkZWYgX2xvYWRfdG9vbChzZWxmLCBjb25uZWN0b3JfaWQ6IHN0ciwgdG9vbF9uYW1lOiBzdHIpIC0+IEhvc3RlZEFwcFRvb2w6CiAgICAgICAgY3Vyc29yOiBzdHIgfCBOb25lID0gTm9uZQogICAgICAgIHNlZW5fY3Vyc29yczogc2V0W3N0cl0gPSBzZXQoKQogICAgICAgIGZvciBfIGluIHJhbmdlKF9NQVhfVE9PTF9MSVNUX1BBR0VTKToKICAgICAgICAgICAgcGFyYW1zOiBkaWN0W3N0ciwgb2JqZWN0XSA9IHt9CiAgICAgICAgICAgIGlmIGN1cnNvciBpcyBub3QgTm9uZToKICAgICAgICAgICAgICAgIHBhcmFtc1siY3Vyc29yIl0gPSBjdXJzb3IKICAgICAgICAgICAgcmVzdWx0ID0gc2VsZi5fcnBjKCJ0b29scy9saXN0IiwgcGFyYW1zKQogICAgICAgICAgICB0b29scyA9IHJlc3VsdC5nZXQoInRvb2xzIikKICAgICAgICAgICAgaWYgbm90IGlzaW5zdGFuY2UodG9vbHMsIGxpc3QpOgogICAgICAgICAgICAgICAgcmFpc2UgSG9zdGVkQXBwc0Vycm9yKCJob3N0ZWQgYXBwcyB0b29scy9saXN0IGRpZCBub3QgcmV0dXJuIGEgdG9vbHMgYXJyYXkiKQogICAgICAgICAgICBkaXNjb3ZlcmVkOiBsaXN0W0hvc3RlZEFwcFRvb2xdID0gW10KICAgICAgICAgICAgZm9yIGluZGV4LCB0b29sX3ZhbHVlIGluIGVudW1lcmF0ZSh0b29scyk6CiAgICAgICAgICAgICAgICB0b29sID0gX3JlcXVpcmVfb2JqZWN0KHRvb2xfdmFsdWUsIGYidG9vbHNbe2luZGV4fV0iKQogICAgICAgICAgICAgICAgbmFtZSA9IHRvb2wuZ2V0KCJuYW1lIikKICAgICAgICAgICAgICAgIG1ldGEgPSB0b29sLmdldCgiX21ldGEiKQogICAgICAgICAgICAgICAgaWYgbm90IGlzaW5zdGFuY2UobmFtZSwgc3RyKSBvciBub3QgbmFtZSBvciBub3QgaXNpbnN0YW5jZShtZXRhLCBkaWN0KToKICAgICAgICAgICAgICAgICAgICBjb250aW51ZQogICAgICAgICAgICAgICAgZGlzY292ZXJlZC5hcHBlbmQoCiAgICAgICAgICAgICAgICAgICAgSG9zdGVkQXBwVG9vbCgKICAgICAgICAgICAgICAgICAgICAgICAgbmFtZT1uYW1lLAogICAgICAgICAgICAgICAgICAgICAgICBtZXRhPW1ldGEsCiAgICAgICAgICAgICAgICAgICAgKQogICAgICAgICAgICAgICAgKQogICAgICAgICAgICBzZWxmLl90b29scy5leHRlbmQoZGlzY292ZXJlZCkKICAgICAgICAgICAgbWF0Y2hlZF90b29sID0gc2VsZi5fZmluZF90b29sKGNvbm5lY3Rvcl9pZCwgdG9vbF9uYW1lKQogICAgICAgICAgICBpZiBtYXRjaGVkX3Rvb2wgaXMgbm90IE5vbmU6CiAgICAgICAgICAgICAgICByZXR1cm4gbWF0Y2hlZF90b29sCiAgICAgICAgICAgIG5leHRfY3Vyc29yID0gcmVzdWx0LmdldCgibmV4dEN1cnNvciIsIHJlc3VsdC5nZXQoIm5leHRfY3Vyc29yIikpCiAgICAgICAgICAgIGlmIG5vdCBpc2luc3RhbmNlKG5leHRfY3Vyc29yLCBzdHIpIG9yIG5vdCBuZXh0X2N1cnNvcjoKICAgICAgICAgICAgICAgIGJyZWFrCiAgICAgICAgICAgIGlmIG5leHRfY3Vyc29yIGluIHNlZW5fY3Vyc29yczoKICAgICAgICAgICAgICAgIHJhaXNlIEhvc3RlZEFwcHNFcnJvcigiaG9zdGVkIGFwcHMgdG9vbHMvbGlzdCBjdXJzb3IgcmVwZWF0ZWQiKQogICAgICAgICAgICBzZWVuX2N1cnNvcnMuYWRkKG5leHRfY3Vyc29yKQogICAgICAgICAgICBjdXJzb3IgPSBuZXh0X2N1cnNvcgogICAgICAgIHJhaXNlIEhvc3RlZEFwcHNFcnJvcihmIkxpYnJhcnkge3Rvb2xfbmFtZX0gaXMgbm90IGF2YWlsYWJsZSIpCgogICAgQHN0YXRpY21ldGhvZAogICAgZGVmIF9pc190b29sKAogICAgICAgIHRvb2w6IEhvc3RlZEFwcFRvb2wsCiAgICAgICAgY29ubmVjdG9yX2lkOiBzdHIsCiAgICAgICAgdG9vbF9uYW1lOiBzdHIsCiAgICApIC0+IGJvb2w6CiAgICAgICAgZGlzY292ZXJlZF9jb25uZWN0b3JfaWQgPSBuZXh0KAogICAgICAgICAgICAoCiAgICAgICAgICAgICAgICB0b29sLm1ldGEuZ2V0KGtleSkKICAgICAgICAgICAgICAgIGZvciBrZXkgaW4gKCJjb25uZWN0b3JfaWQiLCAiY29ubmVjdG9ySWQiLCAiYXBwX2lkIiwgImFwcElkIikKICAgICAgICAgICAgICAgIGlmIHRvb2wubWV0YS5nZXQoa2V5KSBpcyBub3QgTm9uZQogICAgICAgICAgICApLAogICAgICAgICAgICBOb25lLAogICAgICAgICkKICAgICAgICByZXR1cm4gZGlzY292ZXJlZF9jb25uZWN0b3JfaWQgPT0gY29ubmVjdG9yX2lkIGFuZCAoCiAgICAgICAgICAgIHRvb2wubmFtZSA9PSB0b29sX25hbWUKICAgICAgICAgICAgb3IgdG9vbC5uYW1lLmVuZHN3aXRoKGYiX3t0b29sX25hbWV9IikKICAgICAgICAgICAgb3IgdG9vbC5uYW1lLmVuZHN3aXRoKGYiLnt0b29sX25hbWV9IikKICAgICAgICApCgogICAgZGVmIF9ycGMoCiAgICAgICAgc2VsZiwKICAgICAgICBtZXRob2Q6IHN0ciwKICAgICAgICBwYXJhbXM6IGRpY3Rbc3RyLCBvYmplY3RdLAogICAgKSAtPiBkaWN0W3N0ciwgb2JqZWN0XToKICAgICAgICB3aXRoIHNlbGYuX3JlcXVlc3RfaWRfbG9jazoKICAgICAgICAgICAgc2VsZi5fcmVxdWVzdF9pZCArPSAxCiAgICAgICAgICAgIHJlcXVlc3RfaWQgPSBzZWxmLl9yZXF1ZXN0X2lkCiAgICAgICAgYm9keSA9IGpzb24uZHVtcHMoCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgICJqc29ucnBjIjogIjIuMCIsCiAgICAgICAgICAgICAgICAiaWQiOiByZXF1ZXN0X2lkLAogICAgICAgICAgICAgICAgIm1ldGhvZCI6IG1ldGhvZCwKICAgICAgICAgICAgICAgICJwYXJhbXMiOiBwYXJhbXMsCiAgICAgICAgICAgIH0sCiAgICAgICAgICAgIHNlcGFyYXRvcnM9KCIsIiwgIjoiKSwKICAgICAgICApLmVuY29kZSgpCiAgICAgICAgcmVxdWVzdCA9IHVybGxpYi5yZXF1ZXN0LlJlcXVlc3QoCiAgICAgICAgICAgIHNlbGYuZW5kcG9pbnQsCiAgICAgICAgICAgIGRhdGE9Ym9keSwKICAgICAgICAgICAgaGVhZGVycz17CiAgICAgICAgICAgICAgICAiQWNjZXB0IjogImFwcGxpY2F0aW9uL2pzb24sIHRleHQvZXZlbnQtc3RyZWFtIiwKICAgICAgICAgICAgICAgICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIsCiAgICAgICAgICAgICAgICAqKnNlbGYuX2F1dGhfaGVhZGVycygpLAogICAgICAgICAgICB9LAogICAgICAgICAgICBtZXRob2Q9IlBPU1QiLAogICAgICAgICkKICAgICAgICB0cnk6CiAgICAgICAgICAgIHdpdGggdXJsbGliLnJlcXVlc3QudXJsb3BlbigKICAgICAgICAgICAgICAgIHJlcXVlc3QsCiAgICAgICAgICAgICAgICB0aW1lb3V0PTkwLAogICAgICAgICAgICAgICAgY29udGV4dD1zZWxmLl9zc2xfY29udGV4dCgpLAogICAgICAgICAgICApIGFzIHJlc3BvbnNlOgogICAgICAgICAgICAgICAgcmVzcG9uc2VfYm9keSA9IHJlc3BvbnNlLnJlYWQoKS5kZWNvZGUoKQogICAgICAgICAgICAgICAgY29udGVudF90eXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoImNvbnRlbnQtdHlwZSIsICIiKQogICAgICAgIGV4Y2VwdCB1cmxsaWIuZXJyb3IuSFRUUEVycm9yIGFzIGV4YzoKICAgICAgICAgICAgcmFpc2UgSG9zdGVkQXBwc0Vycm9yKAogICAgICAgICAgICAgICAgZiJob3N0ZWQgYXBwcyB7bWV0aG9kfSByZXF1ZXN0IGZhaWxlZCB3aXRoIEhUVFAgc3RhdHVzIHtleGMuY29kZX0iCiAgICAgICAgICAgICkgZnJvbSBleGMKICAgICAgICBleGNlcHQgdXJsbGliLmVycm9yLlVSTEVycm9yIGFzIGV4YzoKICAgICAgICAgICAgcmFpc2UgSG9zdGVkQXBwc0Vycm9yKAogICAgICAgICAgICAgICAgZiJob3N0ZWQgYXBwcyB7bWV0aG9kfSByZXF1ZXN0IGZhaWxlZDoge191cmxfZXJyb3JfY2F0ZWdvcnkoZXhjLnJlYXNvbil9IgogICAgICAgICAgICApIGZyb20gZXhjCiAgICAgICAgcGF5bG9hZCA9IHNlbGYuX2RlY29kZV9yZXNwb25zZShyZXNwb25zZV9ib2R5LCBjb250ZW50X3R5cGUpCiAgICAgICAgaWYgcGF5bG9hZC5nZXQoImVycm9yIikgaXMgbm90IE5vbmU6CiAgICAgICAgICAgIHJhaXNlIEhvc3RlZEFwcHNFcnJvcihmImhvc3RlZCBhcHBzIHttZXRob2R9IFJQQyBmYWlsZWQiKQogICAgICAgIHJldHVybiBfcmVxdWlyZV9vYmplY3QocGF5bG9hZC5nZXQoInJlc3VsdCIpLCAiaG9zdGVkIGFwcHMgUlBDIHJlc3VsdCIpCgogICAgQHN0YXRpY21ldGhvZAogICAgZGVmIF9yZXF1ZXN0X21ldGEodG9vbF9tZXRhOiBkaWN0W3N0ciwgb2JqZWN0XSkgLT4gZGljdFtzdHIsIG9iamVjdF06CiAgICAgICAgcmVxdWVzdF9tZXRhID0gZGljdCh0b29sX21ldGEpCiAgICAgICAgdGhyZWFkX2lkID0gb3MuZW52aXJvbi5nZXQoIkNPREVYX1RIUkVBRF9JRCIsICIiKS5zdHJpcCgpCiAgICAgICAgaWYgdGhyZWFkX2lkOgogICAgICAgICAgICByZXF1ZXN0X21ldGFbInRocmVhZElkIl0gPSB0aHJlYWRfaWQKICAgICAgICBzZXNzaW9uX2lkID0gb3MuZW52aXJvbi5nZXQoIkNPREVYX1NFU1NJT05fSUQiLCAiIikuc3RyaXAoKQogICAgICAgIGlmIHRocmVhZF9pZCBhbmQgc2Vzc2lvbl9pZCBhbmQgc2Vzc2lvbl9pZCAhPSB0aHJlYWRfaWQ6CiAgICAgICAgICAgIGV4aXN0aW5nX3R1cm5fbWV0YWRhdGEgPSByZXF1ZXN0X21ldGEuZ2V0KCJ4LWNvZGV4LXR1cm4tbWV0YWRhdGEiKQogICAgICAgICAgICB0dXJuX21ldGFkYXRhID0gKAogICAgICAgICAgICAgICAgZGljdChleGlzdGluZ190dXJuX21ldGFkYXRhKSBpZiBpc2luc3RhbmNlKGV4aXN0aW5nX3R1cm5fbWV0YWRhdGEsIGRpY3QpIGVsc2Uge30KICAgICAgICAgICAgKQogICAgICAgICAgICB0dXJuX21ldGFkYXRhWyJzZXNzaW9uX2lkIl0gPSBzZXNzaW9uX2lkCiAgICAgICAgICAgIHR1cm5fbWV0YWRhdGFbInRocmVhZF9pZCJdID0gdGhyZWFkX2lkCiAgICAgICAgICAgICMgVGhlIGdhdGV3YXkgcmVhZHMgdGhlIG91dGVyIElEcyBmb3IgcmVxdWVzdCBjb3JyZWxhdGlvbi4gSXQgb25seQogICAgICAgICAgICAjIGZvcndhcmRzIGRlY2xhcmVkIGZpcnN0LXBhcnR5IGFjdGlvbiBtZXRhZGF0YSBmcm9tIG1jcF9yZXF1ZXN0X21ldGEuCiAgICAgICAgICAgIGV4aXN0aW5nX2FjdGlvbl9tZXRhID0gdHVybl9tZXRhZGF0YS5nZXQoIm1jcF9yZXF1ZXN0X21ldGEiKQogICAgICAgICAgICBhY3Rpb25fbWV0YSA9ICgKICAgICAgICAgICAgICAgIGRpY3QoZXhpc3RpbmdfYWN0aW9uX21ldGEpIGlmIGlzaW5zdGFuY2UoZXhpc3RpbmdfYWN0aW9uX21ldGEsIGRpY3QpIGVsc2Uge30KICAgICAgICAgICAgKQogICAgICAgICAgICBhY3Rpb25fbWV0YVsieC1jb2RleC10dXJuLW1ldGFkYXRhIl0gPSB7CiAgICAgICAgICAgICAgICAic2Vzc2lvbl9pZCI6IHNlc3Npb25faWQsCiAgICAgICAgICAgICAgICAidGhyZWFkX2lkIjogdGhyZWFkX2lkLAogICAgICAgICAgICB9CiAgICAgICAgICAgIHR1cm5fbWV0YWRhdGFbIm1jcF9yZXF1ZXN0X21ldGEiXSA9IGFjdGlvbl9tZXRhCiAgICAgICAgICAgIHJlcXVlc3RfbWV0YVsieC1jb2RleC10dXJuLW1ldGFkYXRhIl0gPSB0dXJuX21ldGFkYXRhCiAgICAgICAgcmV0dXJuIHJlcXVlc3RfbWV0YQoKICAgIGRlZiBfYXV0aF9oZWFkZXJzKHNlbGYpIC0+IGRpY3Rbc3RyLCBzdHJdOgogICAgICAgIGFjY291bnRfaWQgPSBvcy5lbnZpcm9uLmdldCgiQ09ERVhfQVBQU19DSEFUR1BUX0FDQ09VTlRfSUQiLCAiIikuc3RyaXAoKSBvciBOb25lCiAgICAgICAgYXV0aG9yaXphdGlvbiA9IG9zLmVudmlyb24uZ2V0KCJDT0RFWF9BUFBTX0FVVEhPUklaQVRJT04iLCAiIikuc3RyaXAoKQogICAgICAgIGlmIGF1dGhvcml6YXRpb246CiAgICAgICAgICAgIHJldHVybiBzZWxmLl93aXRoX2FjY291bnRfaWQoYXV0aG9yaXphdGlvbiwgYWNjb3VudF9pZCkKICAgICAgICBjb25uZWN0b3JfdG9rZW4gPSBvcy5lbnZpcm9uLmdldCgiQ09ERVhfQ09OTkVDVE9SU19UT0tFTiIsICIiKS5zdHJpcCgpCiAgICAgICAgaWYgY29ubmVjdG9yX3Rva2VuOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fd2l0aF9hY2NvdW50X2lkKGYiQmVhcmVyIHtjb25uZWN0b3JfdG9rZW59IiwgYWNjb3VudF9pZCkKICAgICAgICB0b2tlbiwgYXV0aF9hY2NvdW50X2lkID0gc2VsZi5fYXV0aF9maWxlX3Rva2VucygpCiAgICAgICAgcmV0dXJuIHNlbGYuX3dpdGhfYWNjb3VudF9pZCgKICAgICAgICAgICAgZiJCZWFyZXIge3Rva2VufSIsCiAgICAgICAgICAgIGFjY291bnRfaWQgb3IgYXV0aF9hY2NvdW50X2lkLAogICAgICAgICkKCiAgICBAc3RhdGljbWV0aG9kCiAgICBkZWYgX3dpdGhfYWNjb3VudF9pZCgKICAgICAgICBhdXRob3JpemF0aW9uOiBzdHIsCiAgICAgICAgYWNjb3VudF9pZDogc3RyIHwgTm9uZSwKICAgICkgLT4gZGljdFtzdHIsIHN0cl06CiAgICAgICAgaGVhZGVycyA9IHsiQXV0aG9yaXphdGlvbiI6IGF1dGhvcml6YXRpb259CiAgICAgICAgaWYgYWNjb3VudF9pZCBpcyBub3QgTm9uZToKICAgICAgICAgICAgaGVhZGVyc1siQ2hhdEdQVC1BY2NvdW50LUlEIl0gPSBhY2NvdW50X2lkCiAgICAgICAgcmV0dXJuIGhlYWRlcnMKCiAgICBAc3RhdGljbWV0aG9kCiAgICBkZWYgX2F1dGhfZmlsZV90b2tlbnMoKSAtPiB0dXBsZVtzdHIsIHN0ciB8IE5vbmVdOgogICAgICAgIGNvbmZpZ3VyZWRfcGF0aCA9IG9zLmVudmlyb24uZ2V0KCJDT0RFWF9BVVRIX1BBVEgiKQogICAgICAgIGlmIGNvbmZpZ3VyZWRfcGF0aDoKICAgICAgICAgICAgYXV0aF9wYXRoID0gUGF0aChjb25maWd1cmVkX3BhdGgpLmV4cGFuZHVzZXIoKQogICAgICAgIGVsaWYgb3MuZW52aXJvbi5nZXQoIkNPREVYX0hPTUUiKToKICAgICAgICAgICAgYXV0aF9wYXRoID0gUGF0aChvcy5lbnZpcm9uWyJDT0RFWF9IT01FIl0pLmV4cGFuZHVzZXIoKSAvICJhdXRoLmpzb24iCiAgICAgICAgZWxzZToKICAgICAgICAgICAgYXV0aF9wYXRoID0gUGF0aC5ob21lKCkgLyAiLmNvZGV4IiAvICJhdXRoLmpzb24iCiAgICAgICAgdHJ5OgogICAgICAgICAgICBwYXlsb2FkOiBvYmplY3QgPSBqc29uLmxvYWRzKGF1dGhfcGF0aC5yZWFkX3RleHQoZW5jb2Rpbmc9InV0Zi04IikpCiAgICAgICAgICAgIGF1dGggPSBfcmVxdWlyZV9vYmplY3QocGF5bG9hZCwgIkNvZGV4IGF1dGgiKQogICAgICAgICAgICB0b2tlbnMgPSBfcmVxdWlyZV9vYmplY3QoYXV0aC5nZXQoInRva2VucyIpLCAiQ29kZXggYXV0aCB0b2tlbnMiKQogICAgICAgICAgICB0b2tlbiA9IF9yZXF1aXJlX3N0cmluZyh0b2tlbnMuZ2V0KCJhY2Nlc3NfdG9rZW4iKSwgIkNvZGV4IGFjY2VzcyB0b2tlbiIpCiAgICAgICAgICAgIGFjY291bnRfdmFsdWUgPSB0b2tlbnMuZ2V0KCJhY2NvdW50X2lkIikKICAgICAgICAgICAgYWNjb3VudF9pZCA9ICgKICAgICAgICAgICAgICAgIF9yZXF1aXJlX3N0cmluZyhhY2NvdW50X3ZhbHVlLCAiQ29kZXggYWNjb3VudCBpZCIpCiAgICAgICAgICAgICAgICBpZiBhY2NvdW50X3ZhbHVlIGlzIG5vdCBOb25lCiAgICAgICAgICAgICAgICBlbHNlIE5vbmUKICAgICAgICAgICAgKQogICAgICAgIGV4Y2VwdCAoT1NFcnJvciwganNvbi5KU09ORGVjb2RlRXJyb3IsIEhvc3RlZEFwcHNFcnJvcikgYXMgZXhjOgogICAgICAgICAgICByYWlzZSBIb3N0ZWRBcHBzRXJyb3IoZiJjb3VsZCBub3QgcmVhZCBDb2RleCBhdXRoIGZyb20ge2F1dGhfcGF0aH0iKSBmcm9tIGV4YwogICAgICAgIHJldHVybiB0b2tlbiwgYWNjb3VudF9pZAoKICAgIEBzdGF0aWNtZXRob2QKICAgIGRlZiBfc3NsX2NvbnRleHQoKSAtPiBzc2wuU1NMQ29udGV4dDoKICAgICAgICBmb3IgZW52aXJvbm1lbnRfbmFtZSBpbiAoCiAgICAgICAgICAgICJTU0xfQ0VSVF9GSUxFIiwKICAgICAgICAgICAgIlJFUVVFU1RTX0NBX0JVTkRMRSIsCiAgICAgICAgICAgICJDVVJMX0NBX0JVTkRMRSIsCiAgICAgICAgKToKICAgICAgICAgICAgY2FfYnVuZGxlID0gb3MuZW52aXJvbi5nZXQoZW52aXJvbm1lbnRfbmFtZSkKICAgICAgICAgICAgaWYgY2FfYnVuZGxlOgogICAgICAgICAgICAgICAgcmV0dXJuIHNzbC5jcmVhdGVfZGVmYXVsdF9jb250ZXh0KGNhZmlsZT1jYV9idW5kbGUpCiAgICAgICAgZGVmYXVsdF9jYV9idW5kbGUgPSBQYXRoKCIvZXRjL3NzbC9jZXJ0cy9jYS1jZXJ0aWZpY2F0ZXMuY3J0IikKICAgICAgICBpZiBkZWZhdWx0X2NhX2J1bmRsZS5leGlzdHMoKToKICAgICAgICAgICAgcmV0dXJuIHNzbC5jcmVhdGVfZGVmYXVsdF9jb250ZXh0KGNhZmlsZT1kZWZhdWx0X2NhX2J1bmRsZSkKICAgICAgICByZXR1cm4gc3NsLmNyZWF0ZV9kZWZhdWx0X2NvbnRleHQoKQoKICAgIEBjbGFzc21ldGhvZAogICAgZGVmIF9kZWNvZGVfcmVzcG9uc2UoCiAgICAgICAgY2xzLAogICAgICAgIGJvZHk6IHN0ciwKICAgICAgICBjb250ZW50X3R5cGU6IHN0ciwKICAgICkgLT4gZGljdFtzdHIsIG9iamVjdF06CiAgICAgICAgaWYgInRleHQvZXZlbnQtc3RyZWFtIiBub3QgaW4gY29udGVudF90eXBlLmxvd2VyKCk6CiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIHZhbHVlOiBvYmplY3QgPSBqc29uLmxvYWRzKGJvZHkpCiAgICAgICAgICAgIGV4Y2VwdCBqc29uLkpTT05EZWNvZGVFcnJvciBhcyBleGM6CiAgICAgICAgICAgICAgICByYWlzZSBIb3N0ZWRBcHBzRXJyb3IoImhvc3RlZCBhcHBzIHJldHVybmVkIGludmFsaWQgSlNPTiIpIGZyb20gZXhjCiAgICAgICAgICAgIHJldHVybiBfcmVxdWlyZV9vYmplY3QodmFsdWUsICJob3N0ZWQgYXBwcyByZXNwb25zZSIpCgogICAgICAgIGxhc3RfZXZlbnQ6IGRpY3Rbc3RyLCBvYmplY3RdIHwgTm9uZSA9IE5vbmUKICAgICAgICBkYXRhX2xpbmVzOiBsaXN0W3N0cl0gPSBbXQogICAgICAgIGZvciBsaW5lIGluICgqYm9keS5zcGxpdGxpbmVzKCksICIiKToKICAgICAgICAgICAgaWYgbm90IGxpbmU6CiAgICAgICAgICAgICAgICBldmVudCA9IGNscy5fZGVjb2RlX2V2ZW50KGRhdGFfbGluZXMpCiAgICAgICAgICAgICAgICBpZiBldmVudCBpcyBub3QgTm9uZToKICAgICAgICAgICAgICAgICAgICBsYXN0X2V2ZW50ID0gZXZlbnQKICAgICAgICAgICAgICAgIGRhdGFfbGluZXMgPSBbXQogICAgICAgICAgICBlbGlmIGxpbmUuc3RhcnRzd2l0aCgiZGF0YToiKToKICAgICAgICAgICAgICAgIGRhdGFfbGluZXMuYXBwZW5kKGxpbmUucmVtb3ZlcHJlZml4KCJkYXRhOiIpLmxzdHJpcCgpKQogICAgICAgIGlmIGxhc3RfZXZlbnQgaXMgTm9uZToKICAgICAgICAgICAgcmFpc2UgSG9zdGVkQXBwc0Vycm9yKCJob3N0ZWQgYXBwcyByZXR1cm5lZCBhbiBlbXB0eSBldmVudCBzdHJlYW0iKQogICAgICAgIHJldHVybiBsYXN0X2V2ZW50CgogICAgQHN0YXRpY21ldGhvZAogICAgZGVmIF9kZWNvZGVfZXZlbnQoZGF0YV9saW5lczogbGlzdFtzdHJdKSAtPiBkaWN0W3N0ciwgb2JqZWN0XSB8IE5vbmU6CiAgICAgICAgaWYgbm90IGRhdGFfbGluZXM6CiAgICAgICAgICAgIHJldHVybiBOb25lCiAgICAgICAgY2FuZGlkYXRlID0gIlxuIi5qb2luKGRhdGFfbGluZXMpCiAgICAgICAgaWYgY2FuZGlkYXRlLnN0cmlwKCkgPT0gIltET05FXSI6CiAgICAgICAgICAgIHJldHVybiBOb25lCiAgICAgICAgdHJ5OgogICAgICAgICAgICB2YWx1ZTogb2JqZWN0ID0ganNvbi5sb2FkcyhjYW5kaWRhdGUpCiAgICAgICAgZXhjZXB0IGpzb24uSlNPTkRlY29kZUVycm9yOgogICAgICAgICAgICByZXR1cm4gTm9uZQogICAgICAgIHJldHVybiB2YWx1ZSBpZiBpc2luc3RhbmNlKHZhbHVlLCBkaWN0KSBlbHNlIE5vbmUK"
HELPER_BYTES=12576
HELPER_SHA="97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59"

REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
BLOB = "a3eb1376e5be8c44d5c22dfc824d576e8f7b69bb"
TRANSFER_BYTES = 7918177
TRANSFER_SHA = "6eeabdf5d081f45668b77762bedf31abbd7dfbd1b12944e0fc5e602b1d85ff88"
COMPRESSED_BYTES = 5938323
COMPRESSED_SHA = "c79919876395eb9977d414edb6bb78cef63633a5288e5f754b14311ebcc458af"
PAYLOAD_BYTES = 75349253
PAYLOAD_SHA = "25a70cbab50de2f2ef477ae6685b592afc6f4c9c5f9ab293758502315cb3fca0"
SOURCE_BYTES = 56479426
TITLE = "Eighteenmile discharge history and load-volume context"

def checked(body, size, digest, label):
    if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
        raise ValueError(label + " has a different original byte identity")
    return body

def emit(stage, **values):
    print(json.dumps({"stage": stage, **values}, ensure_ascii=False, sort_keys=True), flush=True)

def retain(path, body):
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != body:
            raise ValueError("Different retained bytes occupy " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial-" + str(os.getpid()))
    with temporary.open("xb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != body:
                raise
    finally:
        temporary.unlink(missing_ok=True)

def canonical_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")

def hosted():
    raw=base64.b64decode(HELPER_BASE64,validate=True)
    if len(raw)!=HELPER_BYTES or hashlib.sha256(raw).hexdigest()!=HELPER_SHA:
        raise ValueError("The original official HostedAppsClient differs")
    module=types.ModuleType("original_hosted_apps")
    module.__file__="<unchanged-library-skill/library_hosted_apps.py>"
    sys.modules[module.__name__]=module
    exec(compile(raw,module.__file__,"exec"),module.__dict__)
    return module,module.HostedAppsClient()


def fetch_transfer():
    module, client = hosted()
    action = "github_fetch_blob"
    connector = None
    for _ in range(8):
        cursor, seen = None, set()
        for _ in range(100):
            page = client._rpc("tools/list", {} if cursor is None else {"cursor": cursor})
            if not isinstance(page.get("tools"), list):
                raise ValueError("The current normal tool registry has no tools array")
            for row in page["tools"]:
                if not isinstance(row, dict):
                    continue
                name, meta = row.get("name"), row.get("_meta")
                if not isinstance(name, str) or not isinstance(meta, dict):
                    continue
                if not (name == action or name.endswith("_" + action) or name.endswith("." + action)):
                    continue
                cid = next((meta.get(k) for k in ("connector_id", "connectorId", "app_id", "appId")
                            if isinstance(meta.get(k), str) and meta.get(k)), None)
                properties = row.get("inputSchema", {}).get("properties", {})
                if cid is None or (properties and not {"repository_full_name", "blob_sha"}.issubset(properties)):
                    continue
                client._tools.append(module.HostedAppTool(name=name, meta=meta))
                connector = cid
                break
            if connector:
                break
            cursor = page.get("nextCursor", page.get("next_cursor"))
            if not cursor:
                break
            if not isinstance(cursor, str) or cursor in seen:
                raise ValueError("The normal tool registry repeated its page cursor")
            seen.add(cursor)
        if connector:
            break
    if not connector:
        raise ValueError("The current normal Git blob reader is unavailable; retain this operation for continuation")
    result = client.call_tool(connector, action, {"repository_full_name": REPOSITORY, "blob_sha": BLOB})
    candidates, pending = [], [result]
    for _ in range(64):
        if not pending:
            break
        value = pending.pop()
        if not isinstance(value, dict):
            continue
        if value.get("isError") is True:
            raise ValueError("The connected Git blob reader returned an error")
        structured = value.get("structuredContent")
        if isinstance(structured, dict):
            pending.append(structured)
        content = value.get("content")
        if isinstance(content, str):
            if value.get("encoding") == "base64":
                candidates.append(base64.b64decode(content, validate=False))
            else:
                candidates.append(content.encode("utf-8"))
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    body = item.get("text")
                    if isinstance(body, str):
                        candidates.append(body.encode("utf-8"))
                        try:
                            parsed = json.loads(body)
                        except ValueError:
                            continue
                        if isinstance(parsed, dict):
                            pending.append(parsed)
        for key in ("result", "data"):
            if isinstance(value.get(key), dict):
                pending.append(value[key])
    matches = [raw for raw in candidates
               if len(raw) == TRANSFER_BYTES and hashlib.sha256(raw).hexdigest() == TRANSFER_SHA]
    if not matches:
        raise ValueError("The normal Git response does not contain the complete pinned 212-file transfer")
    return matches[0]

def decode_source(raw):
    checked(raw, TRANSFER_BYTES, TRANSFER_SHA, "Complete source carrier")
    packet = json.loads(raw)
    if packet.get("schema") != "upstate.application-source-part/v1" or (packet.get("part"), packet.get("parts")) != (1, 1):
        raise ValueError("Choose the complete original single-packet source")
    compressed = checked(base64.b64decode(packet["data"], validate=True),
                         COMPRESSED_BYTES, COMPRESSED_SHA, "Original compressed source")
    payload = checked(gzip.decompress(compressed), PAYLOAD_BYTES, PAYLOAD_SHA, "Original source-bank JSON")
    bank = json.loads(payload)
    if bank.get("schema") != "commons.source-bank/v1" or len(bank.get("files", [])) != 212:
        raise ValueError("Original source bank must contain all 212 members")
    members, names, total = [], set(), 0
    for member in bank["files"]:
        name = member["path"]
        path = PurePosixPath(name)
        if (not isinstance(name, str) or not name or "\\" in name or path.is_absolute()
                or ".." in path.parts or str(path) != name or name in names):
            raise ValueError("Original source path is not canonical or is duplicated")
        names.add(name)
        body = checked(base64.b64decode(member["content_base64"], validate=True),
                       member["bytes"], member["sha256"], name)
        members.append((name, body, member["sha256"]))
        total += len(body)
    if total != SOURCE_BYTES or "point_source_scientific.sources.json" not in names:
        raise ValueError("The original source family is incomplete")
    return members

def contained(root, name):
    candidate = root.joinpath(*PurePosixPath(name).parts)
    for parent in (candidate, *candidate.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError("Receiving source contains a symbolic link: " + str(parent))
    if not candidate.resolve().is_relative_to(root):
        raise ValueError("Source member leaves its receiving root")
    return candidate

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Actual current application that already rendered the native report")
    parser.add_argument("--output", required=True, help="One isolated new receiving root outside that application")
    parser.add_argument("--transfer", help="Optional already-received exact 7,918,177-byte ordinary Git source packet")
    parser.add_argument("--source-only", action="store_true", help="Complete original source intake, then print the existing native command")
    args = parser.parse_args()
    app = Path(args.application).resolve(strict=True)
    root_input = Path(args.output).expanduser().absolute()
    if root_input.is_symlink():
        raise ValueError("Select an owned receiving directory, not a symbolic link")
    root = root_input.resolve()
    if root.is_relative_to(app) or app.is_relative_to(root):
        raise ValueError("Keep the entire receiving root and application separate")
    renderer = app / "source" / "observed-report-20261013" / "render.py"
    if not renderer.is_file() or not (app / "model" / "workspace.py").is_file():
        raise ValueError("Select the actual complete application with its maintained observed report renderer")
    emit("ECHO_REPORT_RECEIVING", host=socket.gethostname(), pid=os.getpid(),
         python=sys.executable, application=str(app), output=str(root))
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / "receiving.lock"
    if lock_path.is_symlink():
        raise ValueError("The receiving lock is a symbolic link")
    with lock_path.open("a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("This exact ECHO receiving directory already has a live owner") from None
        selection = {"schema": "upstate.eighteenmile-report-receiving/v1",
                     "application": str(app), "source_blob": BLOB,
                     "source_sha256": TRANSFER_SHA, "source_files": 212,
                     "source_bytes": SOURCE_BYTES, "title": TITLE}
        retain(root / "receiving-selection.json", canonical_json(selection))
        transfer = root / "original-source-transfer.json"
        if transfer.is_file():
            raw = checked(transfer.read_bytes(), TRANSFER_BYTES, TRANSFER_SHA, "Retained carrier")
        elif args.transfer:
            raw = checked(Path(args.transfer).read_bytes(), TRANSFER_BYTES, TRANSFER_SHA, "Selected carrier")
        else:
            raw = fetch_transfer()
        retain(transfer, raw)
        members = decode_source(raw)
        source_root = root / "original-source"
        if source_root.is_symlink():
            raise ValueError("The source root is a symbolic link")
        source_root.mkdir(exist_ok=True)
        # Check every retained destination before adding any absent original body.
        for name, body, digest in members:
            destination = contained(source_root, name)
            if destination.exists() and (not destination.is_file() or destination.read_bytes() != body):
                raise ValueError("Different original source already occupies " + name)
        for name, body, digest in members:
            retain(contained(source_root, name), body)
        source_receipt = {**selection, "source_root": str(source_root),
                          "manifest": str(source_root / "point_source_scientific.sources.json"),
                          "files": [{"path": name, "bytes": len(body), "sha256": digest}
                                    for name, body, digest in members]}
        retain(root / "source-receiving.json", canonical_json(source_receipt))
        del members, raw
        command = [sys.executable, "-B", str(renderer), "--app-root", str(app),
                   "--workspace", str(root / "workspace"), "--create-workspace",
                   "--manifest", source_receipt["manifest"], "--output", str(root / "rendered"),
                   "--title", TITLE, "--archive", str(root / "scientific-report.zip"),
                   "--receive-directory", str(root / "received")]
        emit("ECHO_SOURCE_RECEIVED", files=212, source_bytes=SOURCE_BYTES,
             source_root=str(source_root), manifest=source_receipt["manifest"], command=command)
        if args.source_only:
            return
        stdout_path = root / "native-report.stdout.json"
        stderr_path = root / "native-report.stderr.txt"
        # Original renderer owns result reuse and archive/restore continuation.
        # Each attempt gets its own logs, preserving earlier concrete exceptions.
        attempt = 1
        while (root / ("native-attempt-%04d.stdout.json" % attempt)).exists():
            attempt += 1
        stdout_path = root / ("native-attempt-%04d.stdout.json" % attempt)
        stderr_path = root / ("native-attempt-%04d.stderr.txt" % attempt)
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            process = subprocess.Popen(command, cwd=app, stdout=stdout, stderr=stderr,
                                       pass_fds=(lock.fileno(),))
            emit("ECHO_NATIVE_STARTED", pid=process.pid, command=command,
                 stdout=str(stdout_path), stderr=str(stderr_path))
            code = process.wait()
        if code:
            emit("ECHO_NATIVE_EXCEPTION", returncode=code, stdout=str(stdout_path),
                 stderr=str(stderr_path), detail=stderr_path.read_text(encoding="utf-8", errors="replace")[-12000:])
            raise SystemExit(code)
        result = json.loads(stdout_path.read_text(encoding="utf-8"))
        if result.get("state") != "complete" or not result.get("operation_id"):
            raise ValueError("The original renderer has not returned its completed operation")
        receipt = {**selection, "host": socket.gethostname(), "python": sys.executable,
                   "operation_id": result["operation_id"], "result": result,
                   "stdout": str(stdout_path), "stderr": str(stderr_path),
                   "source_receipt": str(root / "source-receiving.json")}
        final = root / "native-report-receiving.json"
        if final.is_file():
            previous = json.loads(final.read_bytes())
            if (any(previous.get(key) != value for key, value in selection.items())
                    or previous.get("operation_id") != result["operation_id"]):
                raise ValueError("The retained successful report receipt belongs to a different operation")
        else:
            retain(final, canonical_json(receipt))
        emit("ECHO_NATIVE_REPORT_RECEIVED", operation_id=result["operation_id"], state=result["state"],
             receiving=result.get("receiving"), receipt=str(final), output=str(root / "rendered"),
             archive=str(root / "scientific-report.zip"))
        emit("ECHO_PRODUCT_VIEW_REQUIRED", instructions="Open the exact generated PDF and HTML, both retained offline original reports, CSV/source downloads and received application. Look at every page and desktop/390px layout; operate controls and reopen before presenting the completed product.")

if __name__ == "__main__":
    main()
