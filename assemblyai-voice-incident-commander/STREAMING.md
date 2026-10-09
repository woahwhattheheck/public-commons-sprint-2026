# Reliable WAV streaming

The existing live command is unchanged:

```sh
python assemblyai_stream.py incident.wav incident.packet.json
```

`ASSEMBLYAI_API_KEY` is read from the environment. Running the live command sends
this audio to AssemblyAI and may consume provider credits; the offline checks
below do neither. Use only authorized recordings. This patch keeps the existing
model and endpoint rather than silently migrating the entrant to another model.

## Audio delivery

The adapter waits for the provider's `Begin` before sending PCM16 mono audio.
Chunks are paced by their actual frame duration using a monotonic clock. It
receives transcript messages during that interval and does not burst to catch
up after a slow send. Each binary or termination send restores the 30-second
socket timeout, independent of the shorter receive window.

A final fragment shorter than 50 ms is merged with the preceding chunk. No audio
is discarded or padded. Files shorter than 50 ms are rejected before connecting;
a file whose declared frame count exceeds its available PCM is rejected as
truncated. Normal 100 ms chunks and a merged tail remain within the documented
50–1000 ms provider range.

## Completion and failures

After the last audio interval, the adapter sends `Terminate` once and requires a
`Termination` response within a total 10-second deadline. Timeout, early close,
early termination, invalid/ambiguous JSON, provider error, or truncated input
raises an error instead of publishing a success-shaped partial packet. An
existing output file stays unchanged. A successful packet is written to a
same-directory temporary file and atomically replaces the requested output.

On a failure before the normal termination attempt, cleanup makes one bounded
best-effort `Terminate` send and closes the socket. It never replays audio or
retries a termination send with an uncertain outcome. Provider error bodies are
not echoed, since they can contain request details. Final-turn admission is
bounded by the reducer's existing event limit. Receipt schema and authority
flags are unchanged; a hash is not independent proof of live execution.

## Focused verification

```sh
python -m unittest discover -s tests -p test_stream_lifecycle.py -v
```

Three fake-clock/socket tests execute the actual adapter and unchanged reducer:
exact-byte paced delivery including a short tail and final response; bounded
failed sessions preserving previous output; and short/truncated WAV rejection.
They do not establish real AssemblyAI acceptance, hosted-demo readiness, a
competition submission, or a prize/payment result. Live end-to-end verification
still requires an authorized operator and provider credentials.

Provider references consulted for the protocol behavior:

- [Streaming audio files](https://www.assemblyai.com/docs/streaming/guides/streaming_transcribe_audio_file)
- [Streaming integration requirements](https://www.assemblyai.com/docs/coding-agent-prompts)

Original entrant, source authorship and any eligible award rights remain intact.
