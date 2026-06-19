#!/usr/bin/env python3
"""Extract JPG keyframes every 0.5s and deduplicate consecutive frames."""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

SIMILARITY_THRESHOLD = 0.95
COMPARE_SIZE = (64, 64)


def has_video_stream(video_path: Path) -> bool:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        str(video_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return "video" in result.stdout.lower()


def frame_similarity(a: Image.Image, b: Image.Image) -> float:
    """Return pixel similarity ratio between two grayscale images."""
    a = a.convert("L").resize(COMPARE_SIZE)
    b = b.convert("L").resize(COMPARE_SIZE)
    pixels_a = list(a.getdata())
    pixels_b = list(b.getdata())
    total = len(pixels_a)
    if total == 0:
        return 1.0
    same = sum(1 for x, y in zip(pixels_a, pixels_b) if abs(x - y) <= 8)
    return same / total


def extract_keyframes(video_path: Path, output_dir: Path, interval: float = 0.5) -> None:
    if not has_video_stream(video_path):
        print(f"[extract_keyframes] No video stream in {video_path}; skipping.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        pattern = tmp_path / "frame_%06d.jpg"
        cmd = [
            "ffmpeg",
            "-y",
            "-i", str(video_path),
            "-vf", f"fps=1/{interval},scale=480:-1",
            "-q:v", "2",
            str(pattern),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        frames = sorted(tmp_path.glob("frame_*.jpg"))
        kept = 0
        last_kept_image: Image.Image | None = None
        for idx, frame_path in enumerate(frames, start=1):
            img = Image.open(frame_path)
            if last_kept_image is not None:
                sim = frame_similarity(img, last_kept_image)
                if sim >= SIMILARITY_THRESHOLD:
                    continue
            dest = output_dir / f"frame_{idx:04d}.jpg"
            img.save(dest, quality=90)
            last_kept_image = img
            kept += 1
        print(f"[extract_keyframes] {video_path.name}: {len(frames)} raw -> {kept} kept in {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract deduplicated keyframes")
    parser.add_argument("video", type=Path, help="Input MP4 file")
    parser.add_argument("output_dir", type=Path, help="Output directory for JPGs")
    parser.add_argument("--interval", type=float, default=0.5, help="Seconds between frames")
    args = parser.parse_args()
    extract_keyframes(args.video, args.output_dir, args.interval)


if __name__ == "__main__":
    main()
