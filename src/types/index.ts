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
  };
  isEdit?: boolean;
  originalMessageId?: string;
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

export interface PlatformService {
  platform: Platform;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(content: string, attachments?: Attachment[]): Promise<string | undefined>;
  onMessage(handler: MessageHandler): void;
  getStatus(): ServiceStatus;
}