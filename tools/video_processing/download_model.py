#!/usr/bin/env python3
"""Download the Vosk small Chinese model if not already present."""
import zipfile
from pathlib import Path

import requests

MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"
MODEL_DIR = Path(__file__).with_name("models")
ZIP_PATH = MODEL_DIR / "vosk-model-small-cn-0.22.zip"
EXTRACTED_DIR = MODEL_DIR / "vosk-model-small-cn-0.22"


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if EXTRACTED_DIR.exists():
        print(f"[download_model] Model already exists: {EXTRACTED_DIR}")
        return

    print(f"[download_model] Downloading {MODEL_URL} ...")
    with requests.get(MODEL_URL, stream=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(ZIP_PATH, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded / total * 100
                        print(f"\r[download_model] {pct:.1f}%", end="")
    print()

    print(f"[download_model] Extracting {ZIP_PATH} ...")
    with zipfile.ZipFile(ZIP_PATH, "r") as z:
        z.extractall(MODEL_DIR)
    ZIP_PATH.unlink()
    print(f"[download_model] Done: {EXTRACTED_DIR}")


if __name__ == "__main__":
    main()
