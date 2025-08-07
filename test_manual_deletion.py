#!/usr/bin/env python3
import os
import sqlite3
import time
from datetime import datetime

# Connect to database
db_path = "./relay_messages.db"
db = sqlite3.connect(db_path)
cursor = db.cursor()

print("🔍 Manual Deletion Test\n")

# Find a recent Telegram message
cursor.execute("""
    SELECT telegram_msg_id, mapping_id, content 
    FROM message_tracking 
    WHERE platform = 'Telegram' 
    AND is_deleted = 0
    AND mapping_id IS NOT NULL
    ORDER BY timestamp DESC 
    LIMIT 1
""")

row = cursor.fetchone()
if not row:
    print("❌ No non-deleted Telegram messages found!")
    db.close()
    exit(1)

msg_id, mapping_id, content = row
print(f"📌 Found message to test:")
print(f"   Telegram ID: {msg_id}")
print(f"   Mapping: {mapping_id}")
print(f"   Content: {content[:50]}...")

# Check what other platforms have this message
cursor.execute("""
    SELECT platform, discord_msg_id, twitch_msg_id 
    FROM message_tracking 
    WHERE mapping_id = ?
""", (mapping_id,))

platform_messages = cursor.fetchall()
print(f"\n📊 Message exists on platforms:")
for platform, discord_id, twitch_id in platform_messages:
    if platform == "Discord" and discord_id:
        print(f"   Discord: {discord_id}")
    elif platform == "Twitch" and twitch_id:
        print(f"   Twitch: {twitch_id}")

# Simulate deletion by marking as deleted
print(f"\n🗑️ Simulating deletion of Telegram message {msg_id}...")
cursor.execute("""
    UPDATE message_tracking 
    SET is_deleted = 1, deleted_at = datetime('now')
    WHERE telegram_msg_id = ?
""", (msg_id,))
db.commit()

print("✅ Message marked as deleted in database")

# Create a dummy deletion event entry
cursor.execute("""
    INSERT INTO deletion_events (telegram_msg_id, mapping_id, webhook_called, timestamp)
    VALUES (?, ?, 0, datetime('now'))
""", (msg_id, mapping_id))
db.commit()

print("\n⚡ To complete the test:")
print(f"1. Run: node test_deletion_simple.js {msg_id}")
print("2. Or manually call the webhook with:")
print(f"   curl -X POST http://localhost:3000/api/deletion-webhook \\")
print(f"     -H 'Content-Type: application/json' \\")
print(f"     -d '{{\"telegram_msg_id\": {msg_id}, \"mapping_id\": \"{mapping_id}\"}}'")

db.close()