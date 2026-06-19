# 视频处理工具

用于将 `doc/videos/` 中的大富翁4介绍视频转换为设计输入：语音转文字、关键帧去重提取、弹幕解析。

## 环境准备

```bash
cd tools/video_processing
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install vosk pillow
./venv/bin/python download_model.py   # 下载 Vosk 中文小模型
```

需要系统安装 `ffmpeg`：

```bash
brew install ffmpeg
```

## 目录说明

- `extract_audio.py`：从视频提取 16kHz 单声道 WAV。
- `transcribe.py`：使用 Vosk 对 WAV 离线转写为 TXT。
- `extract_keyframes.py`：每 0.5s 提取一帧，连续两帧相似度 ≥95% 时只保留一张。
- `parse_danmaku.py`：解析 Bilibili 风格的 `.cmt.xml` 弹幕文件。
- `download_model.py`：下载 Vosk 中文小模型到 `models/`。
- `process_all.py`：批量处理 `doc/videos/` 下所有视频与弹幕。

## 批量处理

```bash
cd tools/video_processing
./venv/bin/python process_all.py
```

输出位置：

- 转文字：`doc/videos/transcripts/<视频名>.txt`
- 关键帧：`doc/videos/keyframes/<视频名>/frame_0001.jpg ...`
- 弹幕文本：`doc/videos/danmaku_text/<视频名>.txt`
