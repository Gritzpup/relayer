import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import crypto from 'crypto';

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
  private chatBrowser: any = null;
  private chatPage: any = null;
  private chatInitialized: boolean = false;
  private sendQueue: Promise<void> = Promise.resolve();

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

  /**
   * Initialize a persistent headless browser for sending chat messages.
   * Called once during connect, reused for all messages to avoid per-message launch overhead.
   */
  async initializeChatBrowser(streamId: string): Promise<boolean> {
    if (this.chatInitialized && this.chatPage && !this.chatPage.isClosed()) {
      logger.debug('[RUMBLE BROWSER] Chat browser already initialized');
      return true;
    }

    // Use puppeteer-extra with stealth plugin to bypass Cloudflare Turnstile
    const puppeteerExtra = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const puppeteer = require('puppeteer-core');
    puppeteerExtra.addExtra(puppeteer);
    puppeteerExtra.use(StealthPlugin());

    try {
      const cookies = await this.getCookies();
      if (!cookies) {
        logger.error('[RUMBLE BROWSER] No cookies available for browser init');
        return false;
      }

      const username = this.cookieData?.username || 'Gritzpup';

      logger.info('[RUMBLE BROWSER] Launching stealth headless Brave for chat...');

      this.chatBrowser = await puppeteerExtra.launch({
        executablePath: '/usr/bin/brave-browser-stable',
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,720',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      this.chatPage = await this.chatBrowser.newPage();

      // Rumble's "Delete this message" action uses window.confirm(). An
      // unhandled dialog blocks the page's JS thread and makes Puppeteer calls
      // appear to hang forever.
      this.chatPage.on('dialog', async (dialog: any) => {
        const prompt = dialog.message() || '';
        if (dialog.type() === 'confirm' && /delete/i.test(prompt)) {
          logger.info('[RUMBLE BROWSER] Accepting message deletion confirmation');
          await dialog.accept();
        } else {
          logger.warn(`[RUMBLE BROWSER] Dismissing unexpected ${dialog.type()} dialog`);
          await dialog.dismiss();
        }
      });

      // Set cookies on the rumble.com domain
      const cookiePairs = cookies.split('; ').filter(Boolean);
      for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.split('=');
        const value = valueParts.join('=');
        if (name && value) {
          await this.chatPage.setCookie({
            name: name.trim(),
            value: value.trim(),
            domain: '.rumble.com',
            path: '/'
          });
        }
      }

      // Step 1: Navigate to the live page
      const liveUrl = `https://rumble.com/user/${username}/live`;
      logger.info(`[RUMBLE BROWSER] Navigating to ${liveUrl}...`);

      await this.chatPage.goto(liveUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Step 2: Wait for chat input to appear on the live page
      // Chat is rendered inline (no popout needed) - Cloudflare bypass reveals textarea inputs
      logger.info('[RUMBLE BROWSER] Waiting for chat input on live page...');
      await this.waitForChatInput();

      this.chatInitialized = true;
      logger.info('[RUMBLE BROWSER] Chat browser initialized and ready');
      return true;

    } catch (error: any) {
      logger.error('[RUMBLE BROWSER] Failed to initialize chat browser:', error.message);
      await this.closeChatBrowser();
      return false;
    }
  }

  // Chat-specific selectors — matches Rumble's actual chat input.
  // The chat <textarea> has id="chat-message-text-input" and class="chat--input".
  // Ancestor selectors like [class*="chat"] textarea match the COMMENTS textarea
  // because "comments" ancestors wrap it. Use textarea[class*="chat"] to only
  // match textareas whose OWN class contains "chat".
  private readonly CHAT_INPUT_SELECTOR = [
    '#chat-message-text-input',                   // exact ID from Rumble's live chat
    'textarea.chat--input',                       // exact class from Rumble's live chat
    'textarea[class*="chat" i]',                   // textarea whose own class contains "chat"
    '[data-testid="chat-input"]',
  ].join(', ');

  /**
   * Wait for the chat input to appear on the chat popout page.
   * Since we navigate directly to the popout, chat is on the main page (no iframe).
   */
  private async waitForChatInput(): Promise<void> {
    const startTime = Date.now();
    const timeout = 20000;

    while (Date.now() - startTime < timeout) {
      const hasInput = await this.chatPage.evaluate((selector: string) => {
        return !!document.querySelector(selector);
      }, this.CHAT_INPUT_SELECTOR);

      if (hasInput) {
        logger.info('[RUMBLE BROWSER] Chat input found on live page');
        return;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error('Chat input not found after timeout');
  }

  /**
   * Close the persistent chat browser.
   */
  async closeChatBrowser(): Promise<void> {
    this.chatInitialized = false;
    if (this.chatPage) {
      try { await this.chatPage.close(); } catch (e) {}
      this.chatPage = null;
    }
    if (this.chatBrowser) {
      try { await this.chatBrowser.close(); } catch (e) {}
      this.chatBrowser = null;
    }
    logger.info('[RUMBLE BROWSER] Chat browser closed');
  }

  /**
   * Send through the same authenticated endpoint used by rumble.com itself.
   * Running fetch inside the logged-in page preserves Cloudflare/browser state.
   */
  async sendMessageViaApi(message: string, chatId: string, streamId: string): Promise<string | undefined> {
    const previousSend = this.sendQueue;
    let releaseSend!: () => void;
    this.sendQueue = new Promise<void>(resolve => { releaseSend = resolve; });
    await previousSend;

    try {
      if (!/^\d+$/.test(chatId)) {
        logger.error(`[RUMBLE API] Invalid numeric chat id: ${chatId}`);
        return undefined;
      }

      if (!this.chatInitialized || !this.chatPage || this.chatPage.isClosed()) {
        const ok = await this.initializeChatBrowser(streamId);
        if (!ok) return undefined;
      }

      const requestId = crypto.randomBytes(32).toString('base64url');
      const result = await this.chatPage.evaluate(
        async ({ endpoint, requestId, message }: { endpoint: string; requestId: string; message: string }) => {
          const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { accept: '*/*', 'content-type': 'application/json' },
            body: JSON.stringify({
              data: {
                request_id: requestId,
                message: { text: message },
                rant: null,
                channel_id: null,
              },
            }),
          });

          return { ok: response.ok, status: response.status, body: await response.text() };
        },
        {
          endpoint: `https://web7.rumble.com/chat/api/chat/${chatId}/message`,
          requestId,
          message,
        }
      );

      if (!result.ok) {
        logger.error(`[RUMBLE API] Send failed (${result.status}): ${result.body.substring(0, 500)}`);
        return undefined;
      }

      logger.info(`[RUMBLE API] Message accepted (${result.status})`);

      // The public livestream API omits message IDs. The authenticated chat DOM
      // includes the real ID, which is required for moderator deletion.
      await this.chatPage.waitForFunction(
        ({ message, chatId }: { message: string; chatId: string }) => {
          return Array.from(document.querySelectorAll('li.js-chat-history-item'))
            .some((row: Element) =>
              row.getAttribute('data-video-fid') === chatId &&
              row.querySelector('.js-chat-message')?.textContent?.trim() === message
            );
        },
        { timeout: 5000 },
        { message, chatId }
      );

      const messageId = await this.chatPage.evaluate(
        ({ message, chatId }: { message: string; chatId: string }) => {
          const matches = Array.from(document.querySelectorAll('li.js-chat-history-item'))
            .filter((row: Element) =>
              row.getAttribute('data-video-fid') === chatId &&
              row.querySelector('.js-chat-message')?.textContent?.trim() === message
            );
          return matches.at(-1)?.getAttribute('data-message-id') || undefined;
        },
        { message, chatId }
      );

      if (!messageId) {
        logger.error('[RUMBLE API] Message was accepted but its DOM ID was not found');
        return undefined;
      }

      logger.info(`[RUMBLE API] Captured message ID ${messageId}`);
      return messageId;
    } catch (error: any) {
      logger.error('[RUMBLE API] Failed to send message:', error.message);
      return undefined;
    } finally {
      releaseSend();
    }
  }

  async deleteMessageViaBrowser(messageId: string, chatId: string): Promise<boolean> {
    const previousSend = this.sendQueue;
    let releaseSend!: () => void;
    this.sendQueue = new Promise<void>(resolve => { releaseSend = resolve; });

    try {
      logger.info(`[RUMBLE DELETE] Waiting for browser queue for message ${messageId}`);
      await Promise.race([
        previousSend,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('browser queue timeout')), 5000)),
      ]);
      logger.info(`[RUMBLE DELETE] Browser queue acquired for message ${messageId}`);

      if (!this.chatInitialized || !this.chatPage || this.chatPage.isClosed()) {
        logger.error('[RUMBLE DELETE] Chat browser is not initialized');
        return false;
      }

      // This is the exact request issued after selecting "Delete this message"
      // and accepting Rumble's confirmation dialog. The chat DOM keeps a stale
      // row after a successful delete, so the HTTP response is authoritative.
      const result = await this.chatPage.evaluate(
        async ({ messageId, chatId }: { messageId: string; chatId: string }) => {
          const response = await fetch(
            `https://web7.rumble.com/chat/api/chat/${chatId}/message/${messageId}`,
            { method: 'DELETE', credentials: 'include', headers: { accept: '*/*' } }
          );
          return { ok: response.ok, status: response.status, body: await response.text() };
        },
        { messageId, chatId }
      );

      if (!result.ok) {
        logger.error(`[RUMBLE DELETE] Request failed (${result.status}): ${result.body.substring(0, 500)}`);
        return false;
      }

      logger.info(`[RUMBLE DELETE] Deleted message ${messageId} (${result.status})`);
      return true;
    } catch (error: any) {
      logger.error(`[RUMBLE DELETE] Failed to delete message ${messageId}:`, error.message);
      return false;
    } finally {
      releaseSend();
    }
  }

  /**
   * Send a message to Rumble chat using the persistent Puppeteer browser.
   * This bypasses Rumble's broken/missing REST API by typing directly into the chat.
   */
  async sendMessageViaBrowser(message: string, streamId: string): Promise<boolean> {
    try {
      // Initialize browser if not already done
      if (!this.chatInitialized || !this.chatPage || this.chatPage.isClosed()) {
        logger.info('[RUMBLE BROWSER] Chat browser not initialized, initializing now...');
        const ok = await this.initializeChatBrowser(streamId);
        if (!ok) return false;
      }

      // Chat is on the live page (stealth browser bypasses Cloudflare)
      const target = this.chatPage;

      // Focus the chat input by clicking it
      logger.info(`[RUMBLE BROWSER] Sending message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

      // Chat-specific selectors only — generic input[type="text"]/textarea matches
      // Rumble's global search bar, not the actual chat input.
      const inputSelector = this.CHAT_INPUT_SELECTOR;
      
      // Click the input to focus it; do NOT fall back to Tab — Tab would focus
      // the search bar (first in DOM order) and undo the chat-specific fix.
      try {
        await target.click(inputSelector, { timeout: 5000 });
      } catch {
        logger.error('[RUMBLE BROWSER] Chat input not found — selector did not match any element');
        return false;
      }

      // Wait for focus
      await new Promise(r => setTimeout(r, 300));

      // Check if an input-like element is actually focused before Ctrl+A
      const isFocused = await target.evaluate(() => {
        const el = document.activeElement;
        return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.getAttribute('contenteditable') === 'true');
      });

      if (isFocused) {
        // Clear existing text only if an input is focused
        await target.keyboard.down('Control');
        await target.keyboard.press('KeyA');
        await target.keyboard.up('Control');
        await target.keyboard.press('Backspace');
      }

      // Type the message
      await target.keyboard.type(message, { delay: 10 });

      // Small delay before pressing Enter
      await new Promise(r => setTimeout(r, 500));

      // Press Enter to send
      await target.keyboard.press('Enter');

      logger.info('[RUMBLE BROWSER] Message sent via browser!');

      // Brief wait to let the message go through
      await new Promise(r => setTimeout(r, 1000));

      return true;

    } catch (error: any) {
      logger.error('[RUMBLE BROWSER] Failed to send message via browser:', error.message);
      // If the page crashed, reset so next message reinitializes
      if (error.message?.includes('closed') || error.message?.includes('detached')) {
        await this.closeChatBrowser();
      }
      return false;
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
