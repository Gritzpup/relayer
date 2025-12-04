require('dotenv').config();
const axios = require('axios');

async function debugYouTubeAPI() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const videoId = 'g0uVaNTpa1g';

  console.log('\n🔍 Debugging YouTube API Response\n');
  console.log('='.repeat(60));

  try {
    console.log(`\n📹 Checking video: ${videoId}\n`);

    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'liveStreamingDetails,snippet,status',
        id: videoId
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    console.log('Full API Response:');
    console.log(JSON.stringify(response.data, null, 2));

    console.log('\n' + '='.repeat(60));

    const videoData = response.data.items?.[0];
    if (videoData) {
      const snippet = videoData.snippet;
      const liveDetails = videoData.liveStreamingDetails;

      console.log('\n📊 PARSED INFORMATION:');
      console.log(`   Title: ${snippet?.title}`);
      console.log(`   Live Broadcast Content: ${snippet?.liveBroadcastContent}`);
      console.log(`   Has liveStreamingDetails: ${!!liveDetails}`);

      if (liveDetails) {
        console.log('\n   Live Streaming Details:');
        console.log(`      actualStartTime: ${liveDetails.actualStartTime || 'N/A'}`);
        console.log(`      actualEndTime: ${liveDetails.actualEndTime || 'N/A'}`);
        console.log(`      scheduledStartTime: ${liveDetails.scheduledStartTime || 'N/A'}`);
        console.log(`      activeLiveChatId: ${liveDetails.activeLiveChatId || 'N/A'}`);
        console.log(`      concurrentViewers: ${liveDetails.concurrentViewers || 'N/A'}`);
      }
    }

    // Also try to check for current live broadcasts
    console.log('\n\n📡 Checking for any active broadcasts on your channel...\n');

    const broadcastsResponse = await axios.get('https://www.googleapis.com/youtube/v3/liveBroadcasts', {
      params: {
        part: 'snippet,contentDetails,status',
        broadcastStatus: 'active',
        maxResults: 5
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log('Active Broadcasts:');
    console.log(JSON.stringify(broadcastsResponse.data, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response?.data) {
      console.error('\nAPI Error Response:');
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  }
}

debugYouTubeAPI();
