require('dotenv').config();
const axios = require('axios');

async function getChatId() {
  const videoId = '-D9hPEV0qS8';
  const token = process.env.YOUTUBE_ACCESS_TOKEN;
  
  const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'liveStreamingDetails',
      id: videoId
    },
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const chatId = response.data.items[0]?.liveStreamingDetails?.activeLiveChatId;
  console.log('Live Chat ID:', chatId);
}

getChatId().catch(e => console.error('Error:', e.message));
