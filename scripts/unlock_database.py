#!/usr/bin/env python3
"""
Database unlock utility for Telegram Deletion Detector
Manually unlocks database when it gets stuck
"""

import os
import sys
import subprocess
import time
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def unlock_database():
    """Unlock the database by removing session files and killing hanging processes"""
    
    logger.info("🔧 Starting database unlock process...")
    
    # Step 1: Kill any hanging sqlite processes
    try:
        result = subprocess.run(["pkill", "-f", "sqlite"], check=False, capture_output=True, text=True)
        if result.returncode == 0:
            logger.info("✅ Killed hanging sqlite processes")
        else:
            logger.info("ℹ️  No hanging sqlite processes found")
    except Exception as e:
        logger.warning(f"⚠️  Could not kill sqlite processes: {e}")
    
    # Step 2: Kill any python processes related to deletion detector
    try:
        result = subprocess.run(["pkill", "-f", "deletion_detector"], check=False, capture_output=True, text=True)
        if result.returncode == 0:
            logger.info("✅ Killed deletion detector processes")
        else:
            logger.info("ℹ️  No deletion detector processes found")
    except Exception as e:
        logger.warning(f"⚠️  Could not kill deletion detector processes: {e}")
    
    # Step 3: Remove session files
    session_files = [
        "deletion_detector/deletion_bot.session",
        "deletion_detector/deletion_bot.session-journal", 
        "deletion_detector/deletion_bot.session-wal",
        "deletion_detector/deletion_bot.session-shm",
        # Also check common paths
        "../deletion_detector/deletion_bot.session",
        "../deletion_detector/deletion_bot.session-journal",
        "../deletion_detector/deletion_bot.session-wal", 
        "../deletion_detector/deletion_bot.session-shm"
    ]
    
    removed_files = 0
    for session_file in session_files:
        if os.path.exists(session_file):
            try:
                os.remove(session_file)
                logger.info(f"✅ Removed session file: {session_file}")
                removed_files += 1
            except Exception as e:
                logger.error(f"❌ Could not remove {session_file}: {e}")
    
    if removed_files == 0:
        logger.info("ℹ️  No session files found to remove")
    
    # Step 4: Clear any temp files
    temp_patterns = [
        "/tmp/pyrogram-*",
        "/tmp/telegram-*"
    ]
    
    for pattern in temp_patterns:
        try:
            result = subprocess.run(f"rm -f {pattern}", shell=True, check=False, capture_output=True)
            logger.info(f"🧹 Cleaned temp files matching: {pattern}")
        except Exception as e:
            logger.warning(f"⚠️  Could not clean temp files {pattern}: {e}")
    
    # Step 5: Force garbage collection equivalent (sync filesystem)
    try:
        subprocess.run(["sync"], check=False)
        logger.info("🔄 Synced filesystem")
    except:
        pass
    
    logger.info("✨ Database unlock process completed!")
    logger.info("🚀 You can now restart the relayer service")
    
    return True

def main():
    """Main function"""
    if len(sys.argv) > 1 and sys.argv[1] in ["--help", "-h"]:
        print("Database Unlock Utility")
        print("Usage: python unlock_database.py")
        print("Removes session files and kills hanging processes to unlock the database")
        return
    
    try:
        success = unlock_database()
        if success:
            print("\n✅ Database unlock completed successfully!")
            print("💡 Run 'tilt trigger relayer' to restart the service")
        else:
            print("\n❌ Database unlock failed")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n⏸️  Database unlock interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()