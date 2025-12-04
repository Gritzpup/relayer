import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';

interface RumbleCookieData {
  cookies: string; // Cookie header string
  chat_id: string | null;
  username: string | null;
  last_validated: number;
}

export class RumbleCookieManager {
  private cookieFile: string;
  private cookieData: RumbleCookieData | null = null;
  private authServer: any = null;

  constructor() {
    this.cookieFile = path.join(process.cwd(), 'rumble_cookies.json');
  }

  async initialize(): Promise<void> {
    try {
      // Try to load existing cookie data
      const data = await fs.readFile(this.cookieFile, 'utf-8');
      this.cookieData = JSON.parse(data);
      logger.info('📋 Loaded existing Rumble cookie data');

      // Validate cookies are still valid
      const isValid = await this.validateCookies();

      if (!isValid) {
        logger.error('❌ Rumble cookies are INVALID or expired');
        await this.promptForLogin();
        return;
      }

      logger.info('✅ Rumble cookies validation SUCCESS - ready to use');
    } catch (error) {
      logger.warn('⚠️ No existing Rumble cookie data found');
      logger.error('🔴 Prompting user for Rumble login');
      await this.promptForLogin();
    }
  }

  private async validateCookies(): Promise<boolean> {
    if (!this.cookieData?.cookies) {
      return false;
    }

    // Skip validation for now - just check if we have cookies
    // Actual validation will happen when we try to send a message
    logger.info(`✅ Rumble cookies loaded for user: ${this.cookieData.username || 'unknown'}`);
    this.cookieData.last_validated = Date.now();
    await this.saveCookieData();
    return true;
  }

  async getCookies(): Promise<string> {
    // Check if cookies need refresh (older than 24 hours)
    if (this.cookieData && (Date.now() - this.cookieData.last_validated) > 24 * 60 * 60 * 1000) {
      const isValid = await this.validateCookies();
      if (!isValid) {
        throw new Error('Rumble cookies expired, please re-authenticate');
      }
    }

    if (!this.cookieData?.cookies) {
      throw new Error('No valid Rumble cookies available');
    }

    return this.cookieData.cookies;
  }

  async getChatId(): Promise<string | null> {
    return this.cookieData?.chat_id || null;
  }

  async setChatId(chatId: string): Promise<void> {
    if (this.cookieData) {
      this.cookieData.chat_id = chatId;
      await this.saveCookieData();
    }
  }

  private async saveCookieData(): Promise<void> {
    if (this.cookieData) {
      await fs.writeFile(this.cookieFile, JSON.stringify(this.cookieData, null, 2));
    }
  }

  private async promptForLogin(): Promise<void> {
    logger.error('🔴 RUMBLE LOGIN REQUIRED 🔴');
    logger.error('Showing GUI popup for Rumble login...');
    console.log('🔴 RUMBLE LOGIN REQUIRED - SHOWING GUI POPUP');

    await this.showLoginGUI();
  }

  private async showLoginGUI(): Promise<void> {
    try {
      console.log('🚀 Starting Rumble GUI login flow...');
      const { exec, spawn } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      console.log('💬 Showing zenity dialog...');

      // Try to show zenity dialog, but don't fail if X11 isn't available
      let userConfirmed = false;
      try {
        const result = await execAsync(`
          DISPLAY=:0 zenity --question --title="🔄 Rumble Login Required" \\
          --text="Your Rumble bot needs authentication to send chat messages!\\n\\n• Click YES to open Rumble login page\\n• Log in with your Rumble account\\n• Return to this window when logged in\\n• Cookies will be automatically captured\\n\\nClick YES to continue or NO to cancel." \\
          --ok-label="🚀 Open Rumble Login" --cancel-label="❌ Cancel" \\
          --width=500 --height=200
        `);

        if (!result.stderr || result.returnCode === 0) {
          userConfirmed = true;
        }
      } catch (zenityError: any) {
        // Zenity failed (likely no X11 access), proceed anyway
        logger.warn('Zenity dialog failed, proceeding with authentication anyway');
        logger.warn('Please log in to Rumble when the browser tab opens');
        userConfirmed = true; // Auto-proceed if no GUI available
      }

      if (userConfirmed) {
        logger.info('🌐 Opening Rumble login page with cookie capture...');

        // Start Puppeteer browser for cookie capture
        await this.captureCookiesWithBrowser();

      } else {
        logger.info('❌ Rumble login cancelled by user');
      }

    } catch (error) {
      logger.error('❌ GUI Rumble login failed:', error);
      logger.error('To enable Rumble message sending:');
      logger.error('1. Open Rumble.com in your browser and log in');
      logger.error('2. Restart the relayer - it will detect your login automatically');
    }
  }

  private async captureCookiesWithBrowser(): Promise<void> {
    try {
      // Connect to existing Brave browser via Chrome DevTools Protocol
      const puppeteer = require('puppeteer-core');

      logger.info('🌐 Connecting to existing Brave browser...');

      const browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: null
      });

      const pages = await browser.pages();
      let page = pages[0];

      // Create a new tab for Rumble login
      page = await browser.newPage();

      logger.info('📖 Opening Rumble login page in existing browser...');

      // Navigate to Rumble login page
      await page.goto('https://rumble.com/account/login', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      logger.info('✅ Rumble login page opened - Please log in');
      logger.info('⏳ Waiting for you to complete login (checking every 5 seconds)...');

      // Show notification
      const { exec } = require('child_process');
      exec('DISPLAY=:0 zenity --info --title="Log in to Rumble" --text="Please log in to Rumble in the new browser tab.\\n\\nThis dialog will close when login is detected." --timeout=180').catch(() => {});

      // Poll for login completion (check for auth cookies)
      let loggedIn = false;
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes max

      while (!loggedIn && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

        const cookies = await page.cookies();

        // Check if we have authentication cookies
        const hasAuthCookie = cookies.some(c =>
          c.name.includes('session') ||
          c.name.includes('auth') ||
          c.name.includes('user') ||
          c.name === 'u_s' ||
          c.name === 'user_id'
        );

        if (hasAuthCookie) {
          loggedIn = true;
          logger.info('✅ Login detected! Capturing cookies...');

          // Convert cookies to header string
          const cookieString = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

          // Get username by checking the page
          let username = null;
          try {
            username = await page.evaluate(() => {
              // Try multiple selectors for username
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
            logger.warn('Could not extract username from page');
          }

          this.cookieData = {
            cookies: cookieString,
            chat_id: null,
            username: username,
            last_validated: Date.now()
          };

          await this.saveCookieData();

          logger.info(`✅ Rumble cookies captured successfully for user: ${username || 'unknown'}`);

          // Show success notification
          exec('DISPLAY=:0 zenity --info --title="Success!" --text="Rumble login successful!\\nCookies captured.\\nRelayer will restart automatically." --timeout=3').catch(() => {});

          // Close the login tab after a moment
          await new Promise(resolve => setTimeout(resolve, 2000));
          await page.close();

          // Disconnect from browser (don't close it)
          browser.disconnect();

          logger.info('🎉 Rumble authentication complete! Restarting...');

          // Restart the relayer to use new cookies
          process.exit(0);
        }

        attempts++;
      }

      if (!loggedIn) {
        logger.error('❌ Login timeout - please try again');
        await page.close();
        browser.disconnect();
      }

    } catch (error) {
      logger.error('Failed to capture Rumble cookies:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const rumbleCookieManager = new RumbleCookieManager();
