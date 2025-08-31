export enum Platform {
  Discord = 'Discord',
  Telegram = 'Telegram',
  Twitch = 'Twitch',
}

export interface RelayMessage {
  id: string;
  platform: Platform;
  author: string;
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  raw?: any;
  replyTo?: {
    messageId: string;
    author: string;
    content: string;
    platform?: Platform; // Platform where the original message came from
  };
  isEdit?: boolean;
  originalMessageId?: string;
  channelId?: string;
  channelName?: string;
}

export interface Attachment {
  type: 'image' | 'video' | 'file' | 'sticker' | 'gif' | 'custom-emoji';
  url?: string;
  data?: Buffer;
  filename?: string;
  mimeType?: string;
}

export interface ServiceStatus {
  platform: Platform;
  connected: boolean;
  lastError?: string;
  lastReconnect?: Date;
  messagesSent: number;
  messagesReceived: number;
}

export interface RateLimitInfo {
  platform: Platform;
  messagesInWindow: number;
  windowStart: Date;
  isLimited: boolean;
}

export type MessageHandler = (message: RelayMessage) => Promise<void>;
export type DeleteHandler = (platform: Platform, messageId: string, isAdminDeletion?: boolean) => Promise<void>;

export interface ChannelMapping {
  discord: string;
  telegram: string | null;
}

export interface ChannelMappings {
  [channelName: string]: ChannelMapping;
}

export interface PlatformService {
  platform: Platform;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string, targetChannelId?: string, originalMessage?: RelayMessage): Promise<string | undefined>;
  editMessage(messageId: string, newContent: string): Promise<boolean>;
  deleteMessage(messageId: string, channelId?: string): Promise<boolean>;
  onMessage(handler: MessageHandler): void;
  onDelete(handler: DeleteHandler): void;
  getStatus(): ServiceStatus;
}