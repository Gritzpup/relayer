# GET YOUR TELEGRAM TOPIC IDs RIGHT NOW

## Method 1: Interactive Script (RECOMMENDED)

1. Run this command:
```bash
node scripts/sendAndCheck.js
```

2. Go to your Telegram group

3. Send a message in EACH topic with the topic name:
   - In "vent" topic: Send "vent"
   - In "test" topic: Send "test"  
   - In "dev" topic: Send "dev"
   - In "music" topic: Send "music"
   - In "art" topic: Send "art"
   - In "pets" topic: Send "pets"

4. The script will show the topic ID for each message

5. Press Ctrl+C when done

## Method 2: Using @RawDataBot

1. Go to your Telegram group
2. Send a message in a topic
3. Forward that message to @RawDataBot
4. Look for `"message_thread_id": NUMBER` in the response
5. That NUMBER is your topic ID

## Method 3: Manual API Check

Run this in your terminal:
```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | grep -o '"message_thread_id":[0-9]*' | sort -u
```

## Update Your Config

Once you have the IDs, update `/src/config/index.ts`:

```typescript
export const channelMappings: ChannelMappings = {
  'vent': {
    discord: '1401061935604174928',
    telegram: 'PUT_TOPIC_ID_HERE'
  },
  'test': {
    discord: '1402671254896644167', 
    telegram: 'PUT_TOPIC_ID_HERE'
  },
  'dev': {
    discord: '1402671075816636546',
    telegram: 'PUT_TOPIC_ID_HERE'
  },
  'music': {
    discord: '1402670920136527902',
    telegram: 'PUT_TOPIC_ID_HERE'
  },
  'art': {
    discord: '1401392870929465384',
    telegram: 'PUT_TOPIC_ID_HERE'
  },
  'pets': {
    discord: '1402671738562674741',
    telegram: 'PUT_TOPIC_ID_HERE'
  }
};
```

## If Topics Don't Exist

If you're not getting topic IDs, your Telegram group might not have topics enabled:

1. Open the group in Telegram
2. Tap the group name at the top
3. Tap "Edit"
4. Enable "Topics" or "Forum"
5. Create topics named: vent, test, dev, music, art, pets

Then try again!