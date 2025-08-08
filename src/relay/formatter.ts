import { Platform, RelayMessage, Attachment } from '../types';
import { config } from '../config';

export class MessageFormatter {
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getPlatformIcon(platform: Platform, targetPlatform: Platform): string {
    // Check if we have custom emojis configured
    if (config.relay.customEmojis && targetPlatform === Platform.Discord) {
      // For Discord target, use Discord's custom emoji format
      switch (platform) {
        case Platform.Discord:
          if (config.relay.customEmojis.discord) {
            return config.relay.customEmojis.discord; // Should be in format <:name:id>
          }
          break;
        case Platform.Telegram:
          if (config.relay.customEmojis.telegram) {
            return config.relay.customEmojis.telegram;
          }
          break;
        case Platform.Twitch:
          if (config.relay.customEmojis.twitch) {
            return config.relay.customEmojis.twitch;
          }
          break;
      }
    }
    
    // For Telegram target, use colored emoji indicators
    if (targetPlatform === Platform.Telegram) {
      switch (platform) {
        case Platform.Discord:
          return '🔵'; // Blue circle for Discord
        case Platform.Twitch:
          return '🔴'; // Red circle for Twitch
        case Platform.Telegram:
          return '✈️'; // Keep paper plane for Telegram (shouldn't happen in relay)
        default:
          return '💬'; // Default chat bubble
      }
    }
    
    // For Discord target, use colored circles for other platforms
    if (targetPlatform === Platform.Discord) {
      switch (platform) {
        case Platform.Discord:
          return '🎮'; // Gaming controller for Discord
        case Platform.Telegram:
          return '🔵'; // Blue circle for Telegram
        case Platform.Twitch:
          return '🔴'; // Red circle for Twitch
        default:
          return '💬'; // Default chat bubble
      }
    }
    
    // Fallback to colored circles for consistency
    switch (platform) {
      case Platform.Discord:
        return '🔵'; // Blue circle for Discord
      case Platform.Telegram:
        return '🟣'; // Purple circle for Telegram
      case Platform.Twitch:
        return '🔴'; // Red circle for Twitch
      default:
        return '💬'; // Default chat bubble
    }
  }

  formatForPlatform(message: RelayMessage, targetPlatform: Platform, replyInfo?: { author: string; content: string }): string {
    let formattedContent = message.content;
    let author = message.author;

    // Escape HTML for Telegram to prevent formatting issues
    if (targetPlatform === Platform.Telegram) {
      formattedContent = this.escapeHtml(formattedContent);
      author = this.escapeHtml(author);
    }

    if (config.relay.prefixEnabled) {
      // Use emoji icons for Discord and Telegram, keep text for Twitch
      if (targetPlatform === Platform.Twitch) {
        const prefix = `[${message.platform}] ${author}`;
        formattedContent = `${prefix}: ${formattedContent}`;
      } else {
        const icon = this.getPlatformIcon(message.platform, targetPlatform);
        // Add bold formatting for platform tags and usernames based on target platform
        let platformTag = `[${message.platform}]`;
        let formattedAuthor = author;
        
        if (targetPlatform === Platform.Discord) {
          platformTag = `**[${message.platform}]**`; // Markdown bold for Discord
          formattedAuthor = `**${author}**`; // Bold username for Discord
        } else if (targetPlatform === Platform.Telegram) {
          platformTag = `<b>[${message.platform}]</b>`; // HTML bold for Telegram
          formattedAuthor = `<b>${author}</b>`; // Bold username for Telegram
        }
        
        const prefix = `${icon} ${platformTag} ${formattedAuthor}`;
        formattedContent = `${prefix}: ${formattedContent}`;
      }
    }

    // Add reply formatting based on target platform
    if (replyInfo && targetPlatform === Platform.Twitch) {
      // For Twitch, add reply context since it doesn't support real replies
      const replyPreview = replyInfo.content.length > 50 
        ? replyInfo.content.substring(0, 50) + '...' 
        : replyInfo.content;
      formattedContent = `↩️ Replying to ${replyInfo.author}: "${replyPreview}"\n\n${formattedContent}`;
    } else if (replyInfo && targetPlatform === Platform.Discord) {
      // For Discord, only add reply context if we don't have a message reference
      // (handled in sendMessage with reply parameter)
      // This is for native replies that can't be properly linked
      const replyPreview = replyInfo.content.length > 50 
        ? replyInfo.content.substring(0, 50) + '...' 
        : replyInfo.content;
      formattedContent = `↩️ Replying to ${replyInfo.author}: "${replyPreview}"\n\n${formattedContent}`;
    } else if (replyInfo && targetPlatform === Platform.Telegram) {
      // For Telegram, if we don't have a message ID to reply to (native reply),
      // add simplified reply context (no message preview since it's visible above)
      const escapedReplyAuthor = this.escapeHtml(replyInfo.author);
      formattedContent = `↩️ Replying to ${escapedReplyAuthor}\n\n${formattedContent}`;
    }
    // For Telegram with proper message ID, we'll use reply_to_message_id in sendMessage

    // Replace URLs with "(file attachment:unknown)" when sending to Twitch from Discord/Telegram
    if (targetPlatform === Platform.Twitch && 
        (message.platform === Platform.Discord || message.platform === Platform.Telegram)) {
      formattedContent = this.replaceUrlsForTwitch(formattedContent);
    }

    if (message.attachments && message.attachments.length > 0) {
      const attachmentInfo = this.formatAttachments(message.attachments, targetPlatform, message.platform);
      if (attachmentInfo) {
        formattedContent = formattedContent ? `${formattedContent} ${attachmentInfo}` : attachmentInfo;
      }
    }

    // Add (edited) suffix for edited messages
    if (message.isEdit) {
      formattedContent = `${formattedContent} (edited)`;
    }

    return this.truncateMessage(formattedContent, targetPlatform);
  }

  private formatAttachments(attachments: Attachment[], targetPlatform: Platform, sourcePlatform: Platform): string {
    const formattedAttachments = attachments.map(att => {
      switch (att.type) {
        case 'image':
          if (targetPlatform === Platform.Twitch && (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return targetPlatform === Platform.Twitch && att.url ? att.url : '[Image]';
        case 'video':
          if (targetPlatform === Platform.Twitch && (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return targetPlatform === Platform.Twitch && att.url ? att.url : '[Video]';
        case 'file':
          if (targetPlatform === Platform.Twitch && (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return `[File: ${att.filename || 'attachment'}]`;
        case 'sticker':
          // For Discord, don't add to text (will show as attachment)
          if (targetPlatform === Platform.Discord) return '';
          // For Twitch, show emoji if available, otherwise [Sticker]
          if (att.data) {
            const emoji = att.data.toString();
            return emoji || '[Sticker]';
          }
          return '[Sticker]';
        case 'gif':
          if (targetPlatform === Platform.Twitch && (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return targetPlatform === Platform.Twitch && att.url ? att.url : '[GIF]';
        case 'custom-emoji':
          // For Discord/Telegram, don't add to text (will show as attachment)
          if (targetPlatform === Platform.Discord || targetPlatform === Platform.Telegram) return '';
          // For Twitch, just show [emoji] since custom emojis can't be displayed
          return '[emoji]';
        default:
          return '[Attachment]';
      }
    });

    return formattedAttachments.filter(text => text !== '').join(' ');
  }

  private truncateMessage(message: string, platform: Platform): string {
    const maxLengths: Record<Platform, number> = {
      [Platform.Discord]: 2000,
      [Platform.Telegram]: 4096,
      [Platform.Twitch]: 500,
    };

    const maxLength = maxLengths[platform];
    if (message.length <= maxLength) {
      return message;
    }

    const suffix = '... (truncated)';
    return message.substring(0, maxLength - suffix.length) + suffix;
  }

  shouldRelayMessage(message: RelayMessage): boolean {
    if (!message.content && (!message.attachments || message.attachments.length === 0)) {
      return false;
    }

    const commands = ['/relay', '/status', '/help'];
    if (commands.some(cmd => message.content.toLowerCase().startsWith(cmd))) {
      return false;
    }

    if (message.content.startsWith('!') && message.platform === Platform.Twitch) {
      return false;
    }

    return true;
  }

  extractMentions(content: string, platform: Platform): string[] {
    const mentions: string[] = [];

    switch (platform) {
      case Platform.Discord:
        const discordMentions = content.match(/<@!?\d+>/g) || [];
        mentions.push(...discordMentions);
        break;
      case Platform.Telegram:
        const telegramMentions = content.match(/@\w+/g) || [];
        mentions.push(...telegramMentions);
        break;
      case Platform.Twitch:
        const twitchMentions = content.match(/@\w+/g) || [];
        mentions.push(...twitchMentions);
        break;
    }

    return mentions;
  }

  convertMentions(content: string, sourcePlatform: Platform, targetPlatform: Platform): string {
    if (sourcePlatform === targetPlatform) return content;

    const mentions = this.extractMentions(content, sourcePlatform);
    let convertedContent = content;

    mentions.forEach(mention => {
      const username = mention.replace(/[<>!@]/g, '').replace(/^\d+$/, '');
      if (username) {
        convertedContent = convertedContent.replace(mention, `@${username}`);
      }
    });

    return convertedContent;
  }

  private replaceUrlsForTwitch(content: string): string {
    // Regular expression to match URLs
    const urlRegex = /https?:\/\/[^\s]+/gi;
    return content.replace(urlRegex, '(file attachment:unknown)');
  }
}