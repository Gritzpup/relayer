#!/usr/bin/env python3
"""
Setup script for the deletion detector bot
"""
import os
import sys
from pathlib import Path

def check_env():
    """Check if required environment variables are set"""
    env_file = Path("../.env")
    if not env_file.exists():
        print("❌ .env file not found in parent directory")
        return False
    
    # Check if variables exist in .env
    with open(env_file) as f:
        content = f.read()
        
    missing = []
    if "TELEGRAM_API_ID=" not in content:
        missing.append("TELEGRAM_API_ID")
    if "TELEGRAM_API_HASH=" not in content:
        missing.append("TELEGRAM_API_HASH")
    if "TELEGRAM_GROUP_ID=" not in content:
        missing.append("TELEGRAM_GROUP_ID")
    
    if missing:
        print(f"❌ Missing environment variables: {', '.join(missing)}")
        print("\nAdd these to your .env file:")
        for var in missing:
            if var == "TELEGRAM_API_ID":
                print(f"{var}=your_api_id_here")
            elif var == "TELEGRAM_API_HASH":
                print(f"{var}=your_api_hash_here")
            elif var == "TELEGRAM_GROUP_ID":
                print(f"{var}=your_group_id_here")
        return False
    
    print("✅ Environment variables configured")
    return True

def check_database():
    """Check if database exists"""
    db_path = Path("../relay_messages.db")
    if not db_path.exists():
        print("❌ Database not found. Run 'npm run init-db' from the main directory")
        return False
    
    print("✅ Database found")
    return True

def check_dependencies():
    """Check if Python dependencies are installed"""
    try:
        import pyrogram
        import aiohttp
        import dotenv
        print("✅ Python dependencies installed")
        return True
    except ImportError as e:
        print(f"❌ Missing Python dependencies: {e}")
        print("\nRun: pip install -r requirements.txt")
        return False

def main():
    print("🔧 Deletion Detector Setup Check\n")
    
    checks = [
        ("Environment Variables", check_env),
        ("Database", check_database),
        ("Python Dependencies", check_dependencies),
    ]
    
    all_passed = True
    for name, check_func in checks:
        print(f"Checking {name}...")
        if not check_func():
            all_passed = False
        print()
    
    if all_passed:
        print("✅ All checks passed! You can now run the bot with:")
        print("   python bot.py")
    else:
        print("❌ Some checks failed. Please fix the issues above and try again.")
        sys.exit(1)

if __name__ == "__main__":
    main()