#!/bin/bash

# Build the project
echo "Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Start the relay service
echo "Starting chat relay service..."
npm start