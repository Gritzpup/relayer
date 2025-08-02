import { Platform, Attachment } from '../types';
import { logger } from '../utils/logger';

export class MediaConverter {
  // Emoji mappings between platforms
  private emojiMap: Map<string, string> = new Map([
    // Common mappings
    ['LUL', '😂'],
    ['PogChamp', '😮'],
    ['Kappa', '😏'],
    ['4Head', '😄'],
    ['BibleThump', '😢'],
    ['DansGame', '😖'],
    ['Kreygasm', '😩'],
    ['NotLikeThis', '🤦'],
    ['monkaS', '😰'],
    ['pepeLaugh', '😂'],
  ]);

  // Convert Twitch emotes to Unicode emojis
  convertTwitchEmotes(content: string): string {
    let converted = content;
    this.emojiMap.forEach((emoji, emote) => {
      const regex = new RegExp(`\\b${emote}\\b`, 'g');
      converted = converted.replace(regex, emoji);
    });
    return converted;
  }

  // Convert Discord custom emojis to text for Twitch
  convertDiscordEmojis(content: string): string {
    // Convert custom emojis <:name:id> to :name:
    return content.replace(/<:(\w+):\d+>/g, ':$1:');
  }

  // Convert animated emojis
  convertAnimatedEmojis(content: string): string {
    // Convert animated emojis <a:name:id> to :name: (animated)
    return content.replace(/<a:(\w+):\d+>/g, ':$1: (animated)');
  }

  // Process attachments for cross-platform compatibility
  async processAttachments(
    attachments: Attachment[],
    sourcePlatform: Platform,
    targetPlatform: Platform
  ): Promise<Attachment[]> {
    const processed: Attachment[] = [];

    for (const attachment of attachments) {
      if (targetPlatform === Platform.Twitch) {
        // Twitch can only show URLs
        continue;
      }

      if (attachment.type === 'sticker' && targetPlatform === Platform.Discord) {
        // Convert Telegram sticker to image for Discord
        processed.push({
          ...attachment,
          type: 'image',
        });
      } else {
        processed.push(attachment);
      }
    }

    return processed;
  }

  // Format message with emojis for target platform
  formatMessageContent(
    content: string,
    sourcePlatform: Platform,
    targetPlatform: Platform
  ): string {
    let formatted = content;

    // Convert Twitch emotes to Unicode
    if (sourcePlatform === Platform.Twitch) {
      formatted = this.convertTwitchEmotes(formatted);
    }

    // Convert Discord emojis for Twitch
    if (sourcePlatform === Platform.Discord && targetPlatform === Platform.Twitch) {
      formatted = this.convertDiscordEmojis(formatted);
      formatted = this.convertAnimatedEmojis(formatted);
    }

    return formatted;
  }

  // Generate media description for text-only platforms
  generateMediaDescription(attachments: Attachment[]): string {
    if (!attachments || attachments.length === 0) return '';

    const descriptions = attachments.map(att => {
      switch (att.type) {
        case 'image':
          return '[Image]';
        case 'video':
          return '[Video]';
        case 'gif':
          return '[GIF]';
        case 'sticker':
          return '[Sticker]';
        case 'file':
          return `[File: ${att.filename || 'attachment'}]`;
        default:
          return '[Media]';
      }
    });

    return descriptions.join(' ');
  }
}