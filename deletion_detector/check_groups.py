#!/usr/bin/env python3
"""Check what groups the deletion detector has access to"""
import sqlite3
import json

# Check the session database
try:
    conn = sqlite3.connect('sessions/deletion_detector.session')
    cursor = conn.cursor()
    
    # Get peers
    cursor.execute("SELECT * FROM peers")
    peers = cursor.fetchall()
    
    print("🔍 Groups/Channels in session database:")
    print("=" * 50)
    
    for peer in peers:
        peer_id = peer[0]
        # Check if it's a group/channel (negative ID)
        if peer_id < 0:
            print(f"ID: {peer_id}")
            if len(peer) > 1 and peer[1]:
                print(f"  Access Hash: {peer[1]}")
            if len(peer) > 2 and peer[2]:
                print(f"  Type: {peer[2]}")
            if len(peer) > 3 and peer[3]:
                print(f"  Username: {peer[3]}")
            if len(peer) > 4 and peer[4]:
                print(f"  Phone: {peer[4]}")
            print()
    
    conn.close()
    
    print("\n📝 Notes:")
    print(f"- Your configured GROUP_ID: -1002870933586")
    print(f"- Problematic peer from error: -1002170346561")
    print("\nIf the problematic peer is listed above, the bot is receiving updates from it.")
    print("This could be because:")
    print("1. The bot was previously in that group")
    print("2. It's a linked channel to your group")
    print("3. It's forwarding messages from that channel")
    
except Exception as e:
    print(f"Error: {e}")
    print("\nMake sure the deletion detector is not running when checking the database.")