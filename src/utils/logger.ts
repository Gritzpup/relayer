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
  debug: (_message: string, _meta?: any) => {
    // DEBUG logs disabled to reduce Tilt spam
  },
  end: () => { /* no-op */ },
};

// Safe logging functions
export const logInfo = (message: string, meta?: any) => logger.info(message, meta);
export const logError = (error: Error | unknown, message?: string) => {
  const errMsg = error instanceof Error ? error.message : String(error);
  logger.error(message || errMsg, error);
};
export const logWarn = (message: string, meta?: any) => logger.warn(message, meta);
export const logDebug = (message: string, meta?: any) => logger.debug(message, meta);

// Platform message logging - simplified (disabled to reduce spam)
export const logPlatformMessage = (_platform: string, _direction: 'in' | 'out', _message: string, _user?: string) => {
  // Disabled - was generating excessive DEBUG logs
};

export default logger;