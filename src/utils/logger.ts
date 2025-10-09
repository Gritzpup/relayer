// SAFE LOGGER - NO WINSTON - CONSOLE ONLY
const timestamp = () => new Date().toISOString();

export const logger = {
  info: (message: string, meta?: any) => {
    try {
      console.log(`${timestamp()} [INFO] ${message}`, meta ? JSON.stringify(meta) : '');
    } catch (e) {
      console.log(`${timestamp()} [INFO] ${message} [meta-error]`);
    }
  },
  error: (message: string, meta?: any) => {
    try {
      console.error(`${timestamp()} [ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
    } catch (e) {
      console.error(`${timestamp()} [ERROR] ${message} [meta-error]`);
    }
  },
  warn: (message: string, meta?: any) => {
    try {
      console.warn(`${timestamp()} [WARN] ${message}`, meta ? JSON.stringify(meta) : '');
    } catch (e) {
      console.warn(`${timestamp()} [WARN] ${message} [meta-error]`);
    }
  },
  debug: (message: string, meta?: any) => {
    try {
      console.log(`${timestamp()} [DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    } catch (e) {
      console.log(`${timestamp()} [DEBUG] ${message} [meta-error]`);
    }
  },
  end: () => { /* no-op */ },
};

// Safe logging functions
export const logInfo = (message: string, meta?: any) => logger.info(message, meta);
export const logError = (message: string, error?: any) => logger.error(message, error);
export const logWarn = (message: string, meta?: any) => logger.warn(message, meta);
export const logDebug = (message: string, meta?: any) => logger.debug(message, meta);

// Platform message logging - simplified
export const logPlatformMessage = (platform: string, direction: 'in' | 'out', message: string, user?: string) => {
  const prefix = direction === 'in' ? '←' : '→';
  const userInfo = user ? ` [${user}]` : '';
  logger.debug(`${prefix} ${platform}${userInfo}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
};

export default logger;