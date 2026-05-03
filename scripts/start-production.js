#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const DELETION_DETECTOR_DIR = path.join(__dirname, '..', 'deletion_detector');
const SESSION_FILE = path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session');
const VENV_DIR = path.join(DELETION_DETECTOR_DIR, 'venv');
const LOCK_FILE = path.join(__dirname, '..', '.relay.lock');
const FIXED_PORT = process.env.WEBHOOK_PORT || 15847; // Use fixed port from .env

const LOG_DIR = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, `relay-${new Date().toISOString().slice(0, 10)}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
function writeLog(line) {
  try {
    const text = stripAnsi(line);
    logStream.write(`[${new Date().toISOString()}] ${text}${text.endsWith('\n') ? '' : '\n'}`);
  } catch (e) { /* ignore */ }
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
  writeLog(`[wrapper] ${message}`);
}

function checkLockFile() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const pid = lockData.pid;
      
      // Check if process is still running
      try {
        process.kill(pid, 0); // This doesn't kill, just checks if process exists
        log(`⚠️  Another instance is already running (PID: ${pid})`, colors.yellow);
        log(`To stop it, run: kill ${pid}`, colors.cyan);
        process.exit(1);
      } catch (e) {
        // Process doesn't exist, remove stale lock file
        log('Removing stale lock file...', colors.yellow);
        fs.unlinkSync(LOCK_FILE);
      }
    } catch (e) {
      // Invalid lock file, remove it
      fs.unlinkSync(LOCK_FILE);
    }
  }
}

function createLockFile() {
  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    started: new Date().toISOString(),
    port: FIXED_PORT
  }));
}

function removeLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {
    // Ignore errors
  }
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function killExistingProcesses() {
  log('🔄 Checking for existing processes...', colors.yellow);

  // Kill orphaned relay by port — the ONLY reliable identifier for orphaned relay
  // (orphaned tsx has no /relayer/ path in cmdline, so cmdline patterns don't work)
  try {
    const { execSync } = require('child_process');
    const portPid = execSync("lsof -ti :15847 2>/dev/null || true").toString().trim();
    if (portPid) {
      log(`  Killing orphaned relay on port 15847 (PID ${portPid})...`, colors.cyan);
      execSync(`kill -9 ${portPid} 2>/dev/null || true`);
    } else {
      log('  No orphaned relay on port 15847', colors.cyan);
    }
  } catch (e) { /* ignore */ }

  // Wait for orphaned relay to fully die and release port
  await new Promise(resolve => setTimeout(resolve, 500));
  // Kill deletion detector
  try {
    log('  Killing deletion detector...', colors.cyan);
    execSync("pkill -9 -f '/relayer/deletion_detector/.*bot' 2>/dev/null || true");
  } catch (e) { /* ignore */ }

  // Wait for deletion detector to FULLY die and release DB locks before starting new one
  // SQLite holds locks until the process exits and the handle is closed
  execSync('sleep 2');

  // Also clean up any stale session journal files that might cause locks
  try {
    execSync("rm -f /mnt/Storage/github/relayer/deletion_detector/sessions/*.session-journal 2>/dev/null || true");
  } catch (e) { /* ignore */ }

  // Wait for processes to die

  // Now check for any remaining processes
  try {
    const psOutput = execSync("ps aux | grep -E 'tsx.*src/index|node.*relay|deletion_detector.*bot' | grep -v grep | awk '{print $2}'", {
      encoding: 'utf8'
    }).trim();

    if (psOutput) {
      const pids = psOutput.split('\n').filter(pid => pid && pid !== process.pid.toString());
      if (pids.length > 0) {
        log(`Found ${pids.length} existing process(es), terminating...`, colors.yellow);
        pids.forEach(pid => {
          try {
            process.kill(parseInt(pid), 'SIGTERM');
            log(`  Sent SIGTERM to PID ${pid}`, colors.cyan);
          } catch (e) {
            // Process might have already exited
          }
        });

        // Give processes time to terminate gracefully
        execSync('sleep 3');

        // Force kill any remaining processes
        pids.forEach(pid => {
          try {
            process.kill(parseInt(pid), 0); // Check if still running
            process.kill(parseInt(pid), 'SIGKILL');
            log(`  Force killed PID ${pid}`, colors.red);
          } catch (e) {
            // Process already exited - good!
          }
        });

        log('✅ Existing processes terminated', colors.green);
      } else {
        log('✅ No existing processes found', colors.green);
      }
    } else {
      log('✅ No existing processes found', colors.green);
    }
  } catch (error) {
    // No processes found or error in ps command - that's fine
    log('✅ No existing processes found', colors.green);
  }
  
  // Clean up any locked database files
  try {
    const sessionFiles = [
      path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session-journal')
    ];
    
    sessionFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        log(`Cleaned up locked database journal: ${path.basename(file)}`, colors.cyan);
      }
    });
  } catch (error) {
    // Ignore errors in cleanup
  }
}

async function checkAndSetupDeletionDetector() {
  log('\n🔍 Checking deletion detector setup...', colors.bright);

  // Check if virtual environment exists
  if (!fs.existsSync(VENV_DIR)) {
    log('📦 Setting up Python virtual environment...', colors.yellow);
    try {
      execSync('python3 -m venv venv', { cwd: DELETION_DETECTOR_DIR, stdio: 'inherit' });
      execSync('./venv/bin/pip install -r requirements.txt', { cwd: DELETION_DETECTOR_DIR, stdio: 'inherit' });
      log('✅ Dependencies installed successfully', colors.green);
    } catch (error) {
      log('❌ Failed to install Python dependencies', colors.red);
      process.exit(1);
    }
  }

  // Check if session file exists
  if (!fs.existsSync(SESSION_FILE)) {
    log('\n🔐 Telegram authentication required for deletion detector', colors.yellow);
    log('Please authenticate manually by running:', colors.bright);
    log(`  cd ${DELETION_DETECTOR_DIR}`, colors.green);
    log('  ./venv/bin/python authenticate.py', colors.green);
    log('', colors.reset);
    log('After authentication, run this command again to start the service.', colors.yellow);
    process.exit(0);
  } else {
    log('✅ Deletion detector is already authenticated', colors.green);
  }
}

async function startServices() {
  log('\n🚀 Starting services...', colors.bright);
  
  // Check if port is available
  const portAvailable = await isPortAvailable(FIXED_PORT);
  if (!portAvailable) {
    log(`❌ Port ${FIXED_PORT} is already in use!`, colors.red);
    log(`Another instance might be running. Check with: lsof -i :${FIXED_PORT}`, colors.yellow);
    process.exit(1);
  }
  
  log(`📡 Using port ${FIXED_PORT} for webhook server`, colors.cyan);
  
  // Set the port as an environment variable
  process.env.WEBHOOK_PORT = FIXED_PORT;

  // Start deletion detector in background
  const deletionDetector = spawn('./venv/bin/python', ['bot.py'], {
    cwd: DELETION_DETECTOR_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WEBHOOK_PORT: FIXED_PORT.toString(),
      WEBHOOK_URL: `http://localhost:${FIXED_PORT}/api/deletion-webhook`
    }
  });

  deletionDetector.stdout.on('data', (data) => {
    process.stdout.write(`${colors.cyan}[Deletion Detector]${colors.reset} ${data}`);
    writeLog(`[deletion-detector] ${data}`);
  });

  deletionDetector.stderr.on('data', (data) => {
    const dataStr = data.toString();
    // Python logging sends INFO/DEBUG to stderr by default
    // Only show as error if it's actually an ERROR or CRITICAL level
    if (dataStr.includes('ERROR') || dataStr.includes('CRITICAL') || dataStr.includes('Traceback')) {
      process.stderr.write(`${colors.red}[Deletion Detector Error]${colors.reset} ${data}`);
    } else if (dataStr.includes('WARNING')) {
      process.stdout.write(`${colors.yellow}[Deletion Detector]${colors.reset} ${data}`);
    } else {
      // INFO, DEBUG, and other logs
      process.stdout.write(`${colors.cyan}[Deletion Detector]${colors.reset} ${data}`);
    }
    writeLog(`[deletion-detector] ${dataStr}`);
  });

  deletionDetector.on('error', (error) => {
    log(`❌ Failed to start deletion detector: ${error.message}`, colors.red);
  });

  // Give deletion detector time to initialize its SQLite databases
  // This prevents database lock conflicts during startup
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Start main relay bot as DETACHED child so it survives wrapper SIGTERM.
  // The relay runs independently; wrapper monitors and can restart it.
  // Relay PPID becomes 1 (init) or tilt's proc manager when wrapper truly exits.
  log('Starting relay service (production mode)...', colors.cyan);
  const relayBot = spawn('/home/ubuntubox/.npm-global/bin/tsx', ['src/index.ts'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WEBHOOK_PORT: FIXED_PORT.toString()
    },
    cwd: __dirname + '/..'
  });

  relayBot.unref(); // Detach from wrapper's lifecycle
  relayBot.stdout.on('data', (data) => process.stdout.write(`${colors.green}[Relay]${colors.reset} ${data}`));
  relayBot.stderr.on('data', (data) => process.stderr.write(`${colors.red}[Relay Error]${colors.reset} ${data}`));
  relayBot.on('error', (err) => log(`Relay failed to start: ${err.message}`, colors.red));
  relayBot.on('exit', (code, signal) => {
    log(`⚠️ Relay exited code=${code} signal=${signal} — will not restart (detached)`, colors.yellow);
  });

  log(`Relay started as detached PID ${relayBot.pid}`, colors.cyan);

  // Handle process termination
  const shutdown = (signal) => {
    // Log caller identity for SIGTERM debugging
    try {
      const { execSync } = require('child_process');
      const parentPid = process.ppid;
      const parentPpid = parseInt(execSync(`cat /proc/${parentPid}/stat 2>/dev/null | awk '{print \$4}'`).toString().trim());
      const parentComm = execSync(`cat /proc/${parentPid}/comm 2>/dev/null`).toString().trim();
      const parentCmd = execSync(`cat /proc/${parentPid}/cmdline 2>/dev/null | tr '\\0' ' '`).toString().trim();
      const grandparentComm = parentPpid ? execSync(`cat /proc/${parentPpid}/comm 2>/dev/null`).toString().trim() : 'unknown';
      log(`⚠️ shutdown signal=${signal} from PID=${parentPid} comm=${parentComm} cmd="${parentCmd.substring(0,100)}" grandparent=${grandparentComm}`, colors.red);
    } catch (e) {
      log(`⚠️ shutdown signal=${signal} from PID=${process.ppid} (details unavailable: ${e.message})`, colors.red);
    }
    
    log(`🛑 Shutting down services (${signal})...`, colors.yellow);
    
    removeLockFile();
    
    // NOTE: relay is NOT detached — it is a child of this wrapper.
    // When this wrapper exits (SIGTERM from tilt), the relay gets reparented
    // to tilt's proc manager and continues running. Do NOT kill relay.
    // Only kill deletion detector, clean up lockfile, then exit.
    
    // Kill deletion detector
    if (deletionDetector && !deletionDetector.killed) {
      log('Stopping deletion detector...', colors.yellow);
      deletionDetector.kill('SIGTERM');
      
      // Force kill if it doesn't stop gracefully
      setTimeout(() => {
        if (!deletionDetector.killed) {
          log('Force killing deletion detector...', colors.red);
          deletionDetector.kill('SIGKILL');
        }
      }, 2000);
    }
    
    // Exit — relay is reparented to tilt's proc manager and keeps running
    log('Wrapper exiting (relay continues under tilt)', colors.cyan);
    setTimeout(() => {
      removeLockFile();
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', removeLockFile);
  process.on('uncaughtException', (err) => {
    log(`Uncaught exception: ${err}`, colors.red);
    removeLockFile();
    process.exit(1);
  });
  
  // Deletion detector exit — log warning but keep wrapper AND relay running
  // The relay core (Discord/Twitch relay) is more important than deletion detection
  // IMPORTANT: do NOT call process.exit() here — the wrapper must keep running
  // so the relay (its child) stays alive under tilt's proc manager
  deletionDetector.on('exit', (code, signal) => {
    log(`⚠️ Deletion detector exited with code ${code}, signal ${signal} — continuing without it`, colors.yellow);
  });
}

async function main() {
  log('🤖 Chat Relay Service with Deletion Detection', colors.bright + colors.cyan);
  log('=' .repeat(50), colors.cyan);
  log('Running in PRODUCTION mode (no auto-restart)', colors.yellow);
  log(`Using fixed port: ${FIXED_PORT}`, colors.cyan);
  log('=' .repeat(50), colors.cyan);

  try {
    // Kill any existing processes first (before lock check, so Tilt restarts work)
    killExistingProcesses();

    // Check for existing instance via lock file (after cleanup)
    checkLockFile();

    // Create lock file for this instance
    createLockFile();
    
    await checkAndSetupDeletionDetector();
    await startServices();
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.red);
    removeLockFile();
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, colors.red);
  removeLockFile();
  process.exit(1);
});