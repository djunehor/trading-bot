import dotenv from 'dotenv';
import { db } from '../src/db/database.js';

dotenv.config();

function resetDatabase() {
  console.log(`=== RESETTING SQLITE DATABASE ===`);

  try {
    const tables = ['orders', 'positions', 'bot_logs', 'news_sentiments'];
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
      console.log(`[DB Reset] Cleared all records from table: ${table}`);
    }

    // Reset sqlite sequence for autoincrement ids
    try {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'bot_logs'`).run();
    } catch {
      // Ignore if table sequence does not exist
    }

    console.log(`[DB Reset] SQLite database cleared successfully.`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[DB Reset] Failed to reset database:`, err.message);
    process.exit(1);
  }
}

resetDatabase();
