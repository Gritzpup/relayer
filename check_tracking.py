#!/usr/bin/env python3
import sqlite3
from datetime import datetime

db = sqlite3.connect('relay_messages.db')
cursor = db.cursor()

print("=== Recent messages in message_tracking ===")
cursor.execute("""
    SELECT telegram_msg_id, mapping_id, timestamp, is_deleted 
    FROM message_tracking 
    WHERE platform='Telegram' 
    ORDER BY timestamp DESC 
    LIMIT 10
""")
for row in cursor.fetchall():
    print(f"Telegram ID: {row[0]}, Mapping: {row[1]}, Time: {row[2]}, Deleted: {row[3]}")

print("\n=== Recent messages in platform_messages ===")
cursor.execute("""
    SELECT message_id, mapping_id, created_at, platform
    FROM platform_messages 
    WHERE platform='Telegram' 
    ORDER BY created_at DESC 
    LIMIT 10
""")
for row in cursor.fetchall():
    print(f"Message ID: {row[0]}, Mapping: {row[1]}, Time: {row[2]}, Platform: {row[3]}")

db.close()