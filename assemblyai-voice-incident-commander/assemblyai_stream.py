"""AssemblyAI Streaming v3 adapter for Voice Incident Commander.

Live execution is opt-in and requires ASSEMBLYAI_API_KEY. Offline tests exercise
all message handling without contacting AssemblyAI.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.parse
import wave

from incident_core import (
    IncidentError, MAX_EVENTS, compile_packet, project_final_turn, strict_json_loads,
)

STREAMING_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws"
DEFAULT_SPEECH_MODEL = "universal-3-5-pro"
SEND_TIMEOUT_SECONDS = 30
TERMINATION_TIMEOUT_SECONDS = 10


def build_ws_url(sample_rate: int, *, speaker_labels: bool = True) -> str:
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, int) or sample_rate <= 0:
        raise IncidentError("sample_rate must be a positive integer")
    params = {
        "speech_model": DEFAULT_SPEECH_MODEL,
        "sample_rate": str(sample_rate),
        "speaker_labels": "true" if speaker_labels else "false",
    }
    return STREAMING_ENDPOINT + "?" + urllib.parse.urlencode(params)


def handle_server_message(raw_text: str, admitted: list[dict]) -> str:
    """Handle one provider JSON message; append only final Turn messages."""
    try:
        obj = strict_json_loads(raw_text)
    except IncidentError:
        raise IncidentError("provider message is invalid JSON") from None
    if not isinstance(obj, dict):
        raise IncidentError("provider message must be an object")
    kind = obj.get("type")
    if kind == "Error" or "error" in obj:
        # Provider text may contain request details; do not echo it into logs.
        raise IncidentError("provider reported a streaming error")
    if not isinstance(kind, str):
        raise IncidentError("provider message type must be a string")
    if kind in {"Begin", "Termination"}:
        return kind
    projected = project_final_turn(obj)
    if projected is not None:
        if len(admitted) >= MAX_EVENTS:
            raise IncidentError("provider final-turn limit exceeded")
        admitted.append(obj)
        return "FinalTurn"
    if kind == "Turn":
        return "PartialTurn"
    return "Ignored"


def pcm_chunks(wav: wave.Wave_read):
    """Emit original PCM bytes in provider-sized chunks, merging a short tail."""
    rate = wav.getframerate()
    minimum_bytes = 2 * ((rate + 19) // 20)  # ceil(50ms), PCM16 mono
    frames_per_chunk = max(1, rate // 10)
    chunk = wav.readframes(frames_per_chunk)
    frames_read = 0
    while chunk:
        following = wav.readframes(frames_per_chunk)
        if following and len(following) < minimum_bytes:
            chunk += following
            following = b""
        if len(chunk) < minimum_bytes or len(chunk) % 2:
            raise IncidentError("WAV must contain complete PCM16 frames and at least 50ms of audio")
        frames_read += len(chunk) // 2
        yield chunk
        chunk = following
    if frames_read != wav.getnframes():
        raise IncidentError("WAV audio is truncated")


def _receive_until(ws, admitted: list[dict], deadline: float, timeout_errors: tuple,
                   *, expected: str | None = None) -> None:
    """Receive while pacing audio, or wait for a required lifecycle message."""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if expected is not None:
                raise IncidentError(f"stream timed out waiting for {expected}; no packet written")
            return
        ws.settimeout(remaining)
        try:
            raw = ws.recv()
        except timeout_errors:
            continue
        if raw == "" or raw == b"":
            raise IncidentError("stream closed before completion; no packet written")
        result = handle_server_message(raw, admitted)
        if result == expected:
            return
        if result == "Termination":
            raise IncidentError("provider terminated before all audio was sent; no packet written")
        if expected == "Begin" and result == "FinalTurn":
            raise IncidentError("provider sent a final turn before Begin")


def _write_packet(output_path: Path, packet: dict) -> None:
    """Replace output only after a complete session and a complete UTF-8 write."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output_path.parent,
            prefix=f".{output_path.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(packet, indent=2, ensure_ascii=False) + "\n")
        os.replace(temporary, output_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def stream_wav(path: Path, output_path: Path, api_key: str) -> None:
    try:
        import websocket  # type: ignore
    except ImportError as exc:
        raise SystemExit("live mode requires: pip install websocket-client") from exc

    if not api_key:
        raise SystemExit("ASSEMBLYAI_API_KEY is required for live mode")

    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise SystemExit("WAV must be mono 16-bit PCM")
        sample_rate = wav.getframerate()
        if wav.getnframes() < (sample_rate + 19) // 20:
            raise IncidentError("WAV must contain at least 50ms of audio")
        url = build_ws_url(sample_rate)
        admitted: list[dict] = []
        timeout_errors = (TimeoutError, websocket.WebSocketTimeoutException)
        ws = websocket.create_connection(
            url, header=[f"Authorization: {api_key}"], timeout=SEND_TIMEOUT_SECONDS,
        )
        terminate_attempted = False
        try:
            _receive_until(ws, admitted, time.monotonic() + SEND_TIMEOUT_SECONDS,
                           timeout_errors, expected="Begin")
            next_send = time.monotonic()
            for chunk in pcm_chunks(wav):
                _receive_until(ws, admitted, next_send, timeout_errors)
                # recv() changes the socket timeout: restore it before every send.
                ws.settimeout(SEND_TIMEOUT_SECONDS)
                ws.send_binary(chunk)
                # No catch-up bursts after a slow send; receive during playback.
                next_send = time.monotonic() + len(chunk) / (2 * sample_rate)
            _receive_until(ws, admitted, next_send, timeout_errors)
            ws.settimeout(SEND_TIMEOUT_SECONDS)
            terminate_attempted = True
            ws.send(json.dumps({"type": "Terminate"}, separators=(",", ":")))
            _receive_until(ws, admitted, time.monotonic() + TERMINATION_TIMEOUT_SECONDS,
                           timeout_errors, expected="Termination")
        finally:
            if not terminate_attempted:
                # Stop provider billing after local validation/receive failures.
                # Do not retry a Terminate send whose outcome is uncertain.
                try:
                    ws.settimeout(1)
                    ws.send(json.dumps({"type": "Terminate"}, separators=(",", ":")))
                except Exception:
                    pass
            ws.close()

    _write_packet(output_path, compile_packet(admitted))


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream a WAV file to AssemblyAI v3 and produce an incident packet")
    parser.add_argument("wav", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        stream_wav(args.wav, args.output, os.environ.get("ASSEMBLYAI_API_KEY", ""))
    except IncidentError as exc:
        parser.exit(1, f"Streaming failed: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
