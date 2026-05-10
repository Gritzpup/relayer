#!/bin/bash

# Relayer health check script
# Returns 0 (success) when relayer is healthy or degraded (core services working)
# Core services: Discord and Telegram relay functionality

RESPONSE=$(curl -s http://localhost:18421/health)

# Pass if response contains 'healthy' or 'degraded' (means core services are working)
# Only fail if neither is found
if echo "$RESPONSE" | grep -qE '"status"\s*:\s*"(healthy|degraded)"'; then
    exit 0
else
    exit 1
fi