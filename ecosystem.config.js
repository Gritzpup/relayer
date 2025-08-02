module.exports = {
  apps: [{
    name: 'chat-relay',
    script: './dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    merge_logs: true,
    cron_restart: '0 0 * * *', // Restart daily at midnight
    restart_delay: 5000,
    kill_timeout: 15000,
    listen_timeout: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    exec_mode: 'fork'
  }]
};