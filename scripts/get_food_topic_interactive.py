#!/usr/bin/env python3
import asyncio
import os
import sys
from pyrogram import Client
from dotenv import load_dotenv

load_dotenv()

async def get_food_topic_interactive():
    """Interactive script to identify food topic ID"""
    
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    group_id = int(os.getenv("TELEGRAM_GROUP_ID"))
    
    # Create a temporary client
    app = Client(
        "topic_finder_interactive",
        api_id=api_id,
        api_hash=api_hash,
        workdir="/tmp"
    )
    
    try:
        await app.start()
        print("🔍 Connected to Telegram!")
        print(f"📱 Monitoring group ID: {group_id}")
        print("\n" + "="*60)
        print("🍕 FOOD TOPIC FINDER")
        print("="*60)
        print("1. Go to the FOOD room/topic in Telegram")
        print("2. Send ANY message (like 'test' or 'hello')")
        print("3. Come back here and press ENTER")
        print("4. I'll show you the most recent messages with their topic IDs")
        print("="*60)
        
        input("\n👆 Press ENTER when you've sent a message in the food room...")
        
        print("\n🔍 Getting recent messages...")
        
        # Get very recent messages (last 50)
        messages_with_topics = []
        
        async for message in app.get_chat_history(group_id, limit=50):
            if hasattr(message, 'message_thread_id') and message.message_thread_id:
                thread_id = message.message_thread_id
                content = message.text or message.caption or '[Media/Sticker]'
                username = message.from_user.username if message.from_user else 'Unknown'
                
                messages_with_topics.append({
                    'thread_id': thread_id,
                    'content': content[:100],
                    'username': username,
                    'date': message.date
                })
        
        if messages_with_topics:
            print("\n📝 Recent messages with topic IDs:")
            print("=" * 80)
            
            # Show last 10 messages
            for i, msg in enumerate(messages_with_topics[:10]):
                print(f"\n{i+1}. Topic ID: {msg['thread_id']}")
                print(f"   From: @{msg['username']}")
                print(f"   Content: {msg['content']}")
                print(f"   Time: {msg['date']}")
                print("-" * 40)
            
            print(f"\n🍕 Which topic ID corresponds to your message in the food room?")
            food_topic_id = input("Enter the topic ID: ").strip()
            
            if food_topic_id.isdigit():
                print(f"\n✅ Food topic ID identified: {food_topic_id}")
                print(f"\n🔧 Now I'll update the configuration...")
                return food_topic_id
            else:
                print("❌ Invalid topic ID entered")
                return None
        else:
            print("❌ No recent messages with topic IDs found!")
            print("Make sure you sent a message in a topic/thread, not the general chat.")
            return None
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return None
    
    finally:
        await app.stop()
        # Clean up temp session
        try:
            os.remove("/tmp/topic_finder_interactive.session")
        except:
            pass

if __name__ == "__main__":
    result = asyncio.run(get_food_topic_interactive())
    if result:
        print(f"\n🎉 Success! Food topic ID: {result}")
    else:
        print("\n❌ Failed to get topic ID")