const axios = require('axios');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const groupId = process.env.TELEGRAM_GROUP_ID;

async function makeApiCall(method, params = {}) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    try {
        const response = await axios.post(url, params);
        return response.data;
    } catch (error) {
        console.error(`API Error (${method}):`, error.response?.data || error.message);
        throw error;
    }
}

async function getTopicIds() {
    console.log('🔍 Getting Telegram Topic IDs via API...\n');
    
    try {
        // Get chat info
        const chat = await makeApiCall('getChat', { chat_id: groupId });
        console.log('📊 Chat Information:');
        console.log(`- Title: ${chat.result.title}`);
        console.log(`- Type: ${chat.result.type}`);
        console.log(`- Is Forum: ${chat.result.is_forum || false}\n`);
        
        if (!chat.result.is_forum) {
            console.log('❌ This group does NOT have topics enabled!');
            return;
        }
        
        // Get bot info
        const me = await makeApiCall('getMe');
        console.log(`Bot: @${me.result.username}\n`);
        
        // Try to get forum topics using available methods
        console.log('📋 Attempting to enumerate topics...\n');
        
        // Test known topic IDs by trying to send messages
        const possibleTopicIds = [];
        
        // Common topic IDs start from 2 and increment
        for (let topicId = 2; topicId <= 20; topicId++) {
            try {
                // Try to send a test message to this topic
                const testMessage = await makeApiCall('sendMessage', {
                    chat_id: groupId,
                    text: `Testing topic ${topicId}`,
                    message_thread_id: topicId
                });
                
                // If successful, this topic exists
                console.log(`✅ Found Topic ID: ${topicId}`);
                possibleTopicIds.push(topicId);
                
                // Delete the test message
                await makeApiCall('deleteMessage', {
                    chat_id: groupId,
                    message_id: testMessage.result.message_id
                });
                
            } catch (error) {
                // Topic doesn't exist or no permission
                if (!error.response?.data?.description?.includes('TOPIC_CLOSED')) {
                    // Only log if it's not just a closed topic
                }
            }
        }
        
        if (possibleTopicIds.length > 0) {
            console.log(`\n✅ Found ${possibleTopicIds.length} topics: ${possibleTopicIds.join(', ')}`);
            
            // Update config suggestion
            console.log('\n🔧 Update your config:');
            console.log('====================');
            console.log('Since we found these topic IDs:', possibleTopicIds.join(', '));
            console.log('\nYou need to manually identify which topic is which.');
            console.log('Send a message in each topic and note the topic_id.\n');
            
            const channels = ['vent', 'test', 'dev', 'music', 'art', 'pets'];
            console.log('export const channelMappings: ChannelMappings = {');
            channels.forEach((channel, index) => {
                const topicId = possibleTopicIds[index] || 'null';
                console.log(`  '${channel}': {`);
                console.log(`    discord: '${getDiscordId(channel)}',`);
                console.log(`    telegram: '${topicId}' // Verify this!`);
                console.log(`  },`);
            });
            console.log('};\n');
            
            console.log('⚠️  IMPORTANT: These topic IDs are guesses!');
            console.log('   You must verify which topic ID belongs to which channel.');
            console.log('   Send a test message in each topic to confirm.\n');
        } else {
            console.log('❌ Could not find any topic IDs automatically.\n');
            console.log('Manual method:');
            console.log('1. Send a message in each topic');
            console.log('2. Forward each message to @RawDataBot');
            console.log('3. Look for "message_thread_id" in the response\n');
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

function getDiscordId(channel) {
    const ids = {
        'vent': '1401061935604174928',
        'test': '1402671254896644167',
        'dev': '1402671075816636546',
        'music': '1402670920136527902',
        'art': '1401392870929465384',
        'pets': '1402671738562674741'
    };
    return ids[channel] || 'UNKNOWN';
}

getTopicIds();