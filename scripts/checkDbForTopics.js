const Database = require('sqlite3').Database;
const path = require('path');

const dbPath = path.join(__dirname, '..', 'relay_messages.db');
const db = new Database(dbPath);

console.log('🔍 Checking database for Telegram topic IDs...\n');

// First check if message_thread_id column exists
db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'", (err, row) => {
    if (err) {
        console.error('Error checking table schema:', err);
        return;
    }
    
    console.log('Table schema:', row?.sql || 'Not found');
    console.log('\n');
    
    // Try to get topic IDs from messages
    const query = `
        SELECT DISTINCT 
            json_extract(raw_data, '$.message_thread_id') as topic_id,
            content,
            username,
            created_at
        FROM messages 
        WHERE platform = 'Telegram' 
        AND json_extract(raw_data, '$.message_thread_id') IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.log('Could not extract from raw_data, trying alternative query...\n');
            
            // Alternative: Look for any column that might contain topic info
            db.all(`SELECT * FROM messages WHERE platform = 'Telegram' LIMIT 5`, [], (err2, rows2) => {
                if (err2) {
                    console.error('Error:', err2);
                } else {
                    console.log('Sample Telegram messages:');
                    rows2.forEach(row => {
                        console.log('\nMessage ID:', row.telegram_msg_id);
                        console.log('Content:', row.content?.substring(0, 50) + '...');
                        console.log('Username:', row.username);
                        console.log('All columns:', Object.keys(row).join(', '));
                        if (row.raw_data) {
                            try {
                                const raw = JSON.parse(row.raw_data);
                                if (raw.message_thread_id) {
                                    console.log('🎯 TOPIC ID FOUND:', raw.message_thread_id);
                                }
                            } catch (e) {}
                        }
                    });
                }
                db.close();
            });
            return;
        }
        
        if (rows && rows.length > 0) {
            console.log('✅ Found messages with topic IDs!\n');
            
            const topicMap = new Map();
            rows.forEach(row => {
                if (row.topic_id && !topicMap.has(row.topic_id)) {
                    topicMap.set(row.topic_id, {
                        content: row.content,
                        username: row.username,
                        timestamp: row.created_at
                    });
                }
            });
            
            console.log('📋 Unique Topic IDs found:');
            console.log('========================');
            topicMap.forEach((info, topicId) => {
                console.log(`\nTopic ID: ${topicId}`);
                console.log(`  Last message: "${info.content?.substring(0, 50)}..."`);
                console.log(`  From: ${info.username}`);
                console.log(`  Time: ${new Date(info.timestamp).toLocaleString()}`);
            });
            
            console.log('\n🔧 Based on message content, here\'s a guess at the mapping:');
            console.log('==========================================================');
            
            // Try to guess based on content
            const channels = ['vent', 'test', 'dev', 'music', 'art', 'pets'];
            const guessedMappings = {};
            
            topicMap.forEach((info, topicId) => {
                const content = (info.content || '').toLowerCase();
                channels.forEach(channel => {
                    if (content.includes(channel) || 
                        (channel === 'test' && content.includes('test')) ||
                        (channel === 'dev' && (content.includes('dev') || content.includes('code'))) ||
                        (channel === 'art' && (content.includes('art') || content.includes('draw'))) ||
                        (channel === 'music' && (content.includes('music') || content.includes('song')))) {
                        if (!guessedMappings[channel]) {
                            guessedMappings[channel] = topicId;
                        }
                    }
                });
            });
            
            console.log('\nexport const channelMappings: ChannelMappings = {');
            channels.forEach(channel => {
                const topicId = guessedMappings[channel] || Array.from(topicMap.keys())[0] || 'null';
                console.log(`  '${channel}': {`);
                console.log(`    discord: '${getDiscordId(channel)}',`);
                console.log(`    telegram: '${topicId}'`);
                console.log(`  },`);
            });
            console.log('};\n');
            
            if (Object.keys(guessedMappings).length < channels.length) {
                console.log('⚠️  Could not guess all mappings. You need to:');
                console.log('   1. Send a message in each topic saying the topic name');
                console.log('   2. Run this script again\n');
            }
        } else {
            console.log('❌ No messages with topic IDs found in the database.\n');
            console.log('This means either:');
            console.log('1. No messages have been sent in topics yet');
            console.log('2. The bot is not properly tracking topic IDs\n');
        }
        
        db.close();
    });
});

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