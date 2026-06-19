#!/usr/bin/env python3
"""Process all videos in doc/videos: transcripts, keyframes, danmaku."""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIDEOS_DIR = ROOT / "doc" / "videos"
TRANSCRIPTS_DIR = VIDEOS_DIR / "transcripts"
KEYFRAMES_DIR = VIDEOS_DIR / "keyframes"
DANMAKU_DIR = VIDEOS_DIR / "danmaku_text"
TOOLS_DIR = ROOT / "tools" / "video_processing"
MODEL_DIR = TOOLS_DIR / "models" / "vosk-model-small-cn-0.22"
PYTHON = TOOLS_DIR / "venv" / "bin" / "python"


def safe_name(name: str) -> str:
    # Strip extensions (including .cmt.xml); keep Chinese characters and alphanumerics.
    p = Path(name)
    base = p.stem
    if base.lower().endswith(".cmt"):
        base = base[:-4]
    return "".join(c for c in base if c.isalnum() or "\u4e00" <= c <= "\u9fff" or c in " _-").strip()


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def process_video(mp4: Path) -> None:
    base = safe_name(mp4.name)
    transcript_txt = TRANSCRIPTS_DIR / f"{base}.txt"
    keyframes_out = KEYFRAMES_DIR / base
    wav_path = VIDEOS_DIR / "_temp_audio.wav"

    print(f"\n=== Processing {mp4.name} ===")

    # Transcript
    try:
        try:
            run([str(PYTHON), str(TOOLS_DIR / "extract_audio.py"), str(mp4), str(wav_path)])
            run([str(PYTHON), str(TOOLS_DIR / "transcribe.py"), str(wav_path), str(transcript_txt)])
        except subprocess.CalledProcessError as e:
            if e.returncode == 2:
                transcript_txt.parent.mkdir(parents=True, exist_ok=True)
                transcript_txt.write_text("[无音频流，无法转写]\n", encoding="utf-8")
                print(f"[process_all] No audio stream, empty transcript created: {transcript_txt}")
            else:
                raise
    finally:
        if wav_path.exists():
            wav_path.unlink()

    # Keyframes
    run([str(PYTHON), str(TOOLS_DIR / "extract_keyframes.py"), str(mp4), str(keyframes_out)])


def process_danmaku(xml: Path) -> None:
    base = safe_name(xml.name).replace(".cmt", "")
    output_txt = DANMAKU_DIR / f"{base}.txt"
    run([str(PYTHON), str(TOOLS_DIR / "parse_danmaku.py"), str(xml), str(output_txt)])


def main() -> None:
    if not MODEL_DIR.exists():
        print(f"[process_all] Vosk model missing: {MODEL_DIR}", file=sys.stderr)
        print("Run: cd tools/video_processing && ./venv/bin/python download_model.py", file=sys.stderr)
        sys.exit(1)

    TRANSCRIPTS_DIR.mkdir(exist_ok=True)
    KEYFRAMES_DIR.mkdir(exist_ok=True)
    DANMAKU_DIR.mkdir(exist_ok=True)

    videos = sorted(VIDEOS_DIR.glob("*.mp4"))
    danmakus = sorted(VIDEOS_DIR.glob("*.cmt.xml"))

    if not videos:
        print("No .mp4 files found.")
        return

    for mp4 in videos:
        try:
            process_video(mp4)
        except subprocess.CalledProcessError as e:
            print(f"[process_all] FAILED {mp4.name}: {e}", file=sys.stderr)

    for xml in danmakus:
        try:
            process_danmaku(xml)
        except subprocess.CalledProcessError as e:
            print(f"[process_all] FAILED {xml.name}: {e}", file=sys.stderr)

    print("\n[process_all] Done.")


if __name__ == "__main__":
    main()
