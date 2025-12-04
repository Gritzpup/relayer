require('dotenv').config();
const axios = require('axios');

async function checkLiveNow() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  console.log('\n🔴 Checking if you are live RIGHT NOW\n');

  try {
    const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        channelId: channelId,
        eventType: 'live',
        type: 'video',
        maxResults: 1
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    if (searchResponse.data.items && searchResponse.data.items.length > 0) {
      const liveVideo = searchResponse.data.items[0];
      console.log('✅ FOUND LIVE STREAM!');
      console.log(`Video ID: ${liveVideo.id.videoId}`);
      console.log(`Title: ${liveVideo.snippet.title}`);

      const videoResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'liveStreamingDetails',
          id: liveVideo.id.videoId
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const chatId = videoResponse.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      console.log('\n📊 Chat ID:', chatId || 'NOT ACTIVE YET');
      
      if (chatId) {
        console.log(`\n🎉 Chat is active! Add to .env:\nYOUTUBE_LIVE_CHAT_ID=${chatId}`);
      } else {
        console.log('\n⏳ Stream is live but chat not active yet - wait 1-2 minutes');
      }
    } else {
      console.log('❌ No live stream detected on your channel');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkLiveNow();
