import { logger } from './logger';

export interface ReconnectOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  factor?: number;
  onReconnect?: () => void;
}

export class ReconnectManager {
  private retryCount: number = 0;
  private currentDelay: number;
  private reconnectTimer?: NodeJS.Timeout;
  private isReconnecting: boolean = false;
  
  constructor(
    private serviceName: string,
    private connectFn: () => Promise<void>,
    private options: ReconnectOptions = {}
  ) {
    this.currentDelay = options.initialDelay || 1000;
  }
  
  async connect(): Promise<void> {
    try {
      await this.connectFn();
      this.reset();
      logger.info(`${this.serviceName} connected successfully`);
    } catch (error) {
      logger.error(`${this.serviceName} connection failed`, error);
      await this.scheduleReconnect();
    }
  }
  
  async scheduleReconnect(): Promise<void> {
    if (this.isReconnecting) return;
    
    const maxRetries = this.options.maxRetries || Infinity;
    if (this.retryCount >= maxRetries) {
      logger.error(`${this.serviceName} max reconnection attempts reached`);
      return;
    }
    
    this.isReconnecting = true;
    this.retryCount++;
    
    logger.info(`${this.serviceName} reconnecting in ${this.currentDelay}ms (attempt ${this.retryCount})`);
    
    this.reconnectTimer = setTimeout(async () => {
      this.isReconnecting = false;
      
      if (this.options.onReconnect) {
        this.options.onReconnect();
      }
      
      try {
        await this.connectFn();
        this.reset();
        logger.info(`${this.serviceName} reconnected successfully`);
      } catch (error) {
        logger.error(`${this.serviceName} reconnection failed`, error);
        this.increaseDelay();
        await this.scheduleReconnect();
      }
    }, this.currentDelay);
  }
  
  private increaseDelay(): void {
    const factor = this.options.factor || 2;
    const maxDelay = this.options.maxDelay || 60000;
    this.currentDelay = Math.min(this.currentDelay * factor, maxDelay);
  }
  
  private reset(): void {
    this.retryCount = 0;
    this.currentDelay = this.options.initialDelay || 1000;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
  
  stop(): void {
    this.reset();
  }
}

export function withReconnect<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  serviceName: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error(`${serviceName} operation failed, will attempt reconnection`, error);
      throw error;
    }
  }) as T;
}