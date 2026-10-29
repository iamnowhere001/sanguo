/**
 * 渲染基准（P0-0）。
 *
 * 为什么要单独写一个脚本：`perf-check.ts` 跑在 Node 里，只能测纯函数；
 * 而"地图卡不卡"取决于浏览器里的整条链路——输入事件 → React 提交 → canvas 全量重绘。
 * 这里用 CDP 驱动真实的无头 Chrome，跑一段固定负载，量出**端到端帧间隔**。
 *
 * 用法：
 *   node scripts/render-bench.mjs               # 默认：起 dev server + 无头 Chrome
 *   node scripts/render-bench.mjs --shots       # 额外存几张不同缩放级别的截图到 /tmp
 *   node scripts/render-bench.mjs --port 5199   # 复用已经在跑的 dev server
 *
 * 输出：reports/render-bench.csv
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Chrome.app/Contents/MacOS/Google Chrome';

const argv = process.argv.slice(2);
const shots = argv.includes('--shots');
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5199;
const CDP_PORT = 9333;
const BENCH_URL = `http://localhost:${PORT}/bench.html`;

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await reachable(url)) return;
    await delay(200);
  }
  throw new Error(`等待超时：${label} (${url})`);
}

/** 极简 CDP 客户端：够用就好，不引 puppeteer */
class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async connect(wsUrl) {
    const client = new Cdp();
    client.#ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      client.#ws.addEventListener('open', res, { once: true });
      client.#ws.addEventListener('error', rej, { once: true });
    });
    client.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const waiter = client.#pending.get(msg.id);
      if (!waiter) return;
      client.#pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
    return client;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? '页面内异常');
    }
    return res.result.value;
  }

  close() {
    this.#ws.close();
  }
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

async function main() {
  let vite = null;
  const alreadyUp = await reachable(BENCH_URL);
  if (!alreadyUp) {
    console.log('· 启动 dev server…');
    vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    await waitFor(BENCH_URL, 30_000, 'dev server');
  }

  console.log('· 启动无头 Chrome…');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=1280,800',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=/tmp/wb-render-bench-profile`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = () => {
    chrome.kill('SIGTERM');
    vite?.kill('SIGTERM');
  };

  try {
    const started = Date.now();
    let list = [];
    while (Date.now() - started < 20_000) {
      try {
        list = await targets();
        if (list.some((t) => t.type === 'page')) break;
      } catch {
        /* 还没起来 */
      }
      await delay(200);
    }
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('找不到 Chrome 页面目标');

    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: BENCH_URL });

    // 等页面里挂上基准入口
    const readyAt = Date.now();
    while (Date.now() - readyAt < 30_000) {
      const ok = await cdp.evaluate('Boolean(window.__bench)').catch(() => false);
      if (ok) break;
      await delay(250);
    }

    console.log('· 预热并测量…');
    const report = await cdp.evaluate('window.__bench.run()');
    if (!report || !report.phases) throw new Error('基准没有返回结果');

    if (shots) {
      for (const [name, turns] of [
        ['full', -6],
        ['region', 3],
        ['closeup', 6],
      ]) {
        await cdp.evaluate(`(() => {
          const c = document.querySelector('canvas.map-canvas');
          for (let i = 0; i < ${Math.abs(turns)}; i++) {
            c.dispatchEvent(new WheelEvent('wheel', {
              deltaY: ${turns > 0 ? -120 : 120}, clientX: 640, clientY: 400,
              bubbles: true, cancelable: true,
            }));
          }
          return true;
        })()`);
        await delay(700);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = `/tmp/render-bench-${name}.png`;
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log(`  · 截图 ${file}`);
      }
    }

    const rows = [
      'phase,frames,p50_ms,p95_ms,max_ms,mean_ms,dpr,w,h',
      ...report.phases.map((p) =>
        [
          p.name,
          p.frames,
          p.p50,
          p.p95,
          p.max,
          p.mean,
          report.dpr,
          report.size.w,
          report.size.h,
        ].join(','),
      ),
    ];
    const out = resolve(ROOT, 'reports/render-bench.csv');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${rows.join('\n')}\n`);

    console.log('\n阶段                    帧数   P50      P95      max');
    for (const p of report.phases) {
      console.log(
        `${p.name.padEnd(22)} ${String(p.frames).padStart(4)}  ${String(p.p50).padStart(6)}ms ${String(
          p.p95,
        ).padStart(7)}ms ${String(p.max).padStart(7)}ms`,
      );
    }
    console.log(`\nDPR ${report.dpr} · 画布 ${report.size.w}×${report.size.h}`);
    console.log(`· 已写入 ${out}`);

    cdp.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('基准失败：', err.message);
  process.exit(1);
});
