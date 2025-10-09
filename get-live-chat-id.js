const axios = require('axios');
require('dotenv').config();

async function getLiveChatId() {
  try {
    // Use your account token to get the live chat ID
    const gritzpupToken = process.env.YOUTUBE_ACCESS_TOKEN;
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/liveBroadcasts', {
      params: {
        part: 'snippet',
        broadcastStatus: 'active',
        maxResults: 1
      },
      headers: {
        'Authorization': `Bearer ${gritzpupToken}`
      }
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const broadcast = response.data.items[0];
      console.log('\n========================================');
      console.log('Active Live Stream Found:');
      console.log('========================================');
      console.log('Broadcast Title:', broadcast.snippet.title);
      console.log('Live Chat ID:', broadcast.snippet.liveChatId);
      console.log('========================================\n');
      console.log('\nAdd this to your .env file:');
      console.log(`YOUTUBE_LIVE_CHAT_ID=${broadcast.snippet.liveChatId}`);
      return broadcast.snippet.liveChatId;
    } else {
      console.log('No active live broadcast found. Make sure you are currently live streaming.');
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

getLiveChatId();
