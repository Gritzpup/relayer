require('dotenv').config();
const axios = require('axios');

async function getChatId() {
  const videoId = 'bKsD2sEJntQ';
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
  
  if (chatId) {
    console.log(`\nYOUTUBE_LIVE_CHAT_ID=${chatId}`);
  }
}

getChatId();
