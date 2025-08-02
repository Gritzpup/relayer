# Deployment Guide

## VPS Deployment (Ubuntu)

### 1. Initial Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Clone the repository
git clone <your-repo-url> ~/chat-relay
cd ~/chat-relay
```

### 2. Configure Environment

```bash
# Copy and edit environment file
cp .env.example .env
nano .env
# Add your credentials
```

### 3. Install Dependencies & Build

```bash
npm install
npm run build
```

### 4. Start with PM2

```bash
# Start the service
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd
# Follow the command it outputs
```

### 5. Alternative: Systemd Service

```bash
# Copy service file
sudo cp chat-relay.service /etc/systemd/system/

# Edit the service file to match your paths
sudo nano /etc/systemd/system/chat-relay.service

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable chat-relay
sudo systemctl start chat-relay

# Check status
sudo systemctl status chat-relay
```

### 6. Monitoring

```bash
# PM2 monitoring
pm2 monit
pm2 logs chat-relay

# Systemd logs
sudo journalctl -u chat-relay -f

# Application logs
tail -f logs/*.log
```

### 7. Updates

```bash
# Stop service
pm2 stop chat-relay
# or
sudo systemctl stop chat-relay

# Pull updates
git pull

# Rebuild and restart
npm install
npm run build
pm2 restart chat-relay
# or
sudo systemctl start chat-relay
```

## Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```