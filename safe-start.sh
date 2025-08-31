#!/bin/bash

# Safely start the relayer after checking for locks

DB_FILE="/home/ubuntubox/Documents/Github/relayer/relay_messages.db"
RELAYER_DIR="/home/ubuntubox/Documents/Github/relayer"

cd "$RELAYER_DIR" || exit 1

echo "Checking for existing relayer processes..."

# Check if database is locked
LOCK_INFO=$(lsof "$DB_FILE" 2>/dev/null)

if [ ! -z "$LOCK_INFO" ]; then
    echo "⚠️  Database is currently locked!"
    echo "$LOCK_INFO"
    echo ""
    echo "Another instance of the relayer appears to be running."
    echo "Please run ./check-relayer-lock.sh to manage it first."
    exit 1
fi

# Check for any running relayer processes
RELAYER_PROCS=$(ps aux | grep -E "(tsx|node).*(relayer|index.ts)" | grep -v grep | grep -v safe-start)

if [ ! -z "$RELAYER_PROCS" ]; then
    echo "⚠️  Found existing relayer processes:"
    echo "$RELAYER_PROCS"
    echo ""
    echo "Please stop these processes before starting a new instance."
    exit 1
fi

echo "✅ No conflicts detected, starting relayer..."
echo ""

# Start the relayer based on the argument
case "$1" in
    "dev")
        echo "Starting in development mode with deletion detector..."
        npm run dev
        ;;
    "dev:watch")
        echo "Starting in development mode with file watching..."
        npm run dev:watch
        ;;
    "dev:no-deletion")
        echo "Starting in development mode without deletion detector..."
        npm run dev:no-deletion
        ;;
    "prod" | "production")
        echo "Starting in production mode..."
        npm run start:prod
        ;;
    *)
        echo "Usage: $0 {dev|dev:watch|dev:no-deletion|prod|production}"
        echo ""
        echo "Options:"
        echo "  dev             - Start with deletion detector"
        echo "  dev:watch       - Start with file watching"
        echo "  dev:no-deletion - Start without deletion detector"
        echo "  prod/production - Start in production mode"
        exit 1
        ;;
esac