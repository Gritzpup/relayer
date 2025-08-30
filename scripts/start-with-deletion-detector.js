#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const net = require('net');

const DELETION_DETECTOR_DIR = path.join(__dirname, '..', 'deletion_detector');
const SESSION_FILE = path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session');
const VENV_DIR = path.join(DELETION_DETECTOR_DIR, 'venv');

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
}

function getRandomPort(min = 5000, max = 9000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function findAvailablePort() {
  let port;
  let attempts = 0;
  const maxAttempts = 50;
  
  while (attempts < maxAttempts) {
    port = getRandomPort();
    const isAvailable = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
    
    if (isAvailable) {
      return port;
    }
    attempts++;
  }
  
  throw new Error('Could not find an available port after 50 attempts');
}

function killExistingProcesses() {
  log('🔄 Checking for existing processes...', colors.yellow);
  
  try {
    // Kill any existing Node processes running the relay
    const psOutput = execSync("ps aux | grep -E 'tsx.*src/index\\.ts|node.*relay|deletion_detector/bot\\.py' | grep -v grep | awk '{print $2}'", {
      encoding: 'utf8'
    }).trim();
    
    if (psOutput) {
      const pids = psOutput.split('\n').filter(pid => pid);
      if (pids.length > 0) {
        log(`Found ${pids.length} existing process(es), terminating...`, colors.yellow);
        pids.forEach(pid => {
          try {
            process.kill(parseInt(pid), 'SIGTERM');
          } catch (e) {
            // Process might have already exited
          }
        });
        
        // Give processes time to terminate gracefully
        execSync('sleep 2');
        
        // Force kill any remaining processes
        pids.forEach(pid => {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
          } catch (e) {
            // Process might have already exited
          }
        });
        
        log('✅ Existing processes terminated', colors.green);
      }
    }
  } catch (error) {
    // No processes found or error in ps command - that's fine
  }
  
  // Clean up any locked database files
  try {
    const sessionFiles = [
      path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session'),
      path.join(DELETION_DETECTOR_DIR, 'sessions', 'deletion_detector.session-journal')
    ];
    
    sessionFiles.forEach(file => {
      if (fs.existsSync(file + '-journal')) {
        fs.unlinkSync(file + '-journal');
        log(`Cleaned up locked database journal: ${path.basename(file)}-journal`, colors.cyan);
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
    log('This is a one-time setup process.', colors.cyan);
    log('', colors.reset);
    
    log('━'.repeat(60), colors.cyan);
    log('📱 TELEGRAM AUTHENTICATION:', colors.bright + colors.yellow);
    log('━'.repeat(60), colors.cyan);
    log('', colors.reset);
    
    log('The deletion detector needs to authenticate with Telegram to monitor messages.', colors.cyan);
    log('This requires a real Telegram account (not a bot token).', colors.yellow);
    log('', colors.reset);
    
    log('Starting authentication process...', colors.bright);
    log('You will be asked to:', colors.cyan);
    log('  1. Enter your phone number with country code (e.g., +1234567890)', colors.cyan);
    log('  2. Enter the verification code sent to your Telegram app', colors.cyan);
    log('  3. Enter your 2FA password if you have one set', colors.cyan);
    log('', colors.reset);
    
    log('━'.repeat(60), colors.cyan);
    log('', colors.reset);
    
    // Check if we're in an interactive terminal
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
    
    if (isInteractive) {
      // Run authentication script interactively
      try {
        const authPath = path.join(DELETION_DETECTOR_DIR, 'authenticate.py');
        const pythonPath = path.join(VENV_DIR, 'bin', 'python');
        
        log('Starting interactive authentication...', colors.bright);
        log('', colors.reset);
        
        execSync(`${pythonPath} ${authPath}`, { 
          cwd: DELETION_DETECTOR_DIR, 
          stdio: 'inherit'
        });
        
        log('\n✅ Authentication successful!', colors.green);
        log('Continuing to start services...', colors.cyan);
        
        // Give a moment for the session file to be written
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if session was created
        if (!fs.existsSync(SESSION_FILE)) {
          throw new Error('Session file was not created');
        }
      } catch (error) {
        log('\n❌ Authentication failed or was cancelled', colors.red);
        log('Please run the command again when ready to authenticate.', colors.yellow);
        process.exit(1);
      }
    } else {
      // Non-interactive terminal - show manual instructions
      log('⚠️  Cannot run interactive authentication in this environment', colors.yellow);
      log('', colors.reset);
      log('Please authenticate manually by running:', colors.bright);
      log(`  cd ${DELETION_DETECTOR_DIR}`, colors.green);
      log('  ./venv/bin/python authenticate.py', colors.green);
      log('', colors.reset);
      log('After authentication, run this command again to start the service.', colors.yellow);
      process.exit(0);
    }
  } else {
    log('✅ Deletion detector is already authenticated', colors.green);
  }
}

async function startServices() {
  log('\n🚀 Starting services...', colors.bright);
  
  // Find an available random port
  const port = await findAvailablePort();
  log(`📡 Using port ${port} for webhook server`, colors.cyan);
  
  // Set the port as an environment variable
  process.env.WEBHOOK_PORT = port;

  // Start deletion detector in background with the new port
  const deletionDetector = spawn('./venv/bin/python', ['bot.py'], {
    cwd: DELETION_DETECTOR_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WEBHOOK_PORT: port.toString(),
      WEBHOOK_URL: `http://localhost:${port}/api/deletion-webhook`
    }
  });

  deletionDetector.stdout.on('data', (data) => {
    process.stdout.write(`${colors.cyan}[Deletion Detector]${colors.reset} ${data}`);
  });

  deletionDetector.stderr.on('data', (data) => {
    process.stderr.write(`${colors.red}[Deletion Detector Error]${colors.reset} ${data}`);
  });

  deletionDetector.on('error', (error) => {
    log(`❌ Failed to start deletion detector: ${error.message}`, colors.red);
  });

  // Give deletion detector a moment to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start main relay bot with tsx watch and the new port
  const relayBot = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      WEBHOOK_PORT: port.toString()
    }
  });

  // Handle process termination
  const shutdown = (signal) => {
    log(`\n\n🛑 Shutting down services (${signal})...`, colors.yellow);
    
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
    
    // Kill relay bot
    if (relayBot && !relayBot.killed) {
      log('Stopping relay bot...', colors.yellow);
      relayBot.kill('SIGTERM');
    }
    
    // Exit after a short delay
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Also handle deletion detector exit
  deletionDetector.on('exit', (code, signal) => {
    log(`Deletion detector exited with code ${code}, signal ${signal}`, colors.yellow);
    // If deletion detector exits and we're not shutting down, something went wrong
    if (!relayBot.killed && !deletionDetector.killed) {
      log('Deletion detector stopped unexpectedly, shutting down relay bot...', colors.red);
      relayBot.kill();
      process.exit(1);
    }
  });
  
  // Keep the process running
  relayBot.on('close', (code) => {
    log(`Relay bot exited with code ${code}`, colors.yellow);
    if (!deletionDetector.killed) {
      deletionDetector.kill();
    }
    process.exit(code);
  });
}

async function main() {
  log('🤖 Chat Relay Service with Deletion Detection', colors.bright + colors.cyan);
  log('=' .repeat(50), colors.cyan);

  try {
    // Kill any existing processes first
    killExistingProcesses();
    
    await checkAndSetupDeletionDetector();
    await startServices();
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, colors.red);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, colors.red);
  process.exit(1);
});