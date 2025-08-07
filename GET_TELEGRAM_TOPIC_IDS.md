# Getting Telegram Topic IDs

To complete the channel mapping setup, you need to get the Telegram topic IDs for each topic. Here's how:

## Method 1: Use the Monitor Script

1. Run the monitoring script:
```bash
cd /home/ubuntumain/Documents/Github/relayer
node scripts/monitorTopicIds.js
```

2. Send a test message in each Telegram topic (vent, test, dev, music, art, pets)

3. The script will output the topic ID for each message. Note these down.

## Method 2: Use Telegram's @RawDataBot

1. In your Telegram group, forward a message from each topic to @RawDataBot
2. The bot will reply with raw data including the `message_thread_id`
3. This `message_thread_id` is your topic ID

## Update the Configuration

Once you have all topic IDs, update `/src/config/index.ts`:

```typescript
export const channelMappings: ChannelMappings = {
  'vent': {
    discord: '1401061935604174928',
    telegram: 'TOPIC_ID_HERE'  // Replace with actual ID
  },
  'test': {
    discord: '1402671254896644167',
    telegram: 'TOPIC_ID_HERE'
  },
  // ... etc for all channels
};
```

## Important Notes

- The "General" topic in Telegram doesn't have a topic ID (it's the default)
- If you want to map a channel to General, leave telegram as `null`
- Topic IDs are numbers, but store them as strings in the config

After updating the topic IDs, restart your relay bot and messages will route correctly between Discord channels and Telegram topics!