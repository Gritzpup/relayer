const fs = require('fs');
const path = require('path');

// Try to connect to the running browser via CDP
(async () => {
  const puppeteer = require('puppeteer-core');
  
  let browser;
  try {
    // Try connecting to existing CDP endpoint
    const http = require('http');
    const endpoints = await new Promise((resolve, reject) => {
      http.get('http://localhost:9222/json/version', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    console.log('CDP endpoint found:', endpoints.webSocketDebuggerUrl);
    browser = await puppeteer.connect({ browserWSEndpoint: endpoints.webSocketDebuggerUrl, defaultViewport: null });
    console.log('Connected to existing browser!');
  } catch (e) {
    console.log('No existing CDP browser, listing all chrome processes...');
    const { execSync } = require('child_process');
    const procs = execSync('ps aux | grep -E "brave|chrome|chromium" | grep -v grep').toString();
    console.log('Browser processes:\n', procs);
    
    // Try to find the puppeteer profile dirs
    const tmpDirs = execSync('ls -d /tmp/puppeteer_dev_profile-* 2>/dev/null').toString().trim();
    console.log('Puppeteer profile dirs:', tmpDirs || 'none');
    process.exit(0);
  }
  
  const pages = await browser.pages();
  console.log(`\nFound ${pages.length} pages:`);
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      const url = await page.url();
      const title = await page.title();
      console.log(`  Page ${i}: "${title}" - ${url}`);
      
      if (url.includes('rumble.com')) {
        console.log(`\n=== RUMBLE PAGE FOUND (Page ${i}) ===`);
        
        // Take screenshot
        const screenshotPath = '/tmp/rumble-diagnose.png';
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`Screenshot saved to ${screenshotPath}`);
        
        // Check what's focused
        const focusInfo = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return { focused: false, reason: 'no activeElement' };
          return {
            focused: true,
            tagName: el.tagName,
            type: el.getAttribute('type'),
            placeholder: el.getAttribute('placeholder'),
            className: el.className,
            id: el.id,
            textContent: (el.textContent || '').substring(0, 100),
            rect: el.getBoundingClientRect(),
            visible: el.offsetParent !== null
          };
        });
        console.log('Focused element:', JSON.stringify(focusInfo, null, 2));
        
        // Find ALL textareas and inputs
        const inputs = await page.evaluate(() => {
          const elements = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
          return Array.from(elements).map(el => ({
            tagName: el.tagName,
            type: el.getAttribute('type'),
            placeholder: el.getAttribute('placeholder'),
            className: (el.className || '').substring(0, 80),
            id: el.id,
            visible: el.offsetParent !== null,
            rect: el.getBoundingClientRect()
          }));
        });
        console.log(`\nFound ${inputs.length} text inputs:`);
        inputs.forEach((inp, i) => {
          console.log(`  ${i}: ${inp.tagName} type=${inp.type} placeholder="${inp.placeholder}" visible=${inp.visible} class="${inp.className}"`);
        });
        
        // Check page body text (first 300 chars)
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('\nPage body text (first 500 chars):');
        console.log(bodyText);
        
        // Check cookies
        const cookies = await page.cookies();
        const authCookies = cookies.filter(c => c.name === 'u_s' || c.name === 'a_s' || c.name === 'e_s');
        console.log('\nAuth cookies found:', authCookies.length);
        if (authCookies.length > 0) {
          console.log(`  u_s=${cookies.find(c => c.name === 'u_s')?.value?.substring(0, 20)}...`);
          console.log(`  a_s=${cookies.find(c => c.name === 'a_s')?.value?.substring(0, 20)}...`);
        } else {
          console.log('  NO AUTH COOKIES FOUND - browser may be logged out!');
        }
      }
    } catch (e) {
      console.log(`  Page ${i}: Error: ${e.message}`);
    }
  }
  
  await browser.disconnect();
  console.log('\nDone.');
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
