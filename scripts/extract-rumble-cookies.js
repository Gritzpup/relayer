#!/usr/bin/env node

// Manual Rumble Cookie Extractor
// This script connects to your running Brave browser and extracts Rumble cookies

const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');

async function extractRumbleCookies() {
  console.log('🔍 Connecting to Brave browser on port 9222...');

  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null
    });

    console.log('✅ Connected to browser');

    const pages = await browser.pages();
    console.log(`📖 Found ${pages.length} open tabs`);

    // Find Rumble tab or create one
    let rumblePage = pages.find(p => p.url().includes('rumble.com'));

    if (!rumblePage) {
      console.log('📄 No Rumble tab found, opening one...');
      rumblePage = await browser.newPage();
      await rumblePage.goto('https://rumble.com', { waitUntil: 'networkidle2' });
    } else {
      console.log('✅ Found existing Rumble tab');
    }

    // Get all cookies for rumble.com
    const cookies = await rumblePage.cookies();

    const rumbleCookies = cookies.filter(c =>
      c.domain.includes('rumble.com')
    );

    if (rumbleCookies.length === 0) {
      console.error('❌ No Rumble cookies found!');
      console.error('Please make sure you are logged in to Rumble.com');
      browser.disconnect();
      process.exit(1);
    }

    console.log(`✅ Found ${rumbleCookies.length} Rumble cookies`);

    // Check for auth cookies
    const hasAuthCookie = rumbleCookies.some(c =>
      c.name.includes('session') ||
      c.name.includes('auth') ||
      c.name.includes('user') ||
      c.name === 'u_s' ||
      c.name === 'user_id'
    );

    if (!hasAuthCookie) {
      console.error('⚠️  Found cookies but no authentication cookie detected');
      console.error('Please make sure you are LOGGED IN to Rumble');
    } else {
      console.log('✅ Authentication cookies detected');
    }

    // Convert to header string
    const cookieString = rumbleCookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    // Try to get username
    let username = null;
    try {
      username = await rumblePage.evaluate(() => {
        const selectors = [
          '[data-username]',
          '.user-name',
          '.username',
          'a[href*="/user/"]'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.getAttribute('data-username') || element.textContent?.trim();
          }
        }
        return null;
      });
    } catch (e) {
      console.log('⚠️  Could not extract username from page');
    }

    // Save cookies
    const cookieData = {
      cookies: cookieString,
      chat_id: null,
      username: username,
      last_validated: Date.now()
    };

    const cookieFile = path.join(process.cwd(), 'rumble_cookies.json');
    await fs.writeFile(cookieFile, JSON.stringify(cookieData, null, 2));

    console.log('✅ Cookies saved to rumble_cookies.json');
    console.log(`👤 Username: ${username || 'unknown'}`);
    console.log('\n🎉 Success! Restart the relayer to use Rumble authentication');

    browser.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure Brave is running with --remote-debugging-port=9222');
    console.error('2. Make sure you are logged in to Rumble.com');
    console.error('3. Try opening https://rumble.com in your browser first');
    process.exit(1);
  }
}

extractRumbleCookies();
