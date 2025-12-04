require('dotenv').config();
const axios = require('axios');

async function checkYouTubeStream() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const channelId = process.env.YOUTUBE_CHANNEL_ID; // Gritzpup channel
  
  console.log('Checking Gritzpup channel:', channelId);
  console.log('Using Relayer bot token');
  
  try {
    // Check for live broadcasts on Gritzpup channel
    const response = await axios.get('https://www.googleapis.com/youtube/v3/liveBroadcasts', {
      params: {
        part: 'snippet,contentDetails,status',
        broadcastStatus: 'active',
        maxResults: 5
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    console.log('\n=== Live Broadcasts ===');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.items && response.data.items.length > 0) {
      const broadcast = response.data.items[0];
      console.log('\nFound active broadcast!');
      console.log('Live Chat ID:', broadcast.snippet.liveChatId);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkYouTubeStream();
