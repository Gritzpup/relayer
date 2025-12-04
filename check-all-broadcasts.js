require('dotenv').config();
const axios = require('axios');

async function checkAll() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  console.log('\n🔍 COMPREHENSIVE STREAM CHECK\n');
  console.log('='.repeat(60));

  try {
    // Check 1: Search for live videos
    console.log('\n📡 Check 1: Searching for live videos...\n');
    const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        channelId: channelId,
        eventType: 'live',
        type: 'video',
        maxResults: 5
      },
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    console.log(`Found ${searchResponse.data.items?.length || 0} live videos`);
    if (searchResponse.data.items?.length > 0) {
      searchResponse.data.items.forEach((item, i) => {
        console.log(`  ${i+1}. ${item.snippet.title} (${item.id.videoId})`);
      });
    }

    // Check 2: Get channel uploads to see recent videos
    console.log('\n📺 Check 2: Getting recent channel videos...\n');
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'contentDetails',
        id: channelId
      },
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    
    if (uploadsPlaylistId) {
      const recentVideos = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
          part: 'snippet',
          playlistId: uploadsPlaylistId,
          maxResults: 5
        },
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      console.log('Recent videos:');
      for (const item of recentVideos.data.items || []) {
        const videoId = item.snippet.resourceId.videoId;
        console.log(`  - ${item.snippet.title.substring(0, 50)}... (${videoId})`);
        console.log(`    Status: ${item.snippet.liveBroadcastContent}`);
      }

      // Check each recent video for live details
      console.log('\n🔍 Check 3: Checking each video for live chat...\n');
      for (const item of recentVideos.data.items || []) {
        const videoId = item.snippet.resourceId.videoId;
        const videoResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: {
            part: 'liveStreamingDetails,snippet,status',
            id: videoId
          },
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const video = videoResponse.data.items?.[0];
        if (video?.snippet?.liveBroadcastContent === 'live') {
          console.log(`✅ LIVE VIDEO FOUND: ${video.snippet.title}`);
          console.log(`   Video ID: ${videoId}`);
          console.log(`   Chat ID: ${video.liveStreamingDetails?.activeLiveChatId || 'NOT ACTIVE'}`);
          
          if (video.liveStreamingDetails?.activeLiveChatId) {
            console.log(`\n🎉 CHAT IS ACTIVE!\n`);
            console.log(`Add this to your .env:`);
            console.log(`YOUTUBE_LIVE_CHAT_ID=${video.liveStreamingDetails.activeLiveChatId}`);
          }
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkAll();
