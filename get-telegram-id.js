const https = require('https');

const token = '8224946532:AAEm1sKOIBwgSJ130B0hEhM3d1FyWbj51UM';

https.get(`https://api.telegram.org/bot${token}/getUpdates`, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const updates = JSON.parse(data);
      const chats = new Set();
      
      if (updates.result && updates.result.length > 0) {
        updates.result.forEach(update => {
          if (update.message && update.message.chat) {
            const chat = update.message.chat;
            chats.add(`ID: ${chat.id} | Name: ${chat.title || chat.username || 'Private Chat'}`);
          }
        });
        
        if (chats.size > 0) {
          console.log('\nFound these chats:');
          chats.forEach(chat => console.log(chat));
          console.log('\nAdd the ID (negative number) to TELEGRAM_GROUP_ID in your .env file');
        } else {
          console.log('No chats found. Make sure your bot has received messages recently.');
        }
      } else {
        console.log('No updates found. Send a message to your bot or in a group where it\'s added.');
      }
    } catch (error) {
      console.error('Error parsing response:', error.message);
    }
  });
}).on('error', (error) => {
  console.error('Error:', error.message);
});