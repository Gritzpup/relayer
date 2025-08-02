#!/bin/bash

echo "Disabling message relay in notifier..."

# Backup the notifier's .env file
cp /home/ubuntumain/Documents/Github/notifier/.env /home/ubuntumain/Documents/Github/notifier/.env.backup.relay

# Comment out the tokens to disable relay functionality
sed -i 's/^VITE_DISCORD_TOKEN=/#VITE_DISCORD_TOKEN=/g' /home/ubuntumain/Documents/Github/notifier/.env
sed -i 's/^VITE_TELEGRAM_TOKEN=/#VITE_TELEGRAM_TOKEN=/g' /home/ubuntumain/Documents/Github/notifier/.env
sed -i 's/^VITE_TWITCH_OAUTH=/#VITE_TWITCH_OAUTH=/g' /home/ubuntumain/Documents/Github/notifier/.env

echo "Message relay disabled in notifier!"
echo "The notifier will still run but won't relay messages."
echo "All message relaying is now handled by the relayer service."
echo ""
echo "To re-enable relay in notifier later, run:"
echo "cp /home/ubuntumain/Documents/Github/notifier/.env.backup.relay /home/ubuntumain/Documents/Github/notifier/.env"