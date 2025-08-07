const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const groupId = process.env.TELEGRAM_GROUP_ID;

async function getTopicIds() {
    console.log('🔍 Attempting to get Telegram Topic IDs...\n');
    
    try {
        // Get chat info
        const chat = await bot.getChat(groupId);
        console.log('📊 Chat Information:');
        console.log(`- Title: ${chat.title}`);
        console.log(`- Type: ${chat.type}`);
        console.log(`- ID: ${chat.id}`);
        console.log(`- Is Forum: ${chat.is_forum || false}`);
        console.log(`- Has Topics: ${chat.is_forum ? 'Yes' : 'No'}\n`);
        
        if (!chat.is_forum) {
            console.log('⚠️  This group does NOT have topics/forums enabled!');
            console.log('📝 To enable topics:');
            console.log('   1. Open the group in Telegram');
            console.log('   2. Go to group settings');
            console.log('   3. Enable "Topics" or "Forum" mode\n');
            return;
        }
        
        console.log('✅ This is a forum/topic-enabled group!\n');
        
        // Try to get recent messages to find topic IDs
        console.log('📨 Checking recent bot updates for topic information...\n');
        
        // Get updates (this might show recent messages)
        const updates = await bot.getUpdates({ limit: 100 });
        
        const topicInfo = new Map();
        const seenTopics = new Set();
        
        for (const update of updates) {
            if (update.message && update.message.chat.id == groupId) {
                const msg = update.message;
                const threadId = msg.message_thread_id;
                
                if (threadId && !seenTopics.has(threadId)) {
                    seenTopics.add(threadId);
                    console.log(`Found Topic ID: ${threadId}`);
                    
                    // Check if this is a topic creation message
                    if (msg.forum_topic_created) {
                        topicInfo.set(threadId, msg.forum_topic_created.name);
                        console.log(`  → Topic Name: ${msg.forum_topic_created.name}`);
                    } else if (msg.reply_to_message && msg.reply_to_message.forum_topic_created) {
                        topicInfo.set(threadId, msg.reply_to_message.forum_topic_created.name);
                        console.log(`  → Topic Name: ${msg.reply_to_message.forum_topic_created.name}`);
                    } else {
                        console.log(`  → Topic Name: Unknown (send a message in this topic to identify)`);
                    }
                    console.log(`  → Last message: "${msg.text || '[Media]'}"`);
                    console.log(`  → From: ${msg.from?.username || msg.from?.first_name || 'Unknown'}\n`);
                }
            }
        }
        
        if (seenTopics.size === 0) {
            console.log('❌ No topic IDs found in recent updates.\n');
            console.log('🔧 To get topic IDs, try one of these methods:\n');
            console.log('Method 1: Send test messages');
            console.log('  1. Run: node scripts/monitorTopicIds.js');
            console.log('  2. Send a message in each topic (vent, test, dev, music, art, pets)');
            console.log('  3. The script will show the topic ID for each message\n');
            
            console.log('Method 2: Use @RawDataBot');
            console.log('  1. In your Telegram group, send a message in a topic');
            console.log('  2. Forward that message to @RawDataBot');
            console.log('  3. Look for "message_thread_id" in the response\n');
            
            console.log('Method 3: Manual inspection');
            console.log('  1. Send this in each topic: /start@' + (await bot.getMe()).username);
            console.log('  2. Then run this script again\n');
        } else {
            console.log('\n📋 Summary of Found Topics:');
            console.log('========================');
            topicInfo.forEach((name, id) => {
                console.log(`Topic "${name || 'Unknown'}": ${id}`);
            });
            
            console.log('\n🔧 Update your config with these IDs:');
            console.log('=====================================');
            console.log(`export const channelMappings: ChannelMappings = {`);
            
            // Try to match topic names with channel names
            const channelNames = ['vent', 'test', 'dev', 'music', 'art', 'pets'];
            channelNames.forEach(channelName => {
                let topicId = 'null';
                topicInfo.forEach((name, id) => {
                    if (name && name.toLowerCase().includes(channelName)) {
                        topicId = `'${id}'`;
                    }
                });
                console.log(`  '${channelName}': { discord: '...', telegram: ${topicId} },`);
            });
            console.log(`};\n`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        if (error.message.includes('chat not found')) {
            console.log('\n⚠️  Make sure:');
            console.log('  1. The bot is added to the group');
            console.log('  2. The TELEGRAM_GROUP_ID in .env is correct');
            console.log(`  3. Current group ID: ${groupId}`);
        }
    }
}

// Also listen for any incoming messages while the script runs
bot.on('message', (msg) => {
    if (msg.chat.id == groupId && msg.message_thread_id) {
        console.log(`\n🔔 Live Update - Topic ID Found: ${msg.message_thread_id}`);
        if (msg.forum_topic_created) {
            console.log(`   Topic Name: ${msg.forum_topic_created.name}`);
        }
        console.log(`   Message: ${msg.text || '[Media]'}`);
        console.log(`   From: ${msg.from?.username || msg.from?.first_name}\n`);
    }
});

// Start polling to catch live messages
bot.startPolling();

// Run the main function
getTopicIds().then(() => {
    console.log('\n💡 Tip: Keep this script running and send messages in each topic to see their IDs!\n');
    console.log('Press Ctrl+C to stop.\n');
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('\nStopping...');
    bot.stopPolling();
    process.exit(0);
});