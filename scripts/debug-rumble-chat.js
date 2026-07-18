const fs = require('fs');
const path = require('path');

(async () => {
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const puppeteer = require('puppeteer-core');
  puppeteerExtra.addExtra(puppeteer);
  puppeteerExtra.use(StealthPlugin());

  // Load cookies
  const cookieFile = path.join(__dirname, '..', 'rumble_cookies.json');
  const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
  console.log('Username:', cookieData.username);
  console.log('Chat ID:', cookieData.chat_id);

  // Chat selector (same as in rumbleCookieManager.ts)
  const CHAT_INPUT_SELECTOR = [
    '[class*="chat" i] textarea',
    '[class*="chat" i] [contenteditable]',
    '[class*="chat" i] input[type="text"]',
    '[data-testid="chat-input"]',
    '.chat-input textarea', '.chat-input input',
    '#chat-input', '#chat-message-input',
    'form[class*="chat"] textarea', 'form[class*="chat"] input',
  ].join(', ');

  console.log('\nLaunching stealth browser...');
  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/brave-browser-stable',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();

  // Set cookies
  const cookiePairs = cookieData.cookies.split('; ').filter(Boolean);
  for (const pair of cookiePairs) {
    const [name, ...v] = pair.split('=');
    if (name && v.length) {
      await page.setCookie({ name: name.trim(), value: v.join('='), domain: '.rumble.com', path: '/' });
    }
  }
  console.log(`Set ${cookiePairs.length} cookies`);

  // Navigate to live page
  const liveUrl = `https://rumble.com/user/${cookieData.username || 'Gritzpup'}/live`;
  console.log(`\nNavigating to: ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Check what URL we ended up on (redirects?)
  const actualUrl = await page.url();
  const pageTitle = await page.title();
  console.log(`\nActual URL: ${actualUrl}`);
  console.log(`Page title: "${pageTitle}"`);

  // Check for Cloudflare / login
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 400));
  console.log(`\nBody text (first 400): "${bodyText}"`);

  // Screenshot
  const shot1 = '/tmp/rumble-debug-1.png';
  await page.screenshot({ path: shot1, fullPage: false });
  console.log(`\nScreenshot 1 saved: ${shot1}`);

  // Find ALL text inputs
  const allInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'))
      .map((el, i) => ({
        i,
        tag: el.tagName,
        placeholder: el.getAttribute('placeholder') || '',
        className: (el.className || '').substring(0, 100),
        id: el.id || '',
        visible: el.offsetParent !== null,
        rect: JSON.parse(JSON.stringify(el.getBoundingClientRect())),
        text: (el.textContent || el.value || '').substring(0, 50),
      }));
  });

  console.log(`\n=== ALL text inputs found: ${allInputs.length} ===`);
  allInputs.forEach(inp => {
    console.log(`  #${inp.i}: <${inp.tag}> id="${inp.id}" placeholder="${inp.placeholder}" visible=${inp.visible} class="${inp.className}" text="${inp.text}"`);
  });

  // What does our chat selector match?
  const chatMatch = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      tag: el.tagName,
      placeholder: el.getAttribute('placeholder') || '',
      className: (el.className || '').substring(0, 100),
      id: el.id || '',
      visible: el.offsetParent !== null,
      rect: JSON.parse(JSON.stringify(el.getBoundingClientRect())),
    };
  }, CHAT_INPUT_SELECTOR);

  console.log(`\n=== CHAT_INPUT_SELECTOR match: ===`);
  console.log(chatMatch ? JSON.stringify(chatMatch, null, 2) : 'NO MATCH!');

  // Check for iframes
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.src?.substring(0, 100),
      id: f.id,
      className: (f.className || '').substring(0, 80),
      visible: f.offsetParent !== null,
    }));
  });
  console.log(`\n=== Iframes: ${iframes.length} ===`);
  iframes.forEach(f => console.log(`  src="${f.src}" id="${f.id}" visible=${f.visible}`));

  // Now try to find the chat input and type into it
  console.log('\n=== Attempting to type message ===');
  try {
    // Try clicking the chat selector
    await page.click(CHAT_INPUT_SELECTOR, { timeout: 5000 });
    console.log('Clicked chat input');
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.log(`Click FAILED: ${e.message}`);
    console.log('Trying to find ANY visible textarea...');
    // Try to click the first visible textarea
    try {
      const clicked = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (ta && ta.offsetParent) { ta.focus(); ta.click(); return true; }
        return false;
      });
      console.log(`Fallback click on visible textarea: ${clicked}`);
    } catch (e2) {
      console.log(`Fallback also failed: ${e2.message}`);
    }
  }

  // What's focused now?
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { focused: false };
    return {
      tag: el.tagName,
      placeholder: el.getAttribute('placeholder') || '',
      className: (el.className || '').substring(0, 100),
      id: el.id || '',
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
    };
  });
  console.log('Focused element:', JSON.stringify(focusInfo, null, 2));

  // Type a test message
  const testMsg = 'DEBUG_TEST_' + Date.now();
  console.log(`Typing: "${testMsg}"`);
  await page.keyboard.type(testMsg, { delay: 20 });
  await new Promise(r => setTimeout(r, 500));

  // Screenshot after typing
  const shot2 = '/tmp/rumble-debug-2.png';
  await page.screenshot({ path: shot2, fullPage: false });
  console.log(`Screenshot 2 saved: ${shot2}`);

  // Press Enter
  console.log('Pressing Enter...');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2000));

  // Screenshot after Enter
  const shot3 = '/tmp/rumble-debug-3.png';
  await page.screenshot({ path: shot3, fullPage: false });
  console.log(`Screenshot 3 saved: ${shot3}`);

  // Did the message area clear? (Rumble should clear after send)
  const inputValue = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.value || el.textContent || '') : 'no focus';
  });
  console.log(`Input value after Enter: "${inputValue}"`);

  await browser.close();
  console.log('\nDone. Screenshots at /tmp/rumble-debug-{1,2,3}.png');
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
