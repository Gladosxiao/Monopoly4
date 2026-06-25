#!/usr/bin/env python3
"""
测试 KIMI (Moonshot) API Key 是否有效。

用法：
    cd packages/backend
    cp .playtest.env.example .playtest.env
    # 编辑 .playtest.env 填入真实 key

    # 方式 1：直接运行（读取 packages/backend/.playtest.env）
    python3 ../../tools/test_kimi_key.py

    # 方式 2：指定 env 文件路径
    PLAYTEST_ENV=/path/to/.playtest.env python3 ../../tools/test_kimi_key.py

需要安装 openai 包：
    pip install openai
"""

import os
import sys
from pathlib import Path


def load_playtest_env():
    """读取 .playtest.env 文件。"""
    env_path = os.environ.get("PLAYTEST_ENV")
    if not env_path:
        # 默认读取 packages/backend/.playtest.env
        script_dir = Path(__file__).resolve().parent
        repo_root = script_dir.parent
        env_path = repo_root / "packages" / "backend" / ".playtest.env"

    env_path = Path(env_path)
    if not env_path.exists():
        print(f"❌ 找不到配置文件: {env_path}")
        print("请先复制 .playtest.env.example 为 .playtest.env 并填入 KIMI API Key")
        sys.exit(1)

    env = {}
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def test_key():
    try:
        from openai import OpenAI
    except ImportError:
        print("❌ 未安装 openai 包，请先运行: pip install openai")
        sys.exit(1)

    env = load_playtest_env()
    api_key = env.get("PLAYTEST_LLM_API_KEY", "")
    base_url = env.get("PLAYTEST_LLM_BASE_URL", "https://api.moonshot.cn/v1")
    model = env.get("PLAYTEST_LLM_MODEL", "moonshot-v1-8k")

    if not api_key:
        print("❌ PLAYTEST_LLM_API_KEY 为空")
        sys.exit(1)

    print(f"base_url: {base_url}")
    print(f"model: {model}")
    print(f"key_prefix: {api_key[:20]}...")
    print(f"key_length: {len(api_key)}")
    print("-" * 40)

    client = OpenAI(api_key=api_key, base_url=base_url)

    try:
        # 先测试 /models 列表
        print("测试 1/2: 获取模型列表...")
        models = client.models.list()
        model_ids = [m.id for m in models.data]
        print(f"✅ /models 成功，可用模型数: {len(model_ids)}")
        if model in model_ids:
            print(f"✅ 目标模型 '{model}' 在可用列表中")
        else:
            print(f"⚠️ 目标模型 '{model}' 不在可用列表中，可用模型: {model_ids[:5]}...")
    except Exception as e:
        print(f"❌ /models 失败: {e}")
        sys.exit(1)

    try:
        # 再测试 chat.completions
        print("\n测试 2/2: 调用 chat.completions...")
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是大富翁4玩家"},
                {"role": "user", "content": "1+1等于多少？只回答数字"},
            ],
            max_completion_tokens=50,
        )
        content = completion.choices[0].message.content
        print(f"✅ chat.completions 成功")
        print(f"回复: {content}")
    except Exception as e:
        print(f"❌ chat.completions 失败: {e}")
        sys.exit(1)

    print("\n✅ API Key 有效，可以开始 LLM playtest")


if __name__ == "__main__":
    test_key()
