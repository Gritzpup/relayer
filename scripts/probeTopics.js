const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const groupId = process.env.TELEGRAM_GROUP_ID;

async function probeTopics() {
    console.log('🔍 Probing for Telegram Topic IDs...\n');
    
    const foundTopics = [];
    
    // Topic IDs typically start from 2 (1 is usually General)
    // Let's probe up to 100
    for (let topicId = 1; topicId <= 100; topicId++) {
        try {
            // Try to send a message to this topic
            const message = await bot.sendMessage(groupId, `Probing topic #${topicId}`, {
                message_thread_id: topicId
            });
            
            console.log(`✅ Topic ${topicId} exists! Message sent.`);
            foundTopics.push(topicId);
            
            // Delete the message immediately
            await bot.deleteMessage(groupId, message.message_id);
            
        } catch (error) {
            // Topic doesn't exist or we can't access it
            if (error.response?.body?.description?.includes('message thread not found')) {
                // This is expected for non-existent topics
            } else if (error.response?.body?.description?.includes('TOPIC_CLOSED')) {
                console.log(`🔒 Topic ${topicId} exists but is closed`);
                foundTopics.push(topicId);
            } else if (error.response?.body?.description) {
                // Some other error
                console.log(`❓ Topic ${topicId}: ${error.response.body.description}`);
            }
        }
    }
    
    if (foundTopics.length > 0) {
        console.log(`\n✅ Found ${foundTopics.length} topics: ${foundTopics.join(', ')}\n`);
        
        console.log('🔧 Update your config with these topic IDs:');
        console.log('==========================================\n');
        
        console.log('export const channelMappings: ChannelMappings = {');
        
        const channels = ['vent', 'test', 'dev', 'music', 'art', 'pets'];
        const discordIds = {
            'vent': '1401061935604174928',
            'test': '1402671254896644167',
            'dev': '1402671075816636546',
            'music': '1402670920136527902',
            'art': '1401392870929465384',
            'pets': '1402671738562674741'
        };
        
        channels.forEach((channel, index) => {
            const topicId = foundTopics[index + 1] || foundTopics[index] || 'null'; // Skip topic 1 (general)
            console.log(`  '${channel}': {`);
            console.log(`    discord: '${discordIds[channel]}',`);
            console.log(`    telegram: '${topicId}'`);
            console.log(`  },`);
        });
        console.log('};\n');
        
        console.log('⚠️  IMPORTANT: These are the topic IDs that exist.');
        console.log('   You need to verify which topic corresponds to which channel name!');
        console.log('   Send a test message in each topic to confirm the mapping.\n');
    } else {
        console.log('❌ No topics found!\n');
        console.log('Possible reasons:');
        console.log('1. The group doesn\'t have topics enabled');
        console.log('2. The bot doesn\'t have permission to send messages');
        console.log('3. All topics are closed\n');
    }
}

probeTopics().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});