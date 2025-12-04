require('dotenv').config();
const axios = require('axios');

async function checkStreamStatus() {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  console.log('\n🔍 Checking YouTube Stream Status\n');
  console.log('='.repeat(50));

  try {
    // Step 1: Try to find the video ID from the live page
    console.log('\n📺 Step 1: Looking for live stream...');
    const urlsToTry = [
      `https://www.youtube.com/@Gritzpup/live`,
      `https://www.youtube.com/channel/${channelId}/live`,
    ];

    let videoId = null;
    for (const url of urlsToTry) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });

        const html = response.data;
        const videoIdMatch = html.match(/"videoId":"([^"]+)"/);
        if (videoIdMatch && videoIdMatch[1]) {
          videoId = videoIdMatch[1];
          console.log(`   ✅ Found video ID: ${videoId}`);
          break;
        }
      } catch (err) {
        // Try next URL
      }
    }

    if (!videoId) {
      console.log('   ❌ No live stream found');
      console.log('\n💡 Tips:');
      console.log('   - Make sure you\'ve started your stream in YouTube Studio');
      console.log('   - The stream needs to be live (not just scheduled)');
      console.log('   - Wait a few seconds after hitting "Go Live"');
      return;
    }

    // Step 2: Get detailed video information
    console.log('\n📊 Step 2: Fetching stream details...');
    const apiResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'liveStreamingDetails,snippet,status',
        id: videoId
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    const videoData = apiResponse.data.items?.[0];
    if (!videoData) {
      console.log('   ❌ Could not fetch video details');
      return;
    }

    const snippet = videoData.snippet;
    const status = videoData.status;
    const liveDetails = videoData.liveStreamingDetails;

    console.log('\n' + '='.repeat(50));
    console.log('📹 STREAM INFORMATION');
    console.log('='.repeat(50));
    console.log(`\nTitle: ${snippet?.title || 'Unknown'}`);
    console.log(`Video ID: ${videoId}`);
    console.log(`Privacy: ${status?.privacyStatus || 'unknown'}`);
    console.log(`Broadcast Status: ${snippet?.liveBroadcastContent || 'unknown'}`);

    if (liveDetails) {
      console.log('\n📊 LIVE STREAMING DETAILS:');
      if (liveDetails.scheduledStartTime) {
        console.log(`   Scheduled Start: ${liveDetails.scheduledStartTime}`);
      }
      if (liveDetails.actualStartTime) {
        console.log(`   ✅ Actually Started: ${liveDetails.actualStartTime}`);
      } else {
        console.log(`   ⏳ Not started broadcasting yet`);
      }
      if (liveDetails.actualEndTime) {
        console.log(`   Ended: ${liveDetails.actualEndTime}`);
      }
      if (liveDetails.concurrentViewers) {
        console.log(`   👥 Current Viewers: ${liveDetails.concurrentViewers}`);
      }

      console.log('\n💬 CHAT STATUS:');
      const liveChatId = liveDetails.activeLiveChatId;
      if (liveChatId) {
        console.log(`   ✅ Live Chat Active!`);
        console.log(`   Chat ID: ${liveChatId}`);
        console.log('\n🎉 Chat is ready - relayer should connect automatically!');
      } else {
        console.log(`   ❌ Live chat not active yet`);
        console.log('\n⚠️  Why chat might not be active:');

        const broadcastContent = snippet?.liveBroadcastContent;
        if (broadcastContent === 'upcoming') {
          console.log('   • Stream is scheduled but not broadcasting yet');
          console.log('   • Click "Go Live" in YouTube Studio to start');
        } else if (!liveDetails.actualStartTime) {
          console.log('   • Stream exists but hasn\'t started broadcasting');
          console.log('   • Make sure you clicked "Go Live" in YouTube Studio');
        } else {
          console.log('   • Live chat may be disabled in stream settings');
          console.log('   • Stream might still be initializing (wait 1-2 minutes)');
          console.log('   • Check if stream is in "test" mode vs public/unlisted');
        }
      }
    } else {
      console.log('\n❌ No live streaming details available');
    }

    console.log('\n' + '='.repeat(50));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response?.data) {
      console.error('API Error:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkStreamStatus();
