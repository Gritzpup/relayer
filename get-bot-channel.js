const axios = require('axios');
require('dotenv').config();

async function getChannelId() {
  try {
    const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
    
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'snippet',
        mine: true
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (response.data.items && response.data.items.length > 0) {
      const channel = response.data.items[0];
      console.log('\n========================================');
      console.log('Bot Account Channel Information:');
      console.log('========================================');
      console.log('Channel Name:', channel.snippet.title);
      console.log('Channel ID:', channel.id);
      console.log('========================================\n');
      return channel.id;
    } else {
      console.log('No channel found for this account');
    }
  } catch (error) {
    console.error('Error fetching channel:', error.response?.data || error.message);
  }
}

getChannelId();
