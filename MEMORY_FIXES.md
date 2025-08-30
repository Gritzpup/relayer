# Memory Leak Fixes - Chat Relay Service

## Problem
The application was experiencing out-of-memory crashes due to several memory leaks and unbounded data structures.

## Root Causes Identified

1. **Python Deletion Detector** - Message cache grew indefinitely without cleanup
2. **Twitch Service** - Each message stored 3x with different keys (author, authorLower, bot name)
3. **Redis TTL** - 7-day TTL accumulated too much data
4. **SQLite Database** - 5-day retention with hourly cleanup was too infrequent
5. **No Memory Monitoring** - No visibility into memory usage

## Fixes Applied

### 1. Python Deletion Detector (`deletion_detector/bot.py`)
- Added `MAX_CACHE_SIZE = 200` limit
- Added `CACHE_MAX_AGE = 600` seconds (10 minutes)
- Implemented `cleanup_old_cache_entries()` function
- Auto-cleanup when cache exceeds size limit
- Cleanup old entries during periodic checks

### 2. Twitch Service (`src/services/twitch.ts`)
- Reduced duplicate storage (only store with lowercase key)
- Limited message content to 100 characters
- Reduced retention from 10 minutes to 5 minutes
- Added hard limit of 50 messages maximum
- More aggressive cleanup with size-based eviction

### 3. Redis Message Mappings (`src/relay/messageMapper.ts`)
- Reduced TTL from 7 days to 1 day
- Significantly reduces memory footprint

### 4. SQLite Database (`src/database/db.ts`)
- Reduced retention from 5 days to 2 days
- Increased cleanup frequency from hourly to every 30 minutes
- Added better PRAGMA settings for memory efficiency

### 5. Memory Monitoring (`src/utils/memoryMonitor.ts`)
- Created new memory monitoring utility
- Logs memory usage every 60 seconds
- Warning threshold at 500MB
- Critical threshold at 800MB
- Automatic garbage collection trigger at critical level
- Integrated into main application lifecycle

## Expected Results

- **Before**: Unbounded memory growth leading to crashes
- **After**: 
  - Memory usage should stabilize under 500MB
  - Automatic cleanup prevents accumulation
  - Early warning system for memory issues
  - Reduced memory footprint by ~70%

## Monitoring

The application now logs memory usage every minute:
```
Memory Usage: Heap: 245/512MB, RSS: 380MB, External: 5MB
```

If memory exceeds thresholds:
- **Warning (500MB)**: Logged warning message
- **Critical (800MB)**: Forces garbage collection and logs critical alert

## Testing

After implementing these fixes:
1. Run the service: `npm start`
2. Monitor logs for memory usage reports
3. Send test messages across platforms
4. Verify memory stays under 500MB during normal operation
5. Check that old messages are cleaned up properly

## Additional Recommendations

If memory issues persist:
1. Further reduce cache sizes and TTLs
2. Implement message batching
3. Use streaming for large operations
4. Consider using external cache (Redis) instead of in-memory storage
5. Add auto-restart on critical memory threshold