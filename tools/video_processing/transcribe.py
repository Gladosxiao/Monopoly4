#!/usr/bin/env python3
"""Transcribe a 16kHz mono WAV file using Vosk (offline)."""
import argparse
import json
import sys
import wave
from pathlib import Path

from vosk import Model, KaldiRecognizer


def transcribe(wav_path: Path, model_dir: Path, output_txt: Path) -> None:
    if not model_dir.exists():
        print(f"[transcribe] Vosk model not found: {model_dir}", file=sys.stderr)
        sys.exit(1)

    model = Model(str(model_dir))
    wf = wave.open(str(wav_path), "rb")
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
        print(
            f"[transcribe] Audio must be WAV 16kHz mono 16-bit: {wav_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(True)

    results = []
    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            results.append(json.loads(rec.Result()))
    results.append(json.loads(rec.FinalResult()))

    output_txt.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for r in results:
        text = r.get("text", "").strip()
        if text:
            lines.append(text)
    output_txt.write_text("\n".join(lines), encoding="utf-8")
    print(f"[transcribe] {output_txt} ({len(lines)} segments)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe WAV with Vosk")
    parser.add_argument("wav", type=Path, help="Input 16kHz mono WAV")
    parser.add_argument("output", type=Path, help="Output TXT file")
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).with_name("models") / "vosk-model-small-cn-0.22",
        help="Vosk model directory",
    )
    args = parser.parse_args()
    transcribe(args.wav, args.model, args.output)


if __name__ == "__main__":
    main()
