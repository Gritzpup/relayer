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

  private async checkTokenExpiry(tokenDataPath: string): Promise<void> {
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
      // Create a zenity dialog for GUI popup
      const buttonArgs = buttons.map(btn => `--extra-button="${btn}"`).join(' ');
      const iconMap = { info: 'info', warning: 'warning', error: 'error' };
      
      const command = `zenity --${iconMap[type]} --title="${title}" --text="${message}" --width=400 --height=200 ${buttonArgs}`;
      
      const result = await execAsync(command);
      
      if (result.stdout.trim() === 'Renew Now') {
        await this.launchTokenRenewal();
      }
      
      logger.info(`GUI popup shown: ${title}`);
    } catch (error) {
      // Try alternative GUI methods if zenity fails
      await this.fallbackGUIPopup(title, message);
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
      // Launch the token renewal script
      const scriptPath = path.join(__dirname, '../../scripts/renew-twitch-token.js');
      const command = `gnome-terminal -- node "${scriptPath}"`;
      await execAsync(command);
      logger.info('Launched token renewal process');
    } catch (error) {
      logger.error('Failed to launch token renewal:', error);
      // Fallback: just show instructions
      await this.showTokenRenewalInstructions();
    }
  }

  private async showTokenRenewalInstructions(): Promise<void> {
    const instructions = `
To renew your Twitch token:

1. Open terminal in the relayer directory
2. Run: node scripts/renew-twitch-token.js
3. Follow the instructions to authorize with Twitch
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
}