import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  discord: {
    token: string;
    channelId: string;
  };
  telegram: {
    botToken: string;
    groupId: string;
  };
  twitch: {
    username: string;
    oauth: string;
    channel: string;
    clientId?: string;
    useApiForChat?: boolean;
  };
  relay: {
    prefixEnabled: boolean;
    attachmentsEnabled: boolean;
    rateLimitPerMin: number;
    messageHistorySize: number;
    customEmojis?: {
      discord?: string;
      telegram?: string;
      twitch?: string;
    };
  };
  logging: {
    level: string;
    maxFiles: string;
    maxSize: string;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value || defaultValue!;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return num;
}

// Helper function to parse custom emojis
function getCustomEmojis(): Config['relay']['customEmojis'] | undefined {
  const discordEmoji = process.env.CUSTOM_EMOJI_DISCORD;
  const telegramEmoji = process.env.CUSTOM_EMOJI_TELEGRAM;
  const twitchEmoji = process.env.CUSTOM_EMOJI_TWITCH;
  
  if (!discordEmoji && !telegramEmoji && !twitchEmoji) {
    return undefined;
  }
  
  return {
    discord: discordEmoji,
    telegram: telegramEmoji,
    twitch: twitchEmoji,
  };
}

export const config: Config = {
  discord: {
    token: getEnvVar('DISCORD_TOKEN'),
    channelId: getEnvVar('DISCORD_CHANNEL_ID'),
  },
  telegram: {
    botToken: getEnvVar('TELEGRAM_BOT_TOKEN'),
    groupId: getEnvVar('TELEGRAM_GROUP_ID'),
  },
  twitch: {
    username: getEnvVar('TWITCH_USERNAME'),
    oauth: getEnvVar('TWITCH_OAUTH'),
    channel: getEnvVar('TWITCH_CHANNEL'),
    clientId: getEnvVar('TWITCH_CLIENT_ID', ''),
    useApiForChat: getEnvBool('TWITCH_USE_API_FOR_CHAT', true),
  },
  relay: {
    prefixEnabled: getEnvBool('RELAY_PREFIX_ENABLED', true),
    attachmentsEnabled: getEnvBool('RELAY_ATTACHMENTS', true),
    rateLimitPerMin: getEnvNumber('RELAY_RATE_LIMIT', 30),
    messageHistorySize: getEnvNumber('RELAY_HISTORY_SIZE', 100),
    customEmojis: getCustomEmojis(),
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    maxFiles: getEnvVar('LOG_MAX_FILES', '14d'),
    maxSize: getEnvVar('LOG_MAX_SIZE', '20m'),
  },
};

export function validateConfig(): void {
  const requiredVars = [
    'DISCORD_TOKEN',
    'DISCORD_CHANNEL_ID',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_GROUP_ID',
    'TWITCH_USERNAME',
    'TWITCH_OAUTH',
    'TWITCH_CHANNEL',
  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}