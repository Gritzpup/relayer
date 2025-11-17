#!/bin/bash

# Relayer health check script
# Returns 0 (success) when relayer is healthy or degraded (core services working)
# Core services: Discord and Telegram relay functionality

RESPONSE=$(curl -s http://localhost:5847/health)
STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null)

# Pass if status is 'healthy' or 'degraded' (means core services are working)
# Only fail on 'unhealthy' or 'error'
if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "degraded" ]; then
    exit 0
else
    exit 1
fi