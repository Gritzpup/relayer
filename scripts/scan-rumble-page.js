const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
puppeteerExtra.addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

(async () => {
  const data = JSON.parse(fs.readFileSync('rumble_cookies.json', 'utf-8'));

  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/brave-browser-stable',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1920,1080', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();

  for (const pair of data.cookies.split('; ').filter(Boolean)) {
    const [name, ...v] = pair.split('=');
    if (name && v.length) await page.setCookie({ name: name.trim(), value: v.join('='), domain: '.rumble.com', path: '/' });
  }

  console.log('Navigating to live page...');
  await page.goto('https://rumble.com/user/Gritzpup/live', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Take screenshot
  await page.screenshot({ path: '/tmp/rumble-page.png' });
  console.log('Screenshot saved to /tmp/rumble-page.png');

  // Simple DOM scan - just get visible text content and inputs
  const info = await page.evaluate(() => {
    const result = { title: document.title, bodyText: document.body ? document.body.innerText.substring(0, 500) : 'NO BODY' };

    // Find all non-hidden inputs
    const inputs = [];
    document.querySelectorAll('textarea, input:not([type="hidden"]), [contenteditable="true"]').forEach(el => {
      inputs.push({
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        placeholder: (el.getAttribute('placeholder') || '').substring(0, 60),
        visible: el.offsetParent !== null
      });
    });
    result.inputs = inputs;

    // Count all elements on page
    result.totalElements = document.querySelectorAll('*').length;
    result.iframes = document.querySelectorAll('iframe').length;

    return result;
  });

  console.log('Page info:', JSON.stringify(info, null, 2));

  if (info.inputs.length === 0 && info.iframes === 0) {
    console.log('\nCHAT NOT FOUND - trying direct video page...');
    await page.goto('https://rumble.com/v7aq032-gritzpups-haven.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));
    const info2 = await page.evaluate(() => ({
      title: document.title,
      iframes: document.querySelectorAll('iframe').length,
      inputs: Array.from(document.querySelectorAll('textarea, input:not([type="hidden"]), [contenteditable="true"]')).map(el => ({
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        placeholder: (el.getAttribute('placeholder') || '').substring(0, 60),
        visible: el.offsetParent !== null
      }))
    }));
    console.log('Video page info:', JSON.stringify(info2, null, 2));
  }

  await browser.close();
  console.log('Done.');
})();
