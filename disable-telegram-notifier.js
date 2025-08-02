// Quick script to comment out Telegram in notifier's .env
const fs = require('fs');
const path = require('path');

const notifierEnvPath = '/home/ubuntumain/Documents/Github/notifier/.env';

if (fs.existsSync(notifierEnvPath)) {
  let content = fs.readFileSync(notifierEnvPath, 'utf8');
  
  // Comment out Telegram token
  content = content.replace(/^(VITE_TELEGRAM_TOKEN=.*)$/m, '# $1');
  
  fs.writeFileSync(notifierEnvPath, content);
  console.log('Telegram disabled in notifier .env');
  console.log('Restart the notifier service for changes to take effect');
}