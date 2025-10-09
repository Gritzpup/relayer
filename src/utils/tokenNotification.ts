import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { logger } from './logger';

const execAsync = promisify(exec);

export class TokenNotificationManager {
  private static instance: TokenNotificationManager;
  private checkIntervalId?: NodeJS.Timeout;
  private lastNotificationTime: number = 0;
  private readonly NOTIFICATION_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {}

  public static getInstance(): TokenNotificationManager {
    if (!TokenNotificationManager.instance) {
      TokenNotificationManager.instance = new TokenNotificationManager();
    }
    return TokenNotificationManager.instance;
  }

  public startMonitoring(tokenDataPath: string): void {
    logger.info('Starting Twitch token expiry monitoring...');
    
    // Check immediately
    this.checkTokenExpiry(tokenDataPath);
    
    // Check every 4 hours
    this.checkIntervalId = setInterval(() => {
      this.checkTokenExpiry(tokenDataPath);
    }, 4 * 60 * 60 * 1000);
  }

  public stopMonitoring(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = undefined;
      logger.info('Stopped Twitch token expiry monitoring');
    }
  }

  public async checkTokenExpiry(tokenDataPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const tokenData = JSON.parse(await fs.readFile(tokenDataPath, 'utf-8'));
      
      const expiresAt = tokenData.expires_at;
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;
      const daysUntilExpiry = Math.floor(timeUntilExpiry / (24 * 60 * 60 * 1000));
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / (60 * 60 * 1000));

      // Show notification if token expires in 7 days or less
      if (timeUntilExpiry <= 7 * 24 * 60 * 60 * 1000 && timeUntilExpiry > 0) {
        await this.showExpiryWarning(daysUntilExpiry, hoursUntilExpiry);
      }
      // Show urgent notification if token expires in 24 hours or less
      else if (timeUntilExpiry <= 24 * 60 * 60 * 1000 && timeUntilExpiry > 0) {
        await this.showUrgentWarning(hoursUntilExpiry);
      }
      // Show expired notification if token has expired
      else if (timeUntilExpiry <= 0) {
        await this.showExpiredWarning();
      }

    } catch (error) {
      logger.error('Error checking token expiry:', error);
    }
  }

  private async showExpiryWarning(days: number, hours: number): Promise<void> {
    // Don't spam notifications - only show once per day
    if (Date.now() - this.lastNotificationTime < this.NOTIFICATION_COOLDOWN) {
      return;
    }

    const timeString = days > 0 ? `${days} day(s)` : `${hours} hour(s)`;

    await this.showGUIPopup(
      'Twitch Token Renewal Required',
      `Your Twitch token will expire in ${timeString}.\n\nClick "Renew Now" to generate a fresh token that will last 30+ days.`,
      ['Renew Now', 'Remind Me Later'],
      'warning'
    );

    this.lastNotificationTime = Date.now();
  }

  private async showUrgentWarning(hours: number): Promise<void> {
    await this.showGUIPopup(
      'URGENT: Twitch Token Expiring',
      `Your Twitch token expires in ${hours} hour(s)!\n\nThe chat relayer will stop working if not renewed.\nClick "Renew Now" to fix this immediately.`,
      ['Renew Now', 'Cancel'],
      'error'
    );
  }

  private async showExpiredWarning(): Promise<void> {
    await this.showGUIPopup(
      'Twitch Token EXPIRED',
      'Your Twitch token has expired!\n\nThe chat relayer is currently not working.\nYou need to renew the token immediately to restore service.',
      ['Renew Now'],
      'error'
    );
  }


  private async showGUIPopup(title: string, message: string, buttons: string[], type: 'info' | 'warning' | 'error'): Promise<void> {
    try {
      // Create a zenity dialog for GUI popup on user's display
      const buttonArgs = buttons.map(btn => `--extra-button="${btn}"`).join(' ');
      const iconMap = { info: 'info', warning: 'warning', error: 'error' };
      
      const command = `DISPLAY=:0 zenity --${iconMap[type]} --title="${title}" --text="${message}" --width=400 --height=200 ${buttonArgs}`;
      
      const result = await execAsync(command);
      
      if (result.stdout.trim() === 'Renew Now') {
        await this.launchTokenRenewal();
      }
      
      logger.info(`GUI popup shown: ${title}`);
    } catch (error) {
      // Just open Firefox directly if popup fails
      logger.warn('Popup failed, opening Firefox directly');
      await this.launchTokenRenewal();
    }
  }

  private async fallbackGUIPopup(title: string, message: string): Promise<void> {
    try {
      // Try kdialog for KDE
      const command = `kdialog --title "${title}" --msgbox "${message}"`;
      await execAsync(command);
    } catch (error) {
      // Try xmessage as final fallback
      try {
        const command = `xmessage -center -title "${title}" "${message}"`;
        await execAsync(command);
      } catch (finalError) {
        logger.warn('All GUI popup methods failed, using console notification only');
        console.log(`\n🚨 ${title}\n${message}\n`);
      }
    }
  }

  private async launchTokenRenewal(): Promise<void> {
    try {
      // Use the new integrated token manager approach - just open localhost
      const localUrl = 'http://localhost:3000';
      
      logger.info('🌐 Opening Chrome browser for token renewal...');
      logger.info('The new token manager will handle the authentication flow');
      
      // Just launch the fucking browser normally
      const chromeCommands = [
        `DISPLAY=:0 chromium "${localUrl}"`,
        `DISPLAY=:0 google-chrome "${localUrl}"`,
        `DISPLAY=:0 chrome "${localUrl}"`
      ];
      
      let chromeOpened = false;
      for (const cmd of chromeCommands) {
        try {
          await execAsync(cmd);
          chromeOpened = true;
          logger.info(`Opened Chrome with command: ${cmd}`);
          break;
        } catch (err) {
          // Try next Chrome option
          continue;
        }
      }
      
      if (!chromeOpened) {
        logger.warn('Could not open Chrome automatically');
        console.log(`\n🌐 Please open Chrome and go to:\n${localUrl}\n`);
      }
      
      logger.info('Launched token renewal process - check localhost:3000');
    } catch (error) {
      logger.error('Failed to launch token renewal:', error);
      // Fallback: just show instructions
      await this.showTokenRenewalInstructions();
    }
  }

  private async showTokenRenewalInstructions(): Promise<void> {
    const instructions = `
To renew your Twitch token:

1. The relayer has an integrated token refresh system
2. Go to: http://localhost:3000 in your browser
3. Click "Authorize with Twitch" and log in
4. The relayer will automatically restart with the new token

The new token will last 30+ days.
    `.trim();

    await this.showGUIPopup(
      'Token Renewal Instructions',
      instructions,
      ['OK'],
      'info'
    );
  }

  // Show immediate token refresh notification
  public showTokenRefreshNotification(): void {
    try {
      // Show desktop notification
      this.showGUIPopup(
        'Twitch Token Refresh Required',
        'Your Twitch token has expired and needs to be refreshed.\n\nThe relayer service is waiting for you to complete the authentication process.\n\nPress ENTER in the terminal to start the refresh process.',
        ['OK'],
        'warning'
      ).catch(() => {
        // Fallback to console notification
        console.log('\n🚨 TWITCH TOKEN REFRESH REQUIRED 🚨');
        console.log('Desktop notification failed, but the refresh process is waiting for your input in the terminal.');
      });
    } catch (error) {
      logger.warn('Failed to show desktop notification:', error);
    }
  }
}