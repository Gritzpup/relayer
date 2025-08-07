-- Main message mappings table (replaces in-memory MessageMapper)
CREATE TABLE IF NOT EXISTS message_mappings (
  id VARCHAR(255) PRIMARY KEY, -- mapping_id
  original_platform VARCHAR(50) NOT NULL,
  original_message_id VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  content TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  reply_to_mapping VARCHAR(255), -- Reference to another mapping ID if this is a reply
  FOREIGN KEY (reply_to_mapping) REFERENCES message_mappings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mappings_timestamp ON message_mappings(timestamp);
CREATE INDEX IF NOT EXISTS idx_mappings_platform_message ON message_mappings(original_platform, original_message_id);
CREATE INDEX IF NOT EXISTS idx_mappings_reply ON message_mappings(reply_to_mapping);

-- Platform messages (tracks where messages were sent)
CREATE TABLE IF NOT EXISTS platform_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, message_id),
  FOREIGN KEY (mapping_id) REFERENCES message_mappings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_messages_mapping ON platform_messages(mapping_id);
CREATE INDEX IF NOT EXISTS idx_platform_messages_lookup ON platform_messages(platform, message_id);

-- Telegram-specific tracking for deletion detection
CREATE TABLE IF NOT EXISTS message_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_msg_id INTEGER UNIQUE NOT NULL,
  mapping_id VARCHAR(255),
  chat_id BIGINT NOT NULL,
  user_id BIGINT,
  username VARCHAR(255),
  content TEXT,
  platform VARCHAR(50),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_telegram_msg_id ON message_tracking(telegram_msg_id);
CREATE INDEX IF NOT EXISTS idx_tracking_mapping_id ON message_tracking(mapping_id);
CREATE INDEX IF NOT EXISTS idx_tracking_timestamp ON message_tracking(timestamp);
CREATE INDEX IF NOT EXISTS idx_tracking_is_deleted ON message_tracking(is_deleted);