# Database Lock Management

## Issue
The relayer database (`relay_messages.db`) can become locked when:
- Multiple instances of the relayer are running
- A previous instance crashed without properly releasing the lock
- The relayer is running in a terminal session (like VSCodium) that you forgot about

## Solution

### Helper Scripts

1. **check-relayer-lock.sh** - Check if the database is locked and optionally kill the locking process
   ```bash
   ./check-relayer-lock.sh
   ```

2. **safe-start.sh** - Safely start the relayer after checking for conflicts
   ```bash
   # Development mode with deletion detector
   ./safe-start.sh dev
   
   # Development mode with file watching
   ./safe-start.sh dev:watch
   
   # Development mode without deletion detector
   ./safe-start.sh dev:no-deletion
   
   # Production mode
   ./safe-start.sh prod
   ```

## What Happened

The database was locked because there was a Node.js process (PID 131904) running `tsx src/index.ts` in a VSCodium terminal session (pts/6). This was likely started manually and forgotten about.

## Prevention

1. **Always use safe-start.sh** instead of directly running npm commands
2. **Check for locks** before starting: `./check-relayer-lock.sh`
3. **Be aware of terminal sessions** - Check all open terminals in VSCodium/VSCode
4. **Use process managers carefully** - If using pm2, make sure to stop processes properly

## Quick Commands

```bash
# Check what's using the database
lsof relay_messages.db

# Find all relayer processes
ps aux | grep -i relayer | grep -v grep

# Kill a specific process
kill <PID>

# Force kill if needed
kill -9 <PID>
```

## Best Practices

1. Only run one instance of the relayer at a time
2. Use the provided scripts for starting/stopping
3. If you need to run multiple instances (rare), use different database files
4. Always properly stop the relayer before starting a new instance