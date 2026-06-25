#!/usr/bin/env node
/**
 * 测试 LLM API Key 是否有效。
 * 同时支持 OpenAI-compatible（Moonshot）和 Anthropic-compatible（Kimi Code）协议。
 *
 * 用法：
 *   node tools/test_kimi_key.mjs
 *
 * 或指定其他 env 文件：
 *   PLAYTEST_ENV=/path/to/.playtest.env node tools/test_kimi_key.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPlaytestEnv() {
  let envPath = process.env.PLAYTEST_ENV;
  if (!envPath) {
    const repoRoot = path.resolve(__dirname, '..');
    envPath = path.join(repoRoot, 'packages', 'backend', '.playtest.env');
  }

  if (!fs.existsSync(envPath)) {
    console.error(`❌ 找不到配置文件: ${envPath}`);
    console.error('请先复制 packages/backend/.playtest.env.example 为 .playtest.env 并填入 API Key');
    process.exit(1);
  }

  const env = {};
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function detectProtocol(baseUrl) {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('kimi.com') || lower.includes('anthropic')) return 'anthropic';
  return 'openai';
}

async function testOpenai(baseUrl, apiKey, model) {
  console.log('协议: OpenAI-compatible');

  // 测试 1: 获取模型列表
  console.log('测试 1/2: 获取模型列表...');
  const modelsRes = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const modelsData = await modelsRes.json();
  if (!modelsRes.ok) {
    throw new Error(`/models 失败: ${modelsRes.status} ${JSON.stringify(modelsData)}`);
  }
  const modelIds = modelsData.data?.map((m) => m.id) || [];
  console.log(`✅ /models 成功，可用模型数: ${modelIds.length}`);
  if (modelIds.includes(model)) {
    console.log(`✅ 目标模型 '${model}' 在可用列表中`);
  } else {
    console.log(`⚠️ 目标模型 '${model}' 不在可用列表中，可用模型: ${modelIds.slice(0, 5).join(', ')}...`);
  }

  // 测试 2: 调用 chat.completions
  console.log('\n测试 2/2: 调用 chat.completions...');
  const chatRes = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是大富翁4玩家' },
        { role: 'user', content: '1+1等于多少？只回答数字' },
      ],
      max_completion_tokens: 50,
    }),
  });
  const chatData = await chatRes.json();
  if (!chatRes.ok) {
    throw new Error(`chat.completions 失败: ${chatRes.status} ${JSON.stringify(chatData)}`);
  }
  const content = chatData.choices?.[0]?.message?.content;
  console.log('✅ chat.completions 成功');
  console.log(`回复: ${content}`);
}

async function testAnthropic(baseUrl, apiKey, model) {
  console.log('协议: Anthropic-compatible（Kimi Code）');

  // Anthropic 协议没有 /models 列表可用，直接测 /v1/messages
  console.log('测试: 调用 /v1/messages...');
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      system: '你是大富翁4玩家',
      messages: [{ role: 'user', content: '1+1等于多少？只回答数字' }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`/v1/messages 失败: ${res.status} ${JSON.stringify(data)}`);
  }
  const textBlock = data.content?.find((c) => c.type === 'text' || typeof c.text === 'string');
  const content = textBlock?.text;
  console.log('✅ /v1/messages 成功');
  console.log(`回复: ${content}`);
}

async function testKey() {
  const env = loadPlaytestEnv();
  const apiKey = env.PLAYTEST_LLM_API_KEY || '';
  const baseUrl = (env.PLAYTEST_LLM_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/$/, '');
  const model = env.PLAYTEST_LLM_MODEL || 'moonshot-v1-8k';

  if (!apiKey) {
    console.error('❌ PLAYTEST_LLM_API_KEY 为空');
    process.exit(1);
  }

  const protocol = detectProtocol(baseUrl);

  console.log(`base_url: ${baseUrl}`);
  console.log(`model: ${model}`);
  console.log(`key_prefix: ${apiKey.slice(0, 20)}...`);
  console.log(`key_length: ${apiKey.length}`);
  console.log('-'.repeat(40));

  try {
    if (protocol === 'anthropic') {
      await testAnthropic(baseUrl, apiKey, model);
    } else {
      await testOpenai(baseUrl, apiKey, model);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  console.log('\n✅ API Key 有效，可以开始 LLM playtest');
}

await testKey();
