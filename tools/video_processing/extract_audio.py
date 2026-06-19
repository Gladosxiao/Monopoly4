#!/usr/bin/env python3
"""Extract 16kHz mono WAV audio from a video file using ffmpeg."""
import argparse
import subprocess
import sys
from pathlib import Path


def has_audio_stream(video_path: Path) -> bool:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        str(video_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return "audio" in result.stdout.lower()


def extract_audio(video_path: Path, output_wav: Path) -> None:
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(output_wav),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"[extract_audio] {output_wav}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract 16kHz mono WAV from video")
    parser.add_argument("video", type=Path, help="Input MP4 file")
    parser.add_argument("output", type=Path, help="Output WAV file")
    args = parser.parse_args()
    if not has_audio_stream(args.video):
        print(f"[extract_audio] No audio stream in {args.video}; skipping.")
        sys.exit(2)
    extract_audio(args.video, args.output)


if __name__ == "__main__":
    main()
