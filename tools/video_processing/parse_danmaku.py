#!/usr/bin/env python3
"""Parse Bilibili-style .cmt.xml danmaku files into plain text."""
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_danmaku(xml_path: Path, output_txt: Path) -> None:
    tree = ET.parse(str(xml_path))
    root = tree.getroot()
    lines = []
    for elem in root.findall("d"):
        text = (elem.text or "").strip()
        if text:
            lines.append(text)
    output_txt.parent.mkdir(parents=True, exist_ok=True)
    output_txt.write_text("\n".join(lines), encoding="utf-8")
    print(f"[parse_danmaku] {output_txt} ({len(lines)} bullets)")


def default_output(xml_path: Path) -> Path:
    # a.cmt.xml -> a.txt
    base = xml_path.stem
    if base.lower().endswith(".cmt"):
        base = base[:-4]
    return xml_path.with_name(base + ".txt")


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse .cmt.xml danmaku to text")
    parser.add_argument("xml", type=Path, help="Input cmt.xml file")
    parser.add_argument("output", type=Path, nargs="?", help="Output TXT file")
    args = parser.parse_args()
    output = args.output or default_output(args.xml)
    parse_danmaku(args.xml, output)


if __name__ == "__main__":
    main()
