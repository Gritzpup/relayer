import { messageDb } from './db';

async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    await messageDb.initialize();
    console.log('Database initialized successfully!');
    await messageDb.close();
    process.exit(0);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

initializeDatabase();