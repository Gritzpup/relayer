#!/usr/bin/env python3
import asyncio
import os
import sys
from pyrogram import Client
from dotenv import load_dotenv

load_dotenv()

async def get_food_topic():
    """Get the food topic ID from Telegram"""
    
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    group_id = int(os.getenv("TELEGRAM_GROUP_ID"))
    
    # Create a temporary client with unique session name
    app = Client(
        "topic_finder",
        api_id=api_id,
        api_hash=api_hash,
        workdir="/tmp"  # Use temp directory to avoid conflicts
    )
    
    try:
        async with app:
            print("🔍 Searching for food topic ID...\n")
            
            # Get recent messages to find topics
            topic_info = {}
            seen_topics = set()
            
            async for message in app.get_chat_history(group_id, limit=2000):
                if hasattr(message, 'message_thread_id') and message.message_thread_id:
                    thread_id = message.message_thread_id
                    if thread_id not in seen_topics:
                        seen_topics.add(thread_id)
                        
                        # Check message content for food-related keywords
                        content = (message.text or message.caption or "").lower()
                        
                        # Look for food-related content
                        food_keywords = ['food', 'recipe', 'cooking', 'meal', 'eat', 'restaurant', 'kitchen']
                        is_food_related = any(keyword in content for keyword in food_keywords)
                        
                        # Store topic info
                        topic_info[thread_id] = {
                            'sample_content': content[:100] if content else '[No text]',
                            'from_user': message.from_user.username if message.from_user else 'Unknown',
                            'date': message.date,
                            'is_food_related': is_food_related
                        }
            
            if topic_info:
                print("✅ Found Topics:")
                print("================")
                
                # Show all topics, highlighting food-related ones
                for thread_id, info in sorted(topic_info.items()):
                    marker = "🍕 [FOOD-RELATED]" if info['is_food_related'] else ""
                    print(f"\nTopic ID: {thread_id} {marker}")
                    print(f"  Sample content: {info['sample_content']}")
                    print(f"  From: {info['from_user']}")
                    print(f"  Date: {info['date']}")
                
                # Find most likely food topic
                food_candidates = [tid for tid, info in topic_info.items() if info['is_food_related']]
                
                if food_candidates:
                    print(f"\n🍕 Food topic candidates: {food_candidates}")
                    if len(food_candidates) == 1:
                        print(f"\n✅ Most likely food topic ID: {food_candidates[0]}")
                    else:
                        print(f"\n⚠️  Multiple food candidates found. Check content to determine correct one.")
                else:
                    print(f"\n❌ No obvious food topic found. Here are all topic IDs:")
                    for tid in topic_info.keys():
                        print(f"   - {tid}")
                    print(f"\n💡 You may need to send a test message to the food topic to identify it.")
                
            else:
                print("❌ No topics found!")
                
    except Exception as e:
        print(f"❌ Error: {e}")
        print("This might be due to authentication or permission issues.")
    
    finally:
        # Clean up temp session file
        try:
            import os as file_os
            file_os.remove("/tmp/topic_finder.session")
        except:
            pass

if __name__ == "__main__":
    asyncio.run(get_food_topic())