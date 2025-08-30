import { logger } from './logger';

export class MemoryMonitor {
  private interval: NodeJS.Timeout | null = null;
  private readonly MB = 1024 * 1024;
  private readonly warningThresholdMB = 500;  // Warn at 500MB
  private readonly criticalThresholdMB = 800; // Critical at 800MB
  
  start(intervalSeconds: number = 60): void {
    // Log initial memory usage
    this.logMemoryUsage();
    
    // Check memory every interval
    this.interval = setInterval(() => {
      this.logMemoryUsage();
      this.checkMemoryThresholds();
    }, intervalSeconds * 1000);
    
    logger.info(`Memory monitoring started (checking every ${intervalSeconds}s)`);
  }
  
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Memory monitoring stopped');
    }
  }
  
  private logMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / this.MB);
    const heapTotalMB = Math.round(memUsage.heapTotal / this.MB);
    const rssMB = Math.round(memUsage.rss / this.MB);
    const externalMB = Math.round(memUsage.external / this.MB);
    
    logger.info(`Memory Usage: Heap: ${heapUsedMB}/${heapTotalMB}MB, RSS: ${rssMB}MB, External: ${externalMB}MB`);
  }
  
  private checkMemoryThresholds(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / this.MB;
    
    if (heapUsedMB > this.criticalThresholdMB) {
      logger.error(`CRITICAL: Memory usage is ${Math.round(heapUsedMB)}MB (threshold: ${this.criticalThresholdMB}MB)`);
      logger.error('Consider restarting the application to prevent out-of-memory errors');
      
      // Force garbage collection if available
      if (global.gc) {
        logger.info('Forcing garbage collection...');
        global.gc();
        
        // Check memory after GC
        setTimeout(() => {
          const afterGC = process.memoryUsage().heapUsed / this.MB;
          logger.info(`Memory after GC: ${Math.round(afterGC)}MB`);
        }, 1000);
      }
    } else if (heapUsedMB > this.warningThresholdMB) {
      logger.warn(`WARNING: Memory usage is ${Math.round(heapUsedMB)}MB (threshold: ${this.warningThresholdMB}MB)`);
    }
  }
  
  getMemoryStats(): {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    percentUsed: number;
  } {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / this.MB;
    const heapTotalMB = memUsage.heapTotal / this.MB;
    const rssMB = memUsage.rss / this.MB;
    const percentUsed = (heapUsedMB / heapTotalMB) * 100;
    
    return {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(heapTotalMB),
      rssMB: Math.round(rssMB),
      percentUsed: Math.round(percentUsed)
    };
  }
}

export const memoryMonitor = new MemoryMonitor();