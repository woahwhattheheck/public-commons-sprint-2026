"""AssemblyAI Streaming v3 adapter for Voice Incident Commander.

Live execution is opt-in and requires ASSEMBLYAI_API_KEY. Offline tests exercise
all message handling without contacting AssemblyAI.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import urllib.parse
import wave

from incident_core import IncidentError, compile_packet, project_final_turn

STREAMING_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws"
DEFAULT_SPEECH_MODEL = "universal-3-5-pro"


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
        obj = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise IncidentError("provider message is invalid JSON") from exc
    if not isinstance(obj, dict):
        raise IncidentError("provider message must be an object")
    kind = obj.get("type")
    if kind in {"Begin", "Termination"}:
        return kind
    projected = project_final_turn(obj)
    if projected is not None:
        admitted.append(obj)
        return "FinalTurn"
    if kind == "Turn":
        return "PartialTurn"
    return "Ignored"


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
        url = build_ws_url(sample_rate)
        admitted: list[dict] = []
        ws = websocket.create_connection(url, header=[f"Authorization: {api_key}"], timeout=30)
        try:
            # 100 ms PCM16 chunks are within AssemblyAI's documented 50-1000ms range.
            frames_per_chunk = max(1, sample_rate // 10)
            while True:
                chunk = wav.readframes(frames_per_chunk)
                if not chunk:
                    break
                ws.send_binary(chunk)
                ws.settimeout(0.01)
                while True:
                    try:
                        handle_server_message(ws.recv(), admitted)
                    except TimeoutError:
                        break
                    except websocket.WebSocketTimeoutException:
                        break
            ws.send(json.dumps({"type": "Terminate"}, separators=(",", ":")))
            ws.settimeout(10)
            while True:
                try:
                    result = handle_server_message(ws.recv(), admitted)
                except websocket.WebSocketTimeoutException:
                    break
                if result == "Termination":
                    break
        finally:
            ws.close()

    packet = compile_packet(admitted)
    output_path.write_text(json.dumps(packet, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream a WAV file to AssemblyAI v3 and produce an incident packet")
    parser.add_argument("wav", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    stream_wav(args.wav, args.output, os.environ.get("ASSEMBLYAI_API_KEY", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
