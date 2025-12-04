#!/bin/bash

echo "Fetching current YouTube live chat ID..."
echo ""

# Try different URLs
urls=(
  "https://www.youtube.com/@Gritzpup/live"
  "https://www.youtube.com/channel/UCJ9GH4EvWEDP0g9tTl0n3yw/live"
  "https://www.youtube.com/c/Gritzpup/live"
)

for url in "${urls[@]}"; do
  echo "Checking: $url"
  chat_id=$(curl -s "$url" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" | grep -o '"liveChatId":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  if [ -n "$chat_id" ]; then
    echo "✅ Found chat ID: $chat_id"
    echo ""
    echo "Updating .env file..."
    sed -i "s/YOUTUBE_LIVE_CHAT_ID=.*/YOUTUBE_LIVE_CHAT_ID=$chat_id/" .env
    echo "✅ Updated .env file!"
    echo ""
    echo "Restart relayer with: tilt trigger relayer"
    exit 0
  fi
done

echo "❌ Could not find live chat ID"
echo ""
echo "Possible issues:"
echo "1. Stream is not live"
echo "2. Chat is disabled"
echo "3. Stream is in 'starting' state"
echo ""
echo "Please verify your stream is fully live with chat enabled"
