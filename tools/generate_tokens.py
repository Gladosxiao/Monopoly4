#!/usr/bin/env python3
"""
生成大富翁4 角色棋子 PNG。
使用 macOS Apple Color Emoji 字体将 emoji 渲染为 64x64 透明 PNG，
前端 Canvas 再叠加白色描边，提升不同底色上的辨识度。
"""

import os
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "packages", "frontend", "public", "assets", "tokens")
FONT_PATH = "/System/Library/Fonts/Apple Color Emoji.ttc"
SIZE = 64
FONT_SIZE = 48

# 角色 ID -> emoji 映射（与 shared/src/index.ts CHARACTERS 顺序一致）
CHARACTER_TOKENS = {
    "sun": "🌸",        # 孙小美
    "atu": "🧑‍🌾",      # 阿土伯
    "qian": "💎",       # 钱夫人
    "gongben": "⚔️",    # 宫本宝藏
    "john": "🍔",       # 约翰乔
    "salon": "🧞",      # 沙隆巴斯
    "nin": "🥷",        # 忍太郎
    "sara": "👸",       # 莎拉公主
    "tang": "🍬",       # 糖糖
    "wumi": "🦉",       # 乌咪
    "danny": "🦘",      # 小丹尼
    "beibei": "👶",     # 金贝贝
}


def render_token(emoji: str, out_path: str) -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    except Exception as e:
        raise RuntimeError(f"无法加载字体 {FONT_PATH}: {e}")

    # 计算居中位置（Pillow 10+ 使用 getbbox）
    bbox = draw.textbbox((0, 0), emoji, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) / 2 - bbox[0]
    y = (SIZE - th) / 2 - bbox[1]

    draw.text((x, y), emoji, font=font, embedded_color=True)
    img.save(out_path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for char_id, emoji in CHARACTER_TOKENS.items():
        out_path = os.path.join(OUT_DIR, f"{char_id}.png")
        render_token(emoji, out_path)
        print(f"Generated {out_path}")


if __name__ == "__main__":
    main()
