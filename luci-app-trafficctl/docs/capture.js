'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const path          = require('path');
const fs            = require('fs');

const APP_URL    = 'https://dyr.ozerki.net/cgi-bin/luci/admin/status/trafficctl';
const IMG_DARK   = path.join(__dirname, 'img', 'dark');
const IMG_LIGHT  = path.join(__dirname, 'img', 'light');
const IMG_GIF    = path.join(__dirname, 'img');
const TMP_FRAMES = '/tmp/tc_frames';

// Sensitive data to mask in screenshots
const MASK_HOSTNAME = 'dyr.ozerki.net';
const MASK_HOSTNAME_REPLACEMENT = 'router.local';

// ── helpers ────────────────────────────────────────────────────────────────

function mkdirs() {
  [IMG_DARK, IMG_LIGHT, TMP_FRAMES].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function clearFrames() {
  fs.readdirSync(TMP_FRAMES).forEach(f => fs.unlinkSync(path.join(TMP_FRAMES, f)));
}

async function shot(page, file) {
  await page.screenshot({ path: file, fullPage: false });
  console.log('  ✓', path.relative('/tmp/luci-app-trafficctl', file));
}

async function setDark(page, on) {
  await page.evaluate(d => document.documentElement.setAttribute('data-darkmode', String(d)), on);
  await page.waitForTimeout(300);
}

function makeGif(pattern, output, fps = 2) {
  const palette = '/tmp/palette.png';
  try {
    execSync(`ffmpeg -y -framerate ${fps} -i "${path.join(TMP_FRAMES, pattern)}" -vf "scale=1200:-1:flags=lanczos,palettegen" "${palette}" 2>/dev/null`);
    execSync(`ffmpeg -y -framerate ${fps} -i "${path.join(TMP_FRAMES, pattern)}" -i "${palette}" -filter_complex "scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "${output}" 2>/dev/null`);
    console.log('  ✓ GIF:', path.relative('/tmp/luci-app-trafficctl', output));
  } catch (e) {
    console.error('  ✗ GIF failed:', e.message);
  }
}

// ── Sensitive data masking ─────────────────────────────────────────────────

// Inject CSS+JS to mask MACs and hostname in the page DOM before screenshots.
// Call this after every navigation or significant DOM update.
async function maskSensitiveData(page) {
  await page.evaluate(({ hostname, replacement }) => {
    const MAC_RE = /([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})/g;

    function maskMac(mac) {
      const parts = mac.split(':');
      return parts[0] + ':' + parts[1] + ':XX:XX:XX:XX';
    }

    function walkText(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        let val = node.nodeValue;
        if (!val) continue;
        let changed = false;
        // Mask MACs
        if (MAC_RE.test(val)) {
          val = val.replace(MAC_RE, (m) => maskMac(m));
          changed = true;
        }
        MAC_RE.lastIndex = 0;
        // Mask hostname
        if (val.includes(hostname)) {
          val = val.replaceAll(hostname, replacement);
          changed = true;
        }
        if (changed) node.nodeValue = val;
      }
      // Also mask title/placeholder/value attributes
      root.querySelectorAll('[title],[placeholder],[value]').forEach(el => {
        ['title', 'placeholder', 'value'].forEach(attr => {
          const v = el.getAttribute(attr);
          if (!v) return;
          let nv = v;
          if (MAC_RE.test(nv)) { nv = nv.replace(MAC_RE, m => maskMac(m)); MAC_RE.lastIndex = 0; }
          if (nv.includes(hostname)) nv = nv.replaceAll(hostname, replacement);
          if (nv !== v) el.setAttribute(attr, nv);
        });
      });
    }
    walkText(document.body);

    // Also mask the page title / header
    if (document.title.includes(hostname)) {
      document.title = document.title.replaceAll(hostname, replacement);
    }
  }, { hostname: MASK_HOSTNAME, replacement: MASK_HOSTNAME_REPLACEMENT });
}

// Shot with masking applied
async function maskedShot(page, file) {
  await maskSensitiveData(page);
  await shot(page, file);
}

// Take a GIF frame with masking
async function maskedFrame(page, prefix, counter) {
  await maskSensitiveData(page);
  await page.screenshot({ path: path.join(TMP_FRAMES, `${prefix}_${String(counter.i++).padStart(3,'0')}.png`) });
}

// ── Navigation helpers ─────────────────────────────────────────────────────

async function gotoAllDevices(page) {
  await page.evaluate(() => {
    try {
      const o = JSON.parse(localStorage.getItem('trafficctl_opts') || '{}');
      delete o.lastIp;
      localStorage.setItem('trafficctl_opts', JSON.stringify(o));
    } catch (e) {}
  }).catch(() => {});
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
      return;
    } catch (e) {
      console.log(`    goto retry ${attempt + 1}/5: ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(5000);
    }
  }
  throw new Error('gotoAllDevices: failed after 5 retries');
}

async function waitForButton(page, label, timeout = 30000) {
  await page.waitForFunction(t => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes(t) && b.offsetParent !== null) return true;
    }
    return false;
  }, label, { timeout }).catch(() => {});
  await page.waitForTimeout(500);
}

async function waitDone(page, timeout = 20000) {
  await page.waitForFunction(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent.trim().startsWith('✓') && el.offsetParent !== null
          && el.style.display !== 'none') return true;
    }
    return false;
  }, { timeout }).catch(() => {});
  await page.waitForTimeout(600);
}

async function selectDevice(page, ip) {
  await page.evaluate(ip => {
    for (const row of document.querySelectorAll('tr.tm-row')) {
      const cells = row.querySelectorAll('td');
      if (cells[1] && cells[1].textContent.trim() === ip) { row.click(); return; }
    }
  }, ip);
  await page.waitForTimeout(1200);
}

async function pickOption(page, triggerText, optionText) {
  await page.evaluate(t => {
    for (const el of document.querySelectorAll('span[style*="dashed"]')) {
      if (el.textContent.trim() === t) { el.click(); return; }
    }
    const el = document.querySelector('span[style*="dashed"]');
    if (el) el.click();
  }, triggerText);
  await page.waitForTimeout(300);
  await page.evaluate(t => {
    for (const el of document.querySelectorAll('div[style*="cursor:pointer"][style*="font-size:12px"]')) {
      if (el.textContent.trim() === t) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return; }
    }
  }, optionText);
  await page.waitForTimeout(300);
}

async function openSettings(page) {
  const arrow = page.locator('.tm-settings-arrow');
  const txt = await arrow.textContent().catch(() => '▾');
  if (txt.includes('▸')) {
    await page.locator('div:has(.tm-settings-arrow)').first().click();
    await page.waitForTimeout(500);
  }
}

async function closeSettings(page) {
  const arrow = page.locator('.tm-settings-arrow');
  const txt = await arrow.textContent().catch(() => '▸');
  if (txt.includes('▾')) {
    await page.locator('div:has(.tm-settings-arrow)').first().click();
    await page.waitForTimeout(400);
  }
}

// Expand a settings subsection by title (e.g. "Telegram Bot", "Logging", "Connections table")
async function expandSection(page, titleFragment) {
  await page.evaluate(t => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes(t)) {
        const next = el.nextElementSibling;
        if (next && next.style.display === 'none') el.click();
        else el.click(); // toggle open
        break;
      }
    }
  }, titleFragment);
  await page.waitForTimeout(600);
}

// Collapse a settings subsection
async function collapseSection(page, titleFragment) {
  await page.evaluate(t => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes(t)) {
        const next = el.nextElementSibling;
        if (next && next.style.display !== 'none') el.click();
        break;
      }
    }
  }, titleFragment);
  await page.waitForTimeout(400);
}

// Click the Apply button via DOM evaluate (bypasses Playwright visibility checks entirely)
async function clickApply(page) {
  // Wait briefly for the button to appear
  await page.waitForTimeout(500);
  const clicked = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Apply') {
        b.scrollIntoView();
        b.click();
        return true;
      }
    }
    // Also try partial match
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('Apply') && !b.disabled) {
        b.scrollIntoView();
        b.click();
        return true;
      }
    }
    return false;
  });
  if (!clicked) {
    console.log('    ⚠ Apply button not found, skipping');
  }
  await page.waitForTimeout(300);
}

// Find best candidate device — prefers Eugene-Asus, vivo-X200, or any phone-like device
async function findDevice(page) {
  const result = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.tm-row');
    const candidates = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const name = cells[0].textContent.trim();
      const nameLow = name.toLowerCase();
      const ip   = (cells[1].textContent || '').trim();
      if (!ip.match(/^192\.168\.\d+\.\d+$/)) continue;
      const isWifi = row.innerHTML.includes('📶');
      let score = 0;
      // Preferred targets
      if (nameLow.includes('eugene') && nameLow.includes('asus')) score = 200;
      else if (nameLow.includes('vivo') && nameLow.includes('x200')) score = 190;
      else if (nameLow.includes('евген') || nameLow.includes('evgen') || nameLow.includes('eugene') || nameLow.includes('zhenya')) score = 100;
      else if (nameLow.includes('phone') || nameLow.includes('iphone') || nameLow.includes('android')) score = 80;
      else if (nameLow.includes('samsung') || nameLow.includes('xiaomi') || nameLow.includes('huawei') || nameLow.includes('pixel') || nameLow.includes('vivo')) score = 70;
      else if (isWifi) score = 10;
      candidates.push({ name, ip, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  });
  console.log('  Devices:', result.slice(0, 8).map(r => `${r.name} (${r.ip}) score=${r.score}`).join(', '));
  const pick = result.find(r => r.score >= 10) || result[0] || null;
  if (!pick) console.log('  ⚠ No devices found at all');
  return pick;
}

// Ensure device has no rate limit, no WiFi block, no internet block
async function cleanDevice(page, ip) {
  console.log('  Cleaning device state…');
  await selectDevice(page, ip);

  const rate = await page.evaluate(() => {
    const el = document.querySelector('span[style*="dashed"]');
    return el ? el.textContent.trim() : 'Off';
  });
  if (rate !== 'Off') {
    console.log(`    Removing rate limit (${rate})…`);
    await pickOption(page, rate, 'Off');
    await clickApply(page);
    await waitDone(page);
  }

  const unblockInet = page.locator('button:has-text("Unblock Internet")');
  if (await unblockInet.isVisible().catch(() => false)) {
    console.log('    Unblocking internet…');
    await unblockInet.click();
    await waitForButton(page, 'Block Internet');
  }

  const unblockWifi = page.locator('button:has-text("Unblock WiFi")');
  if (await unblockWifi.isVisible().catch(() => false)) {
    console.log('    Unblocking WiFi…');
    await unblockWifi.click();
    await waitForButton(page, 'Block WiFi', 30000);
  }

  await page.waitForTimeout(1500);
  console.log('  Clean ✓');
}

// ── Speed graph hover popup GIF ────────────────────────────────────────────

async function captureGraphPopup(page, device, dark) {
  const label = dark ? 'dark' : 'light';
  console.log('  [GIF] Speed graph popup hover…');

  // First, make sure we're on all-devices view with speed data
  await gotoAllDevices(page);
  await setDark(page, dark);
  // Wait for speed poll to produce sparklines (need at least a few data points)
  console.log('    Waiting for sparkline data (10s)…');
  await page.waitForTimeout(10000);

  clearFrames();
  const counter = { i: 0 };

  // Frame: overview with sparklines visible (before hover)
  await maskedFrame(page, 'gp', counter);
  await maskedFrame(page, 'gp', counter);

  // Find the sparkline SVG for our target device and hover over it
  const sparkRect = await page.evaluate(ip => {
    for (const row of document.querySelectorAll('tr.tm-row')) {
      const cells = row.querySelectorAll('td');
      if (!cells[1] || cells[1].textContent.trim() !== ip) continue;
      const svg = row.querySelector('svg');
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.6, y: rect.top + rect.height / 2 };
    }
    return null;
  }, device.ip);

  if (sparkRect) {
    // Hover over the sparkline to trigger popup
    await page.mouse.move(sparkRect.x, sparkRect.y);
    await page.waitForTimeout(500);

    // Capture several frames while popup is visible
    for (let i = 0; i < 6; i++) {
      await maskedFrame(page, 'gp', counter);
      await page.waitForTimeout(800);
    }

    // Move mouse slightly along the sparkline for crosshair effect
    for (let dx = -30; dx <= 30; dx += 15) {
      await page.mouse.move(sparkRect.x + dx, sparkRect.y);
      await page.waitForTimeout(400);
      await maskedFrame(page, 'gp', counter);
    }

    // Hold a moment
    await maskedFrame(page, 'gp', counter);
    await maskedFrame(page, 'gp', counter);

    // Mouse leaves — popup disappears
    await page.mouse.move(10, 10);
    await page.waitForTimeout(600);
    await maskedFrame(page, 'gp', counter);
  } else {
    console.log('    ⚠ No sparkline found for device, skipping popup hover');
    return;
  }

  makeGif('gp_%03d.png', path.join(IMG_GIF, `graph-popup-${label}.gif`), 3);
}

// ── Column toggle GIF ──────────────────────────────────────────────────────

async function captureColumnToggle(page, device, dark) {
  const label = dark ? 'dark' : 'light';
  console.log('  [GIF] Column toggle demo…');

  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(3000);

  clearFrames();
  const counter = { i: 0 };

  // Initial state — all columns visible
  await maskedFrame(page, 'ct', counter);
  await maskedFrame(page, 'ct', counter);

  // Open settings and expand Connections table section
  await openSettings(page);
  await expandSection(page, 'Connections table');
  await page.waitForTimeout(400);
  await maskedFrame(page, 'ct', counter);

  // Toggle off MAC column
  const toggleChip = async (chipName) => {
    await page.evaluate(name => {
      for (const el of document.querySelectorAll('span[style*="border-radius"]')) {
        if (el.textContent.trim() === name) { el.click(); return; }
      }
    }, chipName);
    await page.waitForTimeout(500);
  };

  await toggleChip('MAC');
  await maskedFrame(page, 'ct', counter);
  await maskedFrame(page, 'ct', counter);

  // Toggle off Speed column
  await toggleChip('Speed');
  await maskedFrame(page, 'ct', counter);
  await maskedFrame(page, 'ct', counter);

  // Toggle off Conns column
  await toggleChip('Conns');
  await maskedFrame(page, 'ct', counter);
  await maskedFrame(page, 'ct', counter);

  // Re-enable all
  await toggleChip('Conns');
  await page.waitForTimeout(300);
  await toggleChip('Speed');
  await page.waitForTimeout(300);
  await toggleChip('MAC');
  await page.waitForTimeout(500);
  await maskedFrame(page, 'ct', counter);
  await maskedFrame(page, 'ct', counter);

  await closeSettings(page);
  await maskedFrame(page, 'ct', counter);

  makeGif('ct_%03d.png', path.join(IMG_GIF, `column-toggle-${label}.gif`), 2);
}

// ── Telegram Bot toggle GIF ────────────────────────────────────────────────

async function captureTelegramToggle(page, dark) {
  const label = dark ? 'dark' : 'light';
  console.log('  [GIF] Telegram Bot toggle…');

  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(2000);

  clearFrames();
  const counter = { i: 0 };

  // Open settings
  await openSettings(page);
  await maskedFrame(page, 'tg', counter);

  // Expand Telegram Bot section
  await expandSection(page, 'Telegram Bot');
  await page.waitForTimeout(500);
  await maskedFrame(page, 'tg', counter);
  await maskedFrame(page, 'tg', counter);

  // Toggle the enabled checkbox
  const toggleTelegram = async (on) => {
    await page.evaluate(on => {
      const labels = document.querySelectorAll('label');
      for (const lbl of labels) {
        if (lbl.textContent.includes('Enable') || lbl.textContent.includes('Enabled')) {
          const cb = lbl.querySelector('input[type="checkbox"]') || lbl.parentElement.querySelector('input[type="checkbox"]');
          if (cb && cb.checked !== on) { cb.click(); return; }
        }
      }
      // Fallback: look for checkbox near "Telegram" text
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      for (const cb of cbs) {
        const parent = cb.closest('div') || cb.parentElement;
        if (parent && parent.textContent.includes('nable')) {
          if (cb.checked !== on) cb.click();
          return;
        }
      }
    }, on);
    await page.waitForTimeout(600);
  };

  // Enable telegram
  await toggleTelegram(true);
  await maskedFrame(page, 'tg', counter);
  await maskedFrame(page, 'tg', counter);
  await maskedFrame(page, 'tg', counter);

  // Disable telegram
  await toggleTelegram(false);
  await maskedFrame(page, 'tg', counter);
  await maskedFrame(page, 'tg', counter);

  // Collapse section
  await collapseSection(page, 'Telegram Bot');
  await page.waitForTimeout(300);
  await maskedFrame(page, 'tg', counter);

  await closeSettings(page);
  await maskedFrame(page, 'tg', counter);

  makeGif('tg_%03d.png', path.join(IMG_GIF, `telegram-toggle-${label}.gif`), 2);
}

// ── Settings overview GIF (scroll through all sections) ────────────────────

async function captureSettingsWalkthrough(page, dark) {
  const label = dark ? 'dark' : 'light';
  console.log('  [GIF] Settings walkthrough…');

  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(2000);

  clearFrames();
  const counter = { i: 0 };

  // Closed settings
  await maskedFrame(page, 'sw', counter);

  // Open settings
  await openSettings(page);
  await page.waitForTimeout(400);
  await maskedFrame(page, 'sw', counter);
  await maskedFrame(page, 'sw', counter);

  // Expand Connections table
  await expandSection(page, 'Connections table');
  await maskedFrame(page, 'sw', counter);
  await maskedFrame(page, 'sw', counter);

  // Expand Telegram Bot
  await expandSection(page, 'Telegram Bot');
  await maskedFrame(page, 'sw', counter);
  await maskedFrame(page, 'sw', counter);

  // Expand Logging & Persistence
  await expandSection(page, 'Logging');
  await maskedFrame(page, 'sw', counter);
  await maskedFrame(page, 'sw', counter);

  // Collapse all
  await collapseSection(page, 'Logging');
  await collapseSection(page, 'Telegram Bot');
  await collapseSection(page, 'Connections table');
  await page.waitForTimeout(300);
  await maskedFrame(page, 'sw', counter);

  // Close settings
  await closeSettings(page);
  await maskedFrame(page, 'sw', counter);

  makeGif('sw_%03d.png', path.join(IMG_GIF, `settings-walkthrough-${label}.gif`), 2);
}

// ── capture one full scenario (dark or light) ──────────────────────────────

async function captureTheme(page, dark, device) {
  const DIR   = dark ? IMG_DARK : IMG_LIGHT;
  const label = dark ? 'dark' : 'light';
  console.log(`\n══ ${label} theme ══════════════════════════════════════`);

  await setDark(page, dark);

  // 1. Overview — wait for speed data
  console.log('  [01] Overview…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(5000);
  await maskedShot(page, path.join(DIR, '01-overview.png'));

  // 2. Speed graph GIF (12 frames × 2s)
  console.log('  [GIF] Speed graph (12 frames × 2s)…');
  clearFrames();
  for (let i = 0; i < 12; i++) {
    await maskSensitiveData(page);
    await page.screenshot({ path: path.join(TMP_FRAMES, `sg_${String(i).padStart(3,'0')}.png`) });
    if (i < 11) await page.waitForTimeout(2000);
  }
  makeGif('sg_%03d.png', path.join(IMG_GIF, `speed-graph-${label}.gif`), 3);

  // 3. Graph popup hover GIF (new!)
  await captureGraphPopup(page, device, dark);

  // 4. Device detail
  console.log(`  [02] Device detail → ${device.name} (${device.ip})`);
  await selectDevice(page, device.ip);
  await maskedShot(page, path.join(DIR, '02-device-detail.png'));

  // 5–6. Block / Unblock internet + GIF
  console.log('  [03-04] Block/Unblock internet…');
  clearFrames();
  const counter = { i: 0 };

  await maskedFrame(page, 'bi', counter); // unblocked state
  const blockBtn = page.locator('button:has-text("Block Internet")');
  if (await blockBtn.isVisible().catch(() => false)) {
    await blockBtn.click();
    await waitForButton(page, 'Unblock Internet');
    await maskedFrame(page, 'bi', counter); await maskedFrame(page, 'bi', counter);
    await maskedShot(page, path.join(DIR, '03-internet-blocked.png'));
    await page.locator('button:has-text("Unblock Internet")').click();
    await waitForButton(page, 'Block Internet');
    await maskedFrame(page, 'bi', counter); await maskedFrame(page, 'bi', counter);
    await maskedShot(page, path.join(DIR, '04-internet-unblocked.png'));
  }
  makeGif('bi_%03d.png', path.join(IMG_GIF, `block-internet-${label}.gif`), 2);

  // 7–8. Block / Unblock WiFi
  const wifiBlockBtn = page.locator('button:has-text("Block WiFi")');
  if (await wifiBlockBtn.isVisible().catch(() => false)) {
    console.log('  [05-06] Block/Unblock WiFi…');
    await wifiBlockBtn.click();
    await waitForButton(page, 'Unblock WiFi');
    await maskedShot(page, path.join(DIR, '05-wifi-blocked.png'));
    await page.locator('button:has-text("Unblock WiFi")').click();
    await waitForButton(page, 'Block WiFi', 30000);
    await page.waitForTimeout(1000);
    await maskedShot(page, path.join(DIR, '06-wifi-unblocked.png'));
  } else {
    console.log('  (WiFi button not visible for this device)');
  }

  // 9–11. Rate limit GIF: Off → Limiter 10M → Shaper 10M → Off
  console.log('  [07-09] Rate limit sequence…');
  // Re-select device to ensure clean state after WiFi block/unblock
  await selectDevice(page, device.ip);
  // Wait for rate limit picker to appear (dashed span)
  await page.waitForFunction(() => {
    const spans = document.querySelectorAll('span[style*="dashed"]');
    return spans.length > 0;
  }, { timeout: 10000 }).catch(() => console.log('    ⚠ Rate limit picker not found'));
  await page.waitForTimeout(500);
  clearFrames();
  counter.i = 0;

  await maskedFrame(page, 'rl', counter); // frame 0: clean state

  await pickOption(page, 'Off', '10 Mbit/s');
  await pickOption(page, 'Shaper (queue)', 'Limiter (drop)');
  await page.waitForTimeout(500);
  await maskedFrame(page, 'rl', counter); // frame 1: options selected

  await clickApply(page);
  await waitDone(page);
  await maskedFrame(page, 'rl', counter); await maskedFrame(page, 'rl', counter); // frames 2-3
  await maskedShot(page, path.join(DIR, '07-limiter-applied.png'));

  await pickOption(page, 'Limiter (drop)', 'Shaper (queue)');
  await page.waitForTimeout(300);
  await clickApply(page);
  await waitDone(page);
  await maskedFrame(page, 'rl', counter); // frame 4
  await maskedShot(page, path.join(DIR, '08-shaper-applied.png'));

  await pickOption(page, '10 Mbit/s', 'Off');
  await page.waitForTimeout(300);
  await clickApply(page);
  await waitDone(page);
  await maskedFrame(page, 'rl', counter); await maskedFrame(page, 'rl', counter); // frames 5-6
  await maskedShot(page, path.join(DIR, '09-throttle-removed.png'));

  makeGif('rl_%03d.png', path.join(IMG_GIF, `rate-limit-${label}.gif`), 2);

  // 12. Settings panel
  console.log('  [10] Settings panel…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  await openSettings(page);
  await maskedShot(page, path.join(DIR, '10-settings.png'));

  // 13. Column toggle GIF (new!)
  await captureColumnToggle(page, device, dark);

  // 14. Settings walkthrough GIF (new!)
  await captureSettingsWalkthrough(page, dark);

  // 15. Telegram Bot section
  console.log('  [19] Telegram Bot section…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  await openSettings(page);
  await expandSection(page, 'Telegram Bot');
  await page.waitForTimeout(1500);
  await maskedShot(page, path.join(DIR, '19-telegram-settings.png'));

  // 16. Telegram toggle GIF (new!)
  await captureTelegramToggle(page, dark);

  // 17. Logging & Persistence section
  console.log('  [20] Logging & Persistence section…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  await openSettings(page);
  await expandSection(page, 'Logging');
  await page.waitForTimeout(1500);
  await maskedShot(page, path.join(DIR, '20-logging-settings.png'));

  // 18. Connections table section
  console.log('  [21] Connections table section…');
  await expandSection(page, 'Connections table');
  await page.waitForTimeout(500);
  await maskedShot(page, path.join(DIR, '21-connections-table-settings.png'));

  // 19. Activity Log panel
  console.log('  [22] Activity Log panel…');
  await page.evaluate(() => {
    const cb = document.getElementById('tm-activity');
    if (cb && !cb.checked) cb.click();
  });
  await page.waitForTimeout(2000);
  await closeSettings(page);
  await page.waitForTimeout(500);
  await maskedShot(page, path.join(DIR, '22-activity-log.png'));
  await page.evaluate(() => {
    const cb = document.getElementById('tm-activity');
    if (cb && cb.checked) cb.click();
  });
  await page.waitForTimeout(300);

  // 20. Column toggle: hide MAC, then restore (static screenshot)
  console.log('  [11] Column toggle static…');
  await openSettings(page);
  await expandSection(page, 'Connections table');
  const toggled = await page.evaluate(() => {
    for (const el of document.querySelectorAll('span[style*="border-radius"]')) {
      if (el.textContent.trim() === 'MAC') { el.click(); return true; }
    }
    return false;
  });
  if (toggled) {
    await page.waitForTimeout(500);
    await maskedShot(page, path.join(DIR, '11-col-mac-hidden.png'));
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('span[style*="border-radius"]')) {
        if (el.textContent.trim() === 'MAC') { el.click(); return; }
      }
    });
    await page.waitForTimeout(400);
  }
  await closeSettings(page);

  // Helper: toggle #tm-extended via DOM click
  const setExtended = async (on) => {
    await page.evaluate(on => {
      const cb = document.getElementById('tm-extended');
      if (cb && cb.checked !== on) cb.click();
    }, on);
    await page.waitForTimeout(600);
  };

  // 21. Extended stats — all-devices view
  console.log('  [12] Extended stats (all devices)…');
  await setExtended(true);
  await page.waitForTimeout(400);
  await maskedShot(page, path.join(DIR, '12-extended-stats-all.png'));

  // 22. Extended stats — per-device with active limiter
  console.log('  [13] Extended stats (per device)…');
  await selectDevice(page, device.ip);
  await pickOption(page, 'Off', '10 Mbit/s');
  await pickOption(page, 'Shaper (queue)', 'Limiter (drop)');
  await clickApply(page);
  await waitDone(page);
  await page.waitForTimeout(800);
  await setExtended(true);
  await maskedShot(page, path.join(DIR, '13-extended-stats-device.png'));
  await pickOption(page, '10 Mbit/s', 'Off');
  await clickApply(page);
  await waitDone(page);
  await setExtended(false);

  // 23. Group by service
  console.log('  [14] Group by service…');
  await openSettings(page);
  await pickOption(page, 'None (per-flow)', 'Service');
  await page.waitForTimeout(800);
  await closeSettings(page);
  await page.waitForTimeout(400);
  await maskedShot(page, path.join(DIR, '14-group-by-service.png'));

  // 24. Group by hostname
  console.log('  [15] Group by hostname…');
  await openSettings(page);
  await pickOption(page, 'Service', 'Hostname / Dst IP');
  await page.waitForTimeout(800);
  await closeSettings(page);
  await page.waitForTimeout(400);
  await maskedShot(page, path.join(DIR, '15-group-by-host.png'));

  // Reset grouping
  await openSettings(page);
  await pickOption(page, 'Hostname / Dst IP', 'None (per-flow)');
  await page.waitForTimeout(500);
  await closeSettings(page);

  // 25. Searchable device picker
  console.log('  [16] Searchable device picker…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.click();
  await searchInput.type('eug', { delay: 80 });
  await page.waitForTimeout(600);
  await maskedShot(page, path.join(DIR, '16-search-filter.png'));
  await searchInput.clear();
  await page.waitForTimeout(400);

  // 26. WiFi/Link column
  console.log('  [17] Link/band column…');
  await page.waitForTimeout(500);
  await maskedShot(page, path.join(DIR, '17-link-band.png'));

  // 27. Unreachable device tooltip
  console.log('  [18] Unreachable ? tooltip…');
  const tooltipShot = await page.evaluate(() => {
    for (const el of document.querySelectorAll('td span, td a')) {
      if (el.textContent.trim() === '?' || el.title) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  });
  if (tooltipShot) {
    await page.mouse.move(tooltipShot.x, tooltipShot.y);
    await page.waitForTimeout(800);
    await maskedShot(page, path.join(DIR, '18-unreachable-tooltip.png'));
    await page.mouse.move(0, 0);
  } else {
    console.log('    (no unreachable device with tooltip found, skipping)');
  }
}

// ── main ───────────────────────────────────────────────────────────────────

(async () => {
  mkdirs();

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx  = browser.contexts()[0];
  const page = ctx.pages()[0];

  await page.setViewportSize({ width: 1300, height: 820 });

  // Ensure we start on all-devices overview
  await gotoAllDevices(page);

  // Detect target device from the table
  const device = await findDevice(page);
  if (!device) { console.error('No device found in table!'); process.exit(1); }
  console.log(`\nUsing device: ${device.name} (${device.ip})\n`);

  // Clean device before dark theme
  await cleanDevice(page, device.ip);
  await captureTheme(page, true,  device);

  // Clean device before light theme
  await cleanDevice(page, device.ip);
  await captureTheme(page, false, device);

  // Final cleanup
  await cleanDevice(page, device.ip);
  await setDark(page, false);
  await gotoAllDevices(page);

  await browser.close();
  console.log('\n✓ All done. Files saved to docs/img/');
  console.log('  Sensitive data masked: MACs → XX:XX format, hostname → router.local');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
