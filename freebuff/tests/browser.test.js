'use strict';

/*
 * Element Lab browser test.
 *
 * Drives the real index.html in headless Chrome through the DevTools Protocol
 * (no npm dependencies). Verifies the UI wiring, painting, pause/resume, clear,
 * fire behavior and a narrow-screen layout. Screenshots are written to
 * tests/artifacts/ for visual inspection.
 *
 * Run with:  node tests/browser.test.js
 * If Chrome is not found, set CHROME_PATH to the executable.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const ARTIFACT_DIR = path.join(__dirname, 'artifacts');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Tiny assertion helpers ----------

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message + ' (expected ' + b + ', got ' + a + ')');
}

// ---------- Chrome / DevTools plumbing ----------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (error) {
      /* keep looking */
    }
  }
  return null;
}

async function waitFor(check, timeout, label) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(60);
  }
  throw new Error(
    'Timed out after ' + timeout + 'ms waiting for ' + label +
    (lastError ? ' — ' + lastError.message : '')
  );
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];

    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          entry.reject(new Error('DevTools error: ' + message.error.message));
        } else {
          entry.resolve(message.result);
        }
      } else if (message.method) {
        this.events.push(message);
      }
    });

    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('DevTools command timed out: ' + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

async function launchChrome() {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error('Chrome not found. Set CHROME_PATH to a Chrome executable to run the browser test.');
  }

  const port = 9400 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'element-lab-chrome-'));
  const proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--remote-allow-origins=*',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=1280,860',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  proc.on('error', () => {});
  proc.stderr.on('data', () => {});

  const version = await waitFor(async () => {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/version');
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  }, 15000, 'Chrome DevTools to start');

  return { proc, port, profile, version };
}

async function connectToChrome(port) {
  const target = await waitFor(async () => {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl) || null;
    } catch (error) {
      return null;
    }
  }, 10000, 'a Chrome page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Could not open the DevTools websocket')));
  });
  return new Cdp(ws);
}

function killChrome(proc) {
  if (!proc) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (error) {
      /* the process may already be gone */
    }
  } else {
    try {
      proc.kill('SIGKILL');
    } catch (error) {
      /* ignore */
    }
  }
}

// ---------- Page helpers ----------

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error('Page exception: ' + (description || result.exceptionDetails.text));
  }
  return result.result.value;
}

async function getRect(cdp, selector) {
  return evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
}

async function clickSelector(cdp, selector) {
  const rect = await getRect(cdp, selector);
  if (!rect) throw new Error('Cannot click missing element: ' + selector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.cx, y: rect.cy, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.cx, y: rect.cy, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.cx, y: rect.cy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(90);
}

async function paintOnCanvas(cdp, fx, fy) {
  const rect = await getRect(cdp, '#lab');
  const x = rect.x + rect.width * fx;
  const y = rect.y + rect.height * fy;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: x + rect.width * 0.12,
    y: y + rect.height * 0.03,
    button: 'left',
    buttons: 1
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x + rect.width * 0.12,
    y: y + rect.height * 0.03,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(100);
}

async function pressKey(cdp, key) {
  const special = {
    Tab: { code: 'Tab', vk: 9 },
    Enter: { code: 'Enter', vk: 13, text: '\r' },
    ' ': { code: 'Space', vk: 32, text: ' ' }
  };
  const meta = special[key] || { code: 'Digit' + key, vk: key.charCodeAt(0), text: key };
  const base = { key, code: meta.code, windowsVirtualKeyCode: meta.vk, nativeVirtualKeyCode: meta.vk };
  const hasText = typeof meta.text === 'string';
  const down = Object.assign({ type: hasText ? 'keyDown' : 'rawKeyDown' }, base);
  if (hasText) {
    down.text = meta.text;
    down.unmodifiedText = meta.text;
  }
  await cdp.send('Input.dispatchKeyEvent', down);
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(90);
}

async function screenshot(cdp, name) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, name), Buffer.from(shot.data, 'base64'));
}

// ---------- Test run ----------

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('This browser test needs Node 22+ (built-in WebSocket).');
  }

  const chrome = await launchChrome();
  let cdp = null;
  let failures = 0;
  const results = [];

  const step = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log('  ok   ' + name);
    } catch (error) {
      failures++;
      results.push({ name, ok: false, error });
      console.log('  FAIL ' + name);
      console.log('       ' + (error && error.message ? error.message : error));
    }
  };

  try {
    cdp = await connectToChrome(chrome.port);
    console.log('Element Lab — browser test');
    console.log('Chrome: ' + (chrome.version.Browser || chrome.version.browser || 'unknown'));
    console.log('Page:   ' + APP_URL + '\n');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.bringToFront');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(async () => {
      return evaluate(cdp, 'document.readyState === "complete" && !!window.ElementLab && ElementLab.debug().width > 20');
    }, 15000, 'Element Lab to initialize');

    await sleep(350);
    await screenshot(cdp, 'desktop.png');

    await step('initializes the simulation, demo scene and six labeled tools', async () => {
      const info = await evaluate(cdp, `(() => {
        const dbg = ElementLab.debug();
        const canvas = document.getElementById('lab').getBoundingClientRect();
        return {
          dbg,
          title: document.title,
          labels: Array.from(document.querySelectorAll('.tool .tool-name')).map((el) => el.textContent.trim()),
          pressed: Array.from(document.querySelectorAll('.tool[aria-pressed="true"] .tool-name')).map((el) => el.textContent.trim()),
          status: document.getElementById('statusText').textContent,
          pauseLabel: document.getElementById('pauseBtn').textContent.trim(),
          hintVisible: !document.getElementById('hint').classList.contains('is-hidden'),
          canvas: { width: canvas.width, height: canvas.height },
          overflow: getComputedStyle(document.body).overflowY,
          touchAction: getComputedStyle(document.getElementById('lab')).touchAction
        };
      })()`);

      assert(info.title.indexOf('Element Lab') !== -1, 'document title names the app');
      assertDeepEqual(info.labels, ['Sand', 'Water', 'Wall', 'Fire', 'Plant', 'Eraser'], 'tool labels');
      assertDeepEqual(info.pressed, ['Sand'], 'Sand starts selected');
      assertEqual(info.status, 'Running', 'initial simulation status');
      assertEqual(info.pauseLabel, 'Pause', 'initial pause button label');
      assert(info.hintVisible, 'paint hint is visible on load');
      assert(info.canvas.width >= 300 && info.canvas.height >= 220, 'canvas has a usable size');
      assertEqual(info.dbg.paused, false, 'simulation starts running');
      assertEqual(info.dbg.tool, 1, 'sand is the default tool');
      assert(info.dbg.counts.sand > 0, 'demo scene contains sand');
      assert(info.dbg.counts.water > 0, 'demo scene contains water');
      assert(info.dbg.counts.wall > 0, 'demo scene contains walls');
      assert(info.dbg.counts.plant > 0, 'demo scene contains plants');
      assertEqual(info.overflow, 'hidden', 'page scrolling is locked on desktop');
      assertEqual(info.touchAction, 'none', 'canvas disables touch scrolling');
    });

    await step('selects every material from its visible button', async () => {
      const tools = [
        [1, 'Sand'],
        [2, 'Water'],
        [3, 'Wall'],
        [4, 'Fire'],
        [5, 'Plant'],
        [0, 'Eraser']
      ];
      for (const [material, name] of tools) {
        await clickSelector(cdp, '.tool[data-material="' + material + '"]');
        const state = await evaluate(cdp, `(() => {
          const pressed = document.querySelectorAll('.tool[aria-pressed="true"]');
          const selected = pressed[0];
          return {
            tool: ElementLab.debug().tool,
            name: selected ? selected.querySelector('.tool-name').textContent.trim() : null,
            pressedCount: pressed.length
          };
        })()`);
        assertEqual(state.tool, material, name + ' tool is active');
        assertEqual(state.name, name, name + ' button is marked pressed');
        assertEqual(state.pressedCount, 1, 'exactly one tool is selected');
      }
      await clickSelector(cdp, '.tool[data-material="1"]');
    });

    await step('adjusts brush size from the slider', async () => {
      const rect = await getRect(cdp, '#brush');
      const x = rect.x + rect.width * 0.8;
      const y = rect.y + rect.height / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(120);

      const state = await evaluate(cdp, `(() => ({
        brush: ElementLab.debug().brush,
        output: document.getElementById('brushValue').textContent.trim(),
        value: document.getElementById('brush').value
      }))()`);
      assert(state.brush >= 16, 'clicking near the end raises the brush size (got ' + state.brush + ')');
      assertEqual(state.output, String(state.brush), 'brush readout matches the simulation brush');
      assertEqual(state.value, String(state.brush), 'slider value matches the simulation brush');
      await evaluate(cdp, 'ElementLab.setBrush(7)');
    });

    await step('supports keyboard focus, activation, pause and number shortcuts', async () => {
      // Clicking gives the Sand button focus; Tab should move focus forward.
      await clickSelector(cdp, '.tool[data-material="1"]');
      await pressKey(cdp, 'Tab');
      const focused = await evaluate(cdp, `(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return {
          className: String(el.className),
          name: el.querySelector ? (el.querySelector('.tool-name') || {}).textContent : null,
          outlineWidth: parseFloat(style.outlineWidth),
          outlineStyle: style.outlineStyle
        };
      })()`);
      assert(focused.className.indexOf('tool') !== -1, 'Tab focuses a tool button');
      assertEqual(focused.name, 'Water', 'Tab moves to the next tool button');
      assert(focused.outlineWidth >= 2 && focused.outlineStyle !== 'none', 'focused button shows a visible focus ring');

      await pressKey(cdp, 'Enter');
      const activated = await evaluate(cdp, `(() => ({
        tool: ElementLab.debug().tool,
        name: document.querySelector('.tool[aria-pressed="true"] .tool-name').textContent.trim(),
        pressedCount: document.querySelectorAll('.tool[aria-pressed="true"]').length
      }))()`);
      assertEqual(activated.tool, 2, 'Enter activates the focused Water button');
      assertEqual(activated.name, 'Water', 'Water is visibly selected');
      assertEqual(activated.pressedCount, 1, 'only one tool stays selected');

      await evaluate(cdp, 'document.getElementById("lab").focus()');
      await pressKey(cdp, ' ');
      assertEqual(await evaluate(cdp, 'ElementLab.debug().paused'), true, 'Space pauses while the canvas is focused');
      await pressKey(cdp, ' ');
      assertEqual(await evaluate(cdp, 'ElementLab.debug().paused'), false, 'Space resumes again');
      await pressKey(cdp, '3');
      assertEqual(await evaluate(cdp, 'ElementLab.debug().tool'), 3, 'number key 3 selects wall');
      await clickSelector(cdp, '.tool[data-material="1"]');
    });

    await step('clear empties the whole simulation', async () => {
      await clickSelector(cdp, '#clearBtn');
      const counts = await evaluate(cdp, 'ElementLab.debug().counts');
      const active = counts.sand + counts.water + counts.wall + counts.fire + counts.plant;
      assertEqual(active, 0, 'no material remains after Clear');
      assertEqual(await evaluate(cdp, 'ElementLab.debug().counts.plant'), 0, 'plants are cleared');
    });

    await step('paints sand with a mouse drag and lets it settle', async () => {
      await clickSelector(cdp, '.tool[data-material="1"]');
      await paintOnCanvas(cdp, 0.45, 0.2);
      const afterPaint = await evaluate(cdp, 'ElementLab.debug().counts');
      assert(afterPaint.sand > 10, 'dragging adds a brush of sand');

      await sleep(2600);
      const settle = await evaluate(cdp, `(() => {
        const sim = ElementLab.sim;
        let lowest = -1;
        let unsupported = 0;
        for (let y = 0; y < sim.height; y++) {
          for (let x = 0; x < sim.width; x++) {
            if (sim.cells[y * sim.width + x] !== 1) continue;
            lowest = Math.max(lowest, y);
            if (y + 1 < sim.height && sim.cells[(y + 1) * sim.width + x] === 0) unsupported++;
          }
        }
        return { lowest, unsupported, height: sim.height, sand: sim.count(1) };
      })()`);
      assert(settle.sand > 10, 'sand mass is preserved while falling');
      assert(settle.lowest >= settle.height - 2, 'sand falls to the bottom rows');
      assertEqual(settle.unsupported, 0, 'no sand is left floating above empty space');
    });

    await step('pauses, freezes the grid, resumes and keeps painting usable', async () => {
      await clickSelector(cdp, '#pauseBtn');
      const paused = await evaluate(cdp, `(() => ({
        dbg: ElementLab.debug(),
        status: document.getElementById('statusText').textContent,
        label: document.getElementById('pauseBtn').textContent.trim(),
        pressed: document.getElementById('pauseBtn').getAttribute('aria-pressed')
      }))()`);
      assertEqual(paused.dbg.paused, true, 'pause flag is set');
      assertEqual(paused.status, 'Paused', 'status reads Paused');
      assertEqual(paused.label, 'Resume', 'button invites resume');
      assertEqual(paused.pressed, 'true', 'pause button exposes its pressed state');

      await paintOnCanvas(cdp, 0.6, 0.14);
      const frozenHash = await evaluate(cdp, 'ElementLab.debug().hash');
      await sleep(700);
      assertEqual(await evaluate(cdp, 'ElementLab.debug().hash'), frozenHash, 'grid is frozen while paused');

      await clickSelector(cdp, '#pauseBtn');
      const resumed = await evaluate(cdp, `(() => ({
        paused: ElementLab.debug().paused,
        status: document.getElementById('statusText').textContent,
        label: document.getElementById('pauseBtn').textContent.trim()
      }))()`);
      assertEqual(resumed.paused, false, 'pause flag is cleared');
      assertEqual(resumed.status, 'Running', 'status reads Running again');
      assertEqual(resumed.label, 'Pause', 'button offers pause again');

      await sleep(900);
      assert(await evaluate(cdp, 'ElementLab.debug().hash') !== frozenHash, 'simulation advances after resume');
    });

    await step('fire spreads into a touching plant and then burns out', async () => {
      await clickSelector(cdp, '#clearBtn');
      const setup = await evaluate(cdp, `(() => {
        const sim = ElementLab.sim;
        const cx = Math.floor(sim.width / 2);
        const cy = Math.floor(sim.height / 2);
        sim.paint(cx, cy + 3, 5, 8);
        sim.set(cx, cy - 2, 4);
        return { plant: sim.count(5), fire: sim.count(4) };
      })()`);
      assert(setup.plant > 10, 'plant brush was placed');
      assertEqual(setup.fire, 1, 'a single spark was placed');

      const ignited = await waitFor(async () => {
        const counts = await evaluate(cdp, 'ElementLab.debug().counts');
        return counts.plant < setup.plant && counts.fire > 1 ? counts : null;
      }, 4000, 'fire to ignite the adjacent plant');
      assert(ignited.plant < setup.plant, 'plant count drops after ignition');

      const burnedOut = await waitFor(async () => {
        const counts = await evaluate(cdp, 'ElementLab.debug().counts');
        return counts.fire === 0 && counts.plant === 0 ? counts : null;
      }, 12000, 'fire and burnt plant to disappear');
      assertEqual(burnedOut.fire, 0, 'no fire remains');
      assertEqual(burnedOut.plant, 0, 'all touched plant material is gone');
    });

    await step('resizes to a narrow screen without losing controls', async () => {
      await clickSelector(cdp, '#clearBtn');
      const oldWidth = await evaluate(cdp, 'ElementLab.debug().width');

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await sleep(800);

      const layout = await evaluate(cdp, `(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        return {
          vw,
          vh,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          canvas: rect(document.getElementById('lab')),
          tools: Array.from(document.querySelectorAll('.tool')).map(rect),
          actions: Array.from(document.querySelectorAll('.actions .btn')).map(rect),
          slider: rect(document.getElementById('brush')),
          width: ElementLab.debug().width,
          height: ElementLab.debug().height,
          visibleToolLabels: Array.from(document.querySelectorAll('.tool')).filter((el) => el.offsetParent !== null).length
        };
      })()`);

      assertEqual(layout.visibleToolLabels, 6, 'all six tools remain visible');
      assert(layout.scrollWidth <= layout.vw + 1, 'no horizontal overflow at 390px (scrollWidth ' + layout.scrollWidth + ')');
      assert(layout.scrollHeight <= layout.vh + 1, 'page fits the 390x844 viewport without scrolling (scrollHeight ' + layout.scrollHeight + ')');
      assert(layout.canvas.width >= 320, 'canvas keeps a usable width');
      assert(layout.canvas.height >= 200, 'canvas keeps a usable height');
      assert(layout.width !== oldWidth, 'grid dimensions adapt to the new size');
      assert(layout.slider.width >= 150 && layout.slider.height >= 20, 'brush slider is still usable');

      const controls = layout.tools.concat(layout.actions);
      for (const control of controls) {
        assert(control.left >= -1 && control.right <= layout.vw + 1, 'control stays inside the viewport horizontally');
        assert(control.top >= -1 && control.bottom <= layout.vh + 1, 'control is reachable without scrolling');
      }
    });

    await step('paints with touch and does not scroll the page', async () => {
      await clickSelector(cdp, '#clearBtn');
      await clickSelector(cdp, '.tool[data-material="2"]');
      assertEqual(await evaluate(cdp, 'ElementLab.debug().tool'), 2, 'water tool is active at narrow width');

      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
      const rect = await getRect(cdp, '#lab');
      const startX = rect.x + rect.width * 0.35;
      const startY = rect.y + rect.height * 0.3;
      const beforeWater = await evaluate(cdp, 'ElementLab.sim.count(2)');
      const beforeScroll = await evaluate(cdp, 'window.scrollY');

      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: startX, y: startY, id: 1, radiusX: 2, radiusY: 2, force: 1 }]
      });
      await sleep(70);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX + 45, y: startY + 12, id: 1, radiusX: 2, radiusY: 2, force: 1 }]
      });
      await sleep(70);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);

      const afterWater = await evaluate(cdp, 'ElementLab.sim.count(2)');
      const afterScroll = await evaluate(cdp, 'window.scrollY');
      assert(afterWater > beforeWater, 'touch drag paints water');
      assertEqual(afterScroll, beforeScroll, 'touching the tray does not scroll the page');

      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
      await clickSelector(cdp, '#exampleBtn');
      await sleep(300);
      const exampleCounts = await evaluate(cdp, 'ElementLab.debug().counts');
      assert(exampleCounts.sand > 0 && exampleCounts.water > 0 && exampleCounts.plant > 0, 'Example button restores the demo scene');
      await screenshot(cdp, 'narrow.png');
    });

    await step('has no uncaught errors or console errors', async () => {
      const problems = cdp.events.filter((event) => {
        if (event.method === 'Runtime.exceptionThrown') return true;
        return event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error';
      });
      assertEqual(problems.length, 0, 'page errors found: ' + (problems.length ? JSON.stringify(problems[0]).slice(0, 400) : 'none'));
    });

    console.log('\n' + (results.length - failures) + ' passed, ' + failures + ' failed');
    if (failures === 0) {
      console.log('Screenshots: tests/artifacts/desktop.png, tests/artifacts/narrow.png');
    }
  } finally {
    if (cdp) {
      try {
        cdp.ws.close();
      } catch (error) {
        /* ignore */
      }
    }
    killChrome(chrome.proc);
    await sleep(250);
    try {
      fs.rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch (error) {
      /* temp profile cleanup is best-effort */
    }
  }

  return failures > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('\nBrowser test could not run:');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
