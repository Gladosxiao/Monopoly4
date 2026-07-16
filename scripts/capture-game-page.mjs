// 自动截取游戏页实景截图，用于 UI/UX 视觉审查
// 流程：登录 test/test123 → 创建房间 → 添加 3 个测试机器人 → 准备并开局 → 截图游戏页
//
// 前提：
//   1. 前端 dev server 运行中（localhost:5173）
//   2. 后端 dev 模式运行中（localhost:3000，测试模式开启，含默认 test 账号）
//
// 运行：node scripts/capture-game-page.mjs [输出目录]
// 依赖：puppeteer-core（已 --no-save 安装到 node_modules）

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT_DIR = process.argv[2] || '/tmp/monopoly4-ui-review';
const PAGE_URL = 'http://localhost:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});

async function shot(name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(`saved ${OUT_DIR}/${name}.png`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 登录
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#username', { timeout: 15000 });
  await page.type('#username', 'test');
  await page.type('#password', 'test123');
  await page.click('#btn-login');
  await page.waitForSelector('.lobby-page', { timeout: 15000 });
  await sleep(600);
  await shot('01-lobby');

  // 2. 创建房间
  await page.type('#room-name', `UI审查-${Date.now() % 100000}`);
  await page.click('#btn-create');
  await page.waitForSelector('.room-page', { timeout: 15000 });
  await sleep(800);
  await shot('02-room');

  // 3. 添加 3 个测试机器人（测试模式），自己点准备
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('#btn-add-bot', { timeout: 8000 });
    await page.click('#btn-add-bot');
    await sleep(700);
  }
  await page.click('#btn-ready');
  await sleep(800);
  await shot('03-room-full');

  // 4. 开始游戏
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 10000 });
  await page.click('#btn-start');
  await page.waitForSelector('.game-page', { timeout: 15000 });
  // 等待棋盘渲染与棋子加载
  await sleep(2500);
  await shot('04-game-initial');

  // 5. 若轮到我掷骰，掷一次并等动画结束，再看操作面板/日志/Banner
  const rollBtn = await page.$('#game-actions button');
  if (rollBtn) {
    await rollBtn.click();
    await sleep(1200);
    await shot('05-game-rolling');
    await sleep(4000);
    await shot('06-game-after-roll');
  }
}

try {
  await main();
  console.log('done');
} catch (e) {
  console.error('失败：', e?.message || e);
  try {
    await shot('99-failure');
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}
