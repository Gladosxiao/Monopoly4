// 验证 test-minigames.html 功能完整性
// 通过 puppeteer-core 启动系统 Chrome，模拟点击按钮、点画布、提前结束游戏，
// 验证最近一次成绩高亮和历史记录能正确更新。
//
// 前提：test-minigames.ts 把 launchMiniGame 返回的 stopFn 挂到 window.__stopMiniGame，
// 以便测试期间快速结束游戏（生产环境的 luckyDrop.stop() 不触发 onEnd，需 30s 自然结束）。
//
// 运行：node scripts/verify-minigame-test-page.mjs
// 依赖：puppeteer-core（已 --no-save 安装到 node_modules）

import puppeteer from 'puppeteer-core';

const PAGE_URL = 'http://localhost:5173/test-minigames.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && !text.includes('favicon') && !text.includes('404')) {
    errors.push('console.error: ' + text);
  }
});
page.on('response', (res) => {
  if (res.status() === 404 && !res.url().includes('favicon')) {
    errors.push('404: ' + res.url());
  }
});

await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 10000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 300));

/**
 * 玩一局：点按钮 → 等覆盖层 → 点画布几次 → 调 stopFn → 点"确定" → 返回状态
 */
async function play(gameType) {
  console.log(`\n--- ${gameType} ---`);
  await page.click(`button[data-start="${gameType}"]`);
  await page.waitForSelector('.minigame-overlay', { timeout: 3000 });
  await new Promise((r) => setTimeout(r, 200));

  // 模拟玩家点画布
  const canvas = await page.$('.minigame-overlay canvas');
  const box = await canvas.boundingBox();
  if (box) {
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(
        box.x + box.width * (0.25 + i * 0.2),
        box.y + box.height * (0.35 + i * 0.1)
      );
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // 通过 window.__stopMiniGame 提前结束（test-minigames.ts 暴露的）
  const result = await page.evaluate(async () => {
    const stop = window.__stopMiniGame;
    if (!stop) return { err: 'no stop fn' };
    const r = stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const cb = document.getElementById('minigame-close');
    if (!cb) return { err: 'no close btn', r };
    cb.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      stopResult: r ? { type: r.type, score: r.score, coupons: r.coupons } : null,
      latestHidden: document.getElementById('latest-result').hidden,
      latestScore: document.getElementById('latest-score').textContent,
      statCount: document.getElementById('stat-count').textContent,
      historyRows: document.getElementById('history-body').querySelectorAll('tr').length,
    };
  });
  console.log('  ', JSON.stringify(result));
  return result;
}

const r1 = await play('balloon');
const r2 = await play('penguinDig');

await page.screenshot({
  path: new URL('../doc/minigame-test-screenshot-with-history.png', import.meta.url).pathname,
  fullPage: true,
});

const final = await page.evaluate(() => ({
  historyRows: document.getElementById('history-body').querySelectorAll('tr').length,
  statCount: document.getElementById('stat-count').textContent,
  statCoupons: document.getElementById('stat-coupons').textContent,
  statBest: document.getElementById('stat-best').textContent,
  latestGame: document.getElementById('latest-result').dataset.game,
  ls: localStorage.getItem('monopoly4-minigame-test-history') !== null,
}));
console.log('\n=== Final ===');
console.log(JSON.stringify(final, null, 2));

// 断言
const ok =
  !r1.err && !r2.err &&
  r1.latestHidden === false && r2.latestHidden === false &&
  final.historyRows === 2 &&
  final.statCount === '2' &&
  final.ls === true &&
  final.latestGame === 'penguinDig' &&
  errors.length === 0;

console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'}  errors=${errors.length}`);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
process.exit(ok ? 0 : 1);
