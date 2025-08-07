#!/usr/bin/env python3
"""
Fix for Pyrogram peer resolution errors.
This script pre-resolves all peers to avoid runtime errors.
"""
import os
import asyncio
from pyrogram import Client
from dotenv import load_dotenv
import logging

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))

app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir="sessions"
)

async def fix_peers():
    await app.start()
    logger.info("Connected to Telegram")
    
    # Get all dialogs and resolve peers
    resolved = []
    failed = []
    
    async for dialog in app.get_dialogs():
        try:
            # Force resolve the peer
            await app.resolve_peer(dialog.chat.id)
            resolved.append((dialog.chat.id, dialog.chat.title))
            logger.info(f"✓ Resolved: {dialog.chat.title} ({dialog.chat.id})")
        except Exception as e:
            failed.append((dialog.chat.id, str(e)))
            logger.error(f"✗ Failed: {dialog.chat.id} - {e}")
    
    print(f"\n✅ Successfully resolved {len(resolved)} peers")
    print(f"❌ Failed to resolve {len(failed)} peers")
    
    if failed:
        print("\nFailed peers:")
        for peer_id, error in failed:
            print(f"  {peer_id}: {error}")
    
    # Check if the problematic peer is in our list
    problem_peer = -1002170346561
    found = False
    for peer_id, title in resolved:
        if peer_id == problem_peer:
            print(f"\n🎯 Found problematic peer: {title} ({peer_id})")
            found = True
            break
    
    if not found:
        print(f"\n⚠️  Problematic peer {problem_peer} not found in dialogs")
        print("This peer might be sending updates but bot doesn't have access")
    
    await app.stop()

if __name__ == "__main__":
    asyncio.run(fix_peers())