#!/usr/bin/env python3
import asyncio
import os
import sys
from pyrogram import Client
from pyrogram.types import Chat
from dotenv import load_dotenv

# Add parent directory to path to import from deletion_detector
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'deletion_detector'))

load_dotenv()

async def get_topic_ids():
    """Get all topic IDs from the Telegram group"""
    
    # Use the existing deletion detector session
    app = Client(
        "deletion_detector",
        workdir="../deletion_detector/sessions"
    )
    
    async with app:
        print("🔍 Getting Telegram Topic IDs using Pyrogram...\n")
        
        group_id = int(os.getenv('TELEGRAM_GROUP_ID'))
        
        try:
            # Get the chat
            chat = await app.get_chat(group_id)
            print(f"📊 Chat Information:")
            print(f"- Title: {chat.title}")
            print(f"- Type: {chat.type}")
            print(f"- ID: {chat.id}")
            print(f"- Members: {chat.members_count}")
            print(f"- Is Forum: {'Yes' if hasattr(chat, 'is_forum') and chat.is_forum else 'Unknown'}\n")
            
            # Try to get forum topics
            print("🔍 Attempting to get forum topics...\n")
            
            # Get recent messages to find different topics
            topic_info = {}
            seen_topics = set()
            
            async for message in app.get_chat_history(group_id, limit=1000):
                if hasattr(message, 'message_thread_id') and message.message_thread_id:
                    thread_id = message.message_thread_id
                    if thread_id not in seen_topics:
                        seen_topics.add(thread_id)
                        
                        # Try to find topic name
                        topic_name = "Unknown"
                        
                        # Check if this is a topic creation message
                        if hasattr(message, 'forum_topic_created') and message.forum_topic_created:
                            topic_name = message.forum_topic_created.name
                        
                        # Store topic info
                        if thread_id not in topic_info:
                            topic_info[thread_id] = {
                                'name': topic_name,
                                'last_message': message.text or '[Media]' if message.text else '[No text]',
                                'from': message.from_user.username if message.from_user else 'Unknown'
                            }
                        
                        # Update name if we found it
                        if topic_name != "Unknown":
                            topic_info[thread_id]['name'] = topic_name
            
            if topic_info:
                print("✅ Found Topics:")
                print("================")
                for thread_id, info in sorted(topic_info.items()):
                    print(f"\nTopic ID: {thread_id}")
                    print(f"  Name: {info['name']}")
                    print(f"  Last message: {info['last_message'][:50]}...")
                    print(f"  From: {info['from']}")
                
                # Generate config
                print("\n\n🔧 Update your config with these IDs:")
                print("=====================================")
                print("export const channelMappings: ChannelMappings = {")
                
                # Known channel names
                channel_names = ['vent', 'test', 'dev', 'music', 'art', 'pets']
                
                for channel_name in channel_names:
                    # Try to match topic by name
                    matched_id = 'null'
                    for thread_id, info in topic_info.items():
                        if info['name'].lower() == channel_name or channel_name in info['name'].lower():
                            matched_id = f"'{thread_id}'"
                            break
                    
                    # Show current Discord ID from your list
                    discord_ids = {
                        'vent': '1401061935604174928',
                        'test': '1402671254896644167',
                        'dev': '1402671075816636546',
                        'music': '1402670920136527902',
                        'art': '1401392870929465384',
                        'pets': '1402671738562674741'
                    }
                    
                    print(f"  '{channel_name}': {{")
                    print(f"    discord: '{discord_ids.get(channel_name, 'UNKNOWN')}',")
                    print(f"    telegram: {matched_id}")
                    print(f"  }},")
                
                print("};\n")
                
                # If some topics weren't matched
                unmatched = [name for name in channel_names if not any(
                    name in info['name'].lower() for info in topic_info.values()
                )]
                
                if unmatched:
                    print(f"\n⚠️  Could not match these channels: {', '.join(unmatched)}")
                    print("   You'll need to manually identify which topic ID belongs to each.\n")
                    
            else:
                print("❌ No topics found!")
                print("\nPossible reasons:")
                print("1. The group doesn't have topics enabled")
                print("2. No messages have been sent in topics yet")
                print("3. The bot doesn't have permission to read message history")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            print("\nMake sure:")
            print("1. The deletion detector is properly authenticated")
            print("2. The bot has access to the group")
            print("3. The group ID is correct")

if __name__ == "__main__":
    asyncio.run(get_topic_ids())