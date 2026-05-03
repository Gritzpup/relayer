#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const DELETION_DETECTOR_DIR = path.join(__dirname, '..', 'deletion_detector');
const SESSION_FILE = path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session');
const VENV_DIR = path.join(DELETION_DETECTOR_DIR, 'venv');
const LOCK_FILE = path.join(__dirname, '..', '.relay.lock');
const FIXED_PORT = process.env.WEBHOOK_PORT || 18421; // Isolated port for relayer only

const LOG_DIR = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, `relay-${new Date().toISOString().slice(0, 10)}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const SIGKILL_TRACE_FILE = path.join(LOG_DIR, 'sigkill-trace.log');
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
function writeLog(line) {
  try {
    const text = stripAnsi(line);
    logStream.write(`[${new Date().toISOString()}] ${text}${text.endsWith('\n') ? '' : '\n'}`);
  } catch (e) { /* ignore */ }
}

// Synchronous SIGKILL trace — writes directly to disk before any async work
function traceSigkillToFile(targetPid, relayPid) {
  try {
    const entries = [];
    let pid = targetPid || relayPid;
    for (let i = 0; i < 5; i++) {
      if (!pid || pid === '0' || pid === '1') break;
      let comm = '', cmdline = '', ppid = '';
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const parts = stat.split(' ');
        ppid = parts[3] || '';
        comm = parts[1] || '';
      } catch (e) { ppid = '?'; }
      try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').substring(0, 150); } catch (e) {}
      entries.push({ pid, comm, ppid, cmdline });
      pid = ppid;
    }
    const trace = `SIGKILL TRACE ${new Date().toISOString()} target=${targetPid} relay=${relayPid} chain=${JSON.stringify(entries)}\n`;
    fs.writeFileSync(SIGKILL_TRACE_FILE, trace, { flag: 'a' });
  } catch (e) {
    fs.writeFileSync(SIGKILL_TRACE_FILE, `SIGKILL TRACE FAILED: ${e.message}\n`, { flag: 'a' });
  }
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

  // Kill any process holding port 15847 (orphaned relay) — uses lsof after fuser kills them
  // Kill any process holding the relay port (orphaned relay)
  try {
    log(`  Checking port ${FIXED_PORT}...`, colors.cyan);
    const portPid = execSync(`lsof -ti :${FIXED_PORT} 2>/dev/null || true`).toString().trim();
    if (portPid) {
      log(`  Port ${FIXED_PORT} in use by PID ${portPid}, waiting...`, colors.yellow);
    } else {
      log(`  Port ${FIXED_PORT} is free`, colors.green);
    }
  } catch (e) { /* ignore lsof errors */ }

  // Wait for TIME_WAIT socket to clear
  log(`  Waiting for port ${FIXED_PORT} to be released...`, colors.cyan);
  for (let i = 0; i < 30; i++) {
    const portPid = execSync(`lsof -ti :${FIXED_PORT} 2>/dev/null || true`).toString().trim();
    if (!portPid) {
      log(`  Port ${FIXED_PORT} is now free (waited ${(i+1)*2}s)`, colors.green);
      break;
    }
    if (i === 0) log(`  Port still held by PID ${portPid}, waiting...`, colors.yellow);
  }

  // Kill deletion detector + relay tsx processes (only relay-specific, not all tsx)
  try {
    log('  Killing deletion detector...', colors.cyan);
    execSync("pkill -9 -f '/relayer/deletion_detector/.*bot' 2>/dev/null || true");
    log('  Killing orphaned relay tsx...', colors.cyan);
    execSync("pkill -9 -f 'tsx.*src/index.*relay' 2>/dev/null || true");
  } catch (e) { /* ignore */ }

  // Wait for processes to die and release locks
  execSync('sleep 2');

  // Clean up any stale session journal files that might cause locks
  try {
    execSync("rm -f /mnt/Storage/github/relayer/deletion_detector/sessions/*.session-journal 2>/dev/null || true");
  } catch (e) { /* ignore */ }

  // Now check for any remaining relay-specific processes only
  try {
    const psOutput = execSync("ps aux | grep -E '/mnt/Storage/github/relayer.*tsx.*src/index|/mnt/Storage/github/relayer.*deletion_detector.*bot' | grep -v grep | awk '{print $2}'", {
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

  // Start main relay bot as child of wrapper.
  // Relay handles SIGTERM gracefully (no self-kill) so it survives wrapper death.
  // Relay becomes orphaned to tilt's proc manager when wrapper exits.
  log('Starting relay service (production mode)...', colors.cyan);
  // Use node directly with tsx loader — avoids tsx CLI preflight issues
  const relayBot = spawn('/usr/bin/node', [
    '--require', '/home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/preflight.cjs',
    '--import', 'file:///home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/loader.mjs',
    'src/index.ts'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WEBHOOK_PORT: FIXED_PORT.toString()
    },
    cwd: __dirname + '/..'
  });

  relayBot.stdout.on('data', (data) => process.stdout.write(`${colors.green}[Relay]${colors.reset} ${data}`));
  relayBot.stderr.on('data', (data) => process.stderr.write(`${colors.red}[Relay Error]${colors.reset} ${data}`));
  relayBot.on('error', (err) => log(`Relay failed to start: ${err.message}`, colors.red));
  relayBot.on('exit', (code, signal) => {
    // Synchronous file trace FIRST — child's /proc still valid at this point
    // relayBot.pid = tsx preflight, child tsx forked is what actually got killed
    const tsxPid = relayBot.pid;
    traceSigkillToFile(tsxPid, relayBot.pid);

    // SIGKILL tracing — find who killed the relay
    if (signal === 'SIGKILL') {
      try {
        const { execSync } = require('child_process');
        const targetPid = tsxPid || relayBot.pid;
        const killerPpid = execSync(`cat /proc/${targetPid}/stat 2>/dev/null | awk '{print \$4}'`).toString().trim();
        const killerComm = killerPpid ? execSync(`cat /proc/${killerPpid}/comm 2>/dev/null`).toString().trim() : 'unknown';
        const killerCmd = killerPpid ? execSync(`cat /proc/${killerPpid}/cmdline 2>/dev/null | tr '\\\\0' ' '`).toString().trim().substring(0, 100) : '';
        log(`🚨 SIGKILL source: relay_pid=${targetPid} sender_ppid=${killerPpid} sender_comm="${killerComm}" sender_cmd="${killerCmd}"`, colors.red);
      } catch (e) {
        log(`🚨 SIGKILL on relay PID ${relayBot.pid} (async trace failed: ${e.message})`, colors.red);
      }
    } else {
      log(`⚠️ Relay exited code=${code} signal=${signal}`, colors.red);
    }
    // Auto-restart relay if it dies unexpectedly (except SIGKILL which indicates external kill)
    if (signal !== 'SIGKILL' && !relayBot.killed) {
      log(`🔄 Restarting relay in 3s...`, colors.yellow);
      setTimeout(() => {
        try {
          const newRelay = spawn('/usr/bin/node', [
            '--require', '/home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/preflight.cjs',
            '--import', 'file:///home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/loader.mjs',
            'src/index.ts'
          ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, WEBHOOK_PORT: FIXED_PORT.toString() },
            cwd: __dirname + '/..'
          });
          newRelay.stdout.on('data', (data) => process.stdout.write(`${colors.green}[Relay]${colors.reset} ${data}`));
          newRelay.stderr.on('data', (data) => process.stderr.write(`${colors.red}[Relay Error]${colors.reset} ${data}`));
          newRelay.on('exit', (c, s) => relayBot.emit('exit', c, s));
          relayBot = newRelay;
          log(`🔄 Relay restarted as PID ${newRelay.pid}`, colors.green);
        } catch (e) {
          log(`❌ Relay restart failed: ${e.message}`, colors.red);
        }
      }, 3000);
    }
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
  // Wrapper-level SIGKILL trace — write trace before exiting
  process.on('SIGKILL', () => {
    traceSigkillToFile(process.pid, process.pid);
  });
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