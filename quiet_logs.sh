#!/bin/bash

# Script to comment out verbose logging in relayer

echo "Quieting verbose relayer logs..."

# Comment out info logs in manager.ts
sed -i 's/^      logger\.info/      \/\/ logger.info/g' src/relay/manager.ts
sed -i 's/^        logger\.info/        \/\/ logger.info/g' src/relay/manager.ts
sed -i 's/^          logger\.info/          \/\/ logger.info/g' src/relay/manager.ts

# Comment out info logs in messageMapper.ts  
sed -i 's/^            logger\.info/            \/\/ logger.info/g' src/relay/messageMapper.ts
sed -i 's/^          logger\.info/          \/\/ logger.info/g' src/relay/messageMapper.ts
sed -i 's/^      logger\.info/      \/\/ logger.info/g' src/relay/messageMapper.ts
sed -i 's/^    logger\.info/    \/\/ logger.info/g' src/relay/messageMapper.ts

# Comment out verbose Twitch logs
sed -i 's/^      logger\.info(`TWITCH MSG:/      \/\/ logger.info(`TWITCH MSG:/g' src/services/twitch.ts
sed -i 's/^        logger\.info(`REPLY/        \/\/ logger.info(`REPLY/g' src/services/twitch.ts
sed -i 's/^          logger\.info(`REPLY/          \/\/ logger.info(`REPLY/g' src/services/twitch.ts
sed -i 's/^            logger\.info(`REPLY/            \/\/ logger.info(`REPLY/g' src/services/twitch.ts
sed -i 's/^      logger\.info(`TWITCH REPLY/      \/\/ logger.info(`TWITCH REPLY/g' src/services/twitch.ts
sed -i 's/^      logger\.info(`RELAY CHECK:/      \/\/ logger.info(`RELAY CHECK:/g' src/services/twitch.ts
sed -i 's/^      logger\.info(`TWITCH SEND:/      \/\/ logger.info(`TWITCH SEND:/g' src/services/twitch.ts
sed -i 's/^        logger\.info(`STORE MESSAGE:/        \/\/ logger.info(`STORE MESSAGE:/g' src/services/twitch.ts

# Comment out verbose Telegram logs
sed -i 's/^      console\.log(`\[TELEGRAM MESSAGE\]/      \/\/ console.log(`\[TELEGRAM MESSAGE\]/g' src/services/telegram.ts
sed -i 's/^        logger\.info(`Processing reply/        \/\/ logger.info(`Processing reply/g' src/services/telegram.ts
sed -i 's/^        logger\.info(`Reply/        \/\/ logger.info(`Reply/g' src/services/telegram.ts
sed -i 's/^      logger\.info(`Telegram message/      \/\/ logger.info(`Telegram message/g' src/services/telegram.ts
sed -i 's/^      logger\.info(`REPLY DETECTED/      \/\/ logger.info(`REPLY DETECTED/g' src/services/telegram.ts
sed -i 's/^      logger\.info(`Converting Telegram/      \/\/ logger.info(`Converting Telegram/g' src/services/telegram.ts
sed -i 's/^        logger\.info(`Telegram message entities/        \/\/ logger.info(`Telegram message entities/g' src/services/telegram.ts
sed -i 's/^        logger\.info(`Telegram message.*is a reply/        \/\/ logger.info(`Telegram message.*is a reply/g' src/services/telegram.ts
sed -i 's/^      logger\.info(`\[CHANNEL DEBUG\]/      \/\/ logger.info(`\[CHANNEL DEBUG\]/g' src/services/telegram.ts
sed -i 's/^        logger\.info(`Updating mapping_id/        \/\/ logger.info(`Updating mapping_id/g' src/services/telegram.ts

# Comment out Discord verbose logs  
sed -i 's/^          logger\.info(`DISCORD:/          \/\/ logger.info(`DISCORD:/g' src/services/discord.ts
sed -i 's/^        logger\.info(`DISCORD:/        \/\/ logger.info(`DISCORD:/g' src/services/discord.ts

# Comment out other verbose logs
sed -i 's/^          logger\.info(`PLATFORM MESSAGE:/          \/\/ logger.info(`PLATFORM MESSAGE:/g' src/relay/messageMapper.ts
sed -i 's/^      logger\.info(`MAPPING CREATED:/      \/\/ logger.info(`MAPPING CREATED:/g' src/relay/messageMapper.ts
sed -i 's/^        logger\.info(`REPLY CREATE:/        \/\/ logger.info(`REPLY CREATE:/g' src/relay/messageMapper.ts
sed -i 's/^          logger\.info(`REPLY MAPPING:/          \/\/ logger.info(`REPLY MAPPING:/g' src/relay/messageMapper.ts
sed -i 's/^            logger\.info(`getReplyToInfo:/            \/\/ logger.info(`getReplyToInfo:/g' src/relay/messageMapper.ts

echo "Done! Restart the relayer to apply changes."