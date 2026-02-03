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

  private toUnicodeBold(text: string): string {
    // Convert regular text to Unicode mathematical bold characters for Twitch
    const boldMap: { [key: string]: string } = {
      'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 
      'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑',
      'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
      'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡', 'i': '𝐢',
      'j': '𝐣', 'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧', 'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫',
      's': '𝐬', 't': '𝐭', 'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳',
      '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
    };
    
    return text.split('').map(char => boldMap[char] || char).join('');
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
        case Platform.Rumble:
          if (config.relay.customEmojis.rumble) {
            return config.relay.customEmojis.rumble;
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
          return '🟣'; // Purple circle for Twitch
        case Platform.Kick:
          return '🟢'; // Green circle for Kick
        case Platform.YouTube:
          return '🔴'; // Red circle for YouTube
        case Platform.Rumble:
          return '🟢'; // Dark green circle for Rumble
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
        case Platform.Kick:
          return '🟢'; // Green circle for Kick
        case Platform.YouTube:
          return '🔴'; // Red circle for YouTube
        case Platform.Rumble:
          return '🟢'; // Dark green circle for Rumble
        default:
          return '💬'; // Default chat bubble
      }
    }

    // For Twitch target, use colored circles
    if (targetPlatform === Platform.Twitch) {
      switch (platform) {
        case Platform.Discord:
          return '🔴'; // Red circle for Discord
        case Platform.Telegram:
          return '🔵'; // Blue circle for Telegram
        case Platform.Kick:
          return '🟢'; // Green circle for Kick
        case Platform.YouTube:
          return '🔴'; // Red circle for YouTube
        case Platform.Rumble:
          return '🎬'; // Movie camera for Rumble
        case Platform.Twitch:
          return '🎮'; // Gaming controller for Twitch (shouldn't happen in relay)
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
      case Platform.Kick:
        return '🟢'; // Green circle for Kick
      case Platform.YouTube:
        return '🔴'; // Red circle for YouTube
      case Platform.Rumble:
        return '🎬'; // Movie camera for Rumble
      default:
        return '💬'; // Default chat bubble
    }
  }

  formatForPlatform(message: RelayMessage, targetPlatform: Platform, replyInfo?: { author: string; content: string; platform?: Platform }): string {
    let formattedContent = message.content;
    let author = message.author;

    // Escape HTML for Telegram to prevent formatting issues
    if (targetPlatform === Platform.Telegram) {
      formattedContent = this.escapeHtml(formattedContent);
      author = this.escapeHtml(author);
    }

    if (config.relay.prefixEnabled) {
      // Use emoji icons for all platforms
      const icon = this.getPlatformIcon(message.platform, targetPlatform);

      if (targetPlatform === Platform.Twitch) {
        // Twitch: Use Unicode bold characters for platform tags and usernames
        const boldPlatformTag = this.toUnicodeBold(`[${message.platform}]`);
        const boldAuthor = this.toUnicodeBold(author);
        const prefix = `${icon} ${boldPlatformTag} ${boldAuthor}`;
        formattedContent = `${prefix}: ${formattedContent}`;
      } else if (targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) {
        // Kick/YouTube: Use simple formatting without emojis (limited rich formatting support)
        const prefix = `[${message.platform}] ${author}`;
        formattedContent = `${prefix}: ${formattedContent}`;
      } else {
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
      // Include platform emoji and indicator for cross-platform replies with Unicode bold
      let replyAuthor = this.toUnicodeBold(replyInfo.author);
      if (replyInfo.platform) {
        const replyIcon = this.getPlatformIcon(replyInfo.platform, targetPlatform);
        const boldPlatformTag = this.toUnicodeBold(`[${replyInfo.platform}]`);
        replyAuthor = `${replyIcon} ${boldPlatformTag} ${replyAuthor}`;
      }
      formattedContent = `↩️ Replying to ${replyAuthor}\n\n${formattedContent}`;
    } else if (replyInfo && targetPlatform === Platform.Kick) {
      // For Kick, add simple reply context without emojis
      let replyAuthor = replyInfo.author;
      if (replyInfo.platform) {
        replyAuthor = `[${replyInfo.platform}] ${replyAuthor}`;
      }
      formattedContent = `Replying to ${replyAuthor}: ${formattedContent}`;
    } else if (replyInfo && targetPlatform === Platform.Discord) {
      // For Discord, add reply context when we have replyInfo
      // This happens when source is Twitch or when we can't link as native reply
      // Include platform emoji and formatting for cross-platform replies
      let formattedReplyAuthor = replyInfo.author;
      if (replyInfo.platform) {
        const replyIcon = this.getPlatformIcon(replyInfo.platform, targetPlatform);
        formattedReplyAuthor = `${replyIcon} **[${replyInfo.platform}]** **${replyInfo.author}**`;
      } else {
        // If no platform specified, but the author is being replied to, show just bold name
        formattedReplyAuthor = `**${replyInfo.author}**`;
      }
      formattedContent = `↩️ Replying to ${formattedReplyAuthor}\n\n${formattedContent}`;
    } else if (replyInfo && targetPlatform === Platform.Telegram) {
      // For Telegram, add reply context when we have replyInfo
      // This happens when source is Twitch or when we can't link as native reply
      let formattedReplyAuthor = this.escapeHtml(replyInfo.author);
      if (replyInfo.platform) {
        const replyIcon = this.getPlatformIcon(replyInfo.platform, targetPlatform);
        const escapedPlatform = this.escapeHtml(replyInfo.platform);
        formattedReplyAuthor = `${replyIcon} <b>[${escapedPlatform}]</b> <b>${formattedReplyAuthor}</b>`;
      } else {
        // If no platform specified, but the author is being replied to, show just bold name
        formattedReplyAuthor = `<b>${formattedReplyAuthor}</b>`;
      }
      formattedContent = `↩️ Replying to ${formattedReplyAuthor}\n\n${formattedContent}`;
    }
    // For Telegram with proper message ID, we'll use reply_to_message_id in sendMessage

    // Replace URLs with "(file attachment:unknown)" when sending to Twitch/Kick/YouTube from Discord/Telegram
    if ((targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) &&
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
          if ((targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) &&
              (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return (targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) && att.url ? att.url : '[Image]';
        case 'video':
          if ((targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) &&
              (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return (targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) && att.url ? att.url : '[Video]';
        case 'file':
          if ((targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) &&
              (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return `[File: ${att.filename || 'attachment'}]`;
        case 'sticker':
          // For Discord, don't add to text (will show as attachment)
          if (targetPlatform === Platform.Discord) return '';
          // For Twitch, Kick, and Telegram, show sticker name if available
          if (att.data) {
            const stickerName = att.data.toString();
            return `[Sticker: ${stickerName}]`;
          }
          return '[Sticker]';
        case 'gif':
          if ((targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) &&
              (sourcePlatform === Platform.Discord || sourcePlatform === Platform.Telegram)) {
            return '(file attachment:unknown)';
          }
          return (targetPlatform === Platform.Twitch || targetPlatform === Platform.Kick || targetPlatform === Platform.YouTube) && att.url ? att.url : '[GIF]';
        case 'custom-emoji':
          // For Discord/Telegram, don't add to text (will show as attachment)
          if (targetPlatform === Platform.Discord || targetPlatform === Platform.Telegram) return '';
          // For Twitch, Kick, and YouTube, just show [emoji] since custom emojis can't be displayed
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
      [Platform.Twitch]: 10000, // Twitch service handles splitting, so we allow longer messages
      [Platform.Kick]: 500, // Kick has a 500 character limit for chat messages
      [Platform.YouTube]: 200, // YouTube live chat has a 200 character limit
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