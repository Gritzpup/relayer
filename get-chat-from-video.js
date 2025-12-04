require('dotenv').config();
const axios = require('axios');

async function getChatIdFromVideo() {
  const videoId = 'g0uVaNTpa1g';  // Current live stream
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'liveStreamingDetails',
        id: videoId
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const liveChatId = response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (liveChatId) {
      console.log('\n✅ Found live chat ID:', liveChatId);
      console.log('\nUpdating .env file...');
      
      const fs = require('fs');
      let envContent = fs.readFileSync('.env', 'utf8');
      envContent = envContent.replace(/YOUTUBE_LIVE_CHAT_ID=.*/, `YOUTUBE_LIVE_CHAT_ID=${liveChatId}`);
      fs.writeFileSync('.env', envContent);
      
      console.log('✅ Updated .env file!');
      console.log('\nRestart relayer with: tilt trigger relayer');
    } else {
      console.log('❌ No active live chat found for video');
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

getChatIdFromVideo();
