require('dotenv').config();
const axios = require('axios');

async function checkAll() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  console.log('Checking for live streams...\n');

  try {
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'contentDetails', id: channelId },
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    const uploadsPlaylistId = channelResponse.data.items[0].contentDetails.relatedPlaylists.uploads;

    const recentVideos = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: { part: 'snippet', playlistId: uploadsPlaylistId, maxResults: 5 },
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    console.log('Recent videos:\n');
    for (const item of recentVideos.data.items || []) {
      const videoId = item.snippet.resourceId.videoId;
      console.log('- ' + item.snippet.title.substring(0, 50) + '...');
      console.log('  Status: ' + item.snippet.liveBroadcastContent + '\n');

      if (item.snippet.liveBroadcastContent === 'live') {
        const videoResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: { part: 'liveStreamingDetails,snippet', id: videoId },
          headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        const video = videoResponse.data.items[0];
        const chatId = video.liveStreamingDetails ? video.liveStreamingDetails.activeLiveChatId : null;
        
        console.log('  ✅ THIS IS LIVE!');
        console.log('  Video ID: ' + videoId);
        console.log('  Chat ID: ' + (chatId || 'NOT ACTIVE') + '\n');

        if (chatId) {
          console.log('🎉 FOUND ACTIVE CHAT!\n');
          console.log('YOUTUBE_LIVE_CHAT_ID=' + chatId);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkAll();
