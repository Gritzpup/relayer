import { logger } from './logger';

export class MemoryMonitor {
  private interval: NodeJS.Timeout | null = null;
  private readonly MB = 1024 * 1024;
  private readonly warningThresholdMB = 200;  // 🔥 MEMORY LEAK FIX: Reduced from 500MB to 200MB
  private readonly criticalThresholdMB = 400; // 🔥 MEMORY LEAK FIX: Reduced from 800MB to 400MB
  private memoryHistory: Array<{timestamp: number, heapUsedMB: number}> = [];
  private readonly MAX_HISTORY = 60; // Keep last 60 readings (1 hour at 1min intervals)
  
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
    
    // 🔥 MEMORY LEAK FIX: Track memory history for trend analysis
    this.memoryHistory.push({
      timestamp: Date.now(),
      heapUsedMB
    });
    
    // Keep only last MAX_HISTORY entries
    if (this.memoryHistory.length > this.MAX_HISTORY) {
      this.memoryHistory.shift();
    }
    
    // 🔥 MEMORY LEAK FIX: Check for memory leak patterns
    this.detectMemoryLeaks();
    
    // Only log memory usage when it's high, not every time
    if (heapUsedMB > this.warningThresholdMB / 2) {
      logger.info(`Memory Usage: Heap: ${heapUsedMB}/${heapTotalMB}MB, RSS: ${rssMB}MB, External: ${externalMB}MB`);
    }
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
  
  // 🔥 MEMORY LEAK FIX: Detect memory leak patterns
  private detectMemoryLeaks(): void {
    if (this.memoryHistory.length < 30) return; // Need at least 30 minutes of data
    
    const recent = this.memoryHistory.slice(-10); // Last 10 minutes
    const older = this.memoryHistory.slice(-30, -20); // 20-30 minutes ago
    
    const recentAvg = recent.reduce((sum, entry) => sum + entry.heapUsedMB, 0) / recent.length;
    const olderAvg = older.reduce((sum, entry) => sum + entry.heapUsedMB, 0) / older.length;
    
    const growthRate = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    // Alert if memory has grown by more than 20% in the last 10 minutes
    if (growthRate > 20) {
      logger.warn(`POTENTIAL MEMORY LEAK DETECTED: Memory grew ${growthRate.toFixed(1)}% in last 10 minutes`);
      logger.warn(`Memory: ${olderAvg.toFixed(1)}MB → ${recentAvg.toFixed(1)}MB`);
      
      // Force garbage collection if available
      if (global.gc) {
        logger.info('Forcing garbage collection due to suspected leak...');
        global.gc();
      }
    }
  }
  
  getMemoryStats(): {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    percentUsed: number;
    historySize: number;
    memoryTrend: string;
  } {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / this.MB;
    const heapTotalMB = memUsage.heapTotal / this.MB;
    const rssMB = memUsage.rss / this.MB;
    const percentUsed = (heapUsedMB / heapTotalMB) * 100;
    
    // Calculate trend
    let memoryTrend = 'stable';
    if (this.memoryHistory.length >= 10) {
      const recent = this.memoryHistory.slice(-5);
      const older = this.memoryHistory.slice(-10, -5);
      const recentAvg = recent.reduce((sum, entry) => sum + entry.heapUsedMB, 0) / recent.length;
      const olderAvg = older.reduce((sum, entry) => sum + entry.heapUsedMB, 0) / older.length;
      const change = ((recentAvg - olderAvg) / olderAvg) * 100;
      
      if (change > 5) memoryTrend = 'increasing';
      else if (change < -5) memoryTrend = 'decreasing';
    }
    
    return {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(heapTotalMB),
      rssMB: Math.round(rssMB),
      percentUsed: Math.round(percentUsed),
      historySize: this.memoryHistory.length,
      memoryTrend
    };
  }
}

export const memoryMonitor = new MemoryMonitor();