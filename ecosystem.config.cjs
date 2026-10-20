const path = require('node:path');
const dotenv = require('dotenv');

const cleanEnv = dotenv.config({ path: path.resolve(__dirname, '.env') }).parsed || {};
const recoveryEnv = dotenv.config({ path: path.resolve(__dirname, '.env.recovery') }).parsed || {};

module.exports = {
  apps: [
    {
      name: 'trading-bot',
      script: './dist/main.js',
      cwd: '/var/www/trading',
      env: {
        ...cleanEnv,
        ENV_FILE: '/var/www/trading/.env',
        PORT: 3000,
        DB_PATH: '/var/www/trading/data/trading.db',
        CACHE_PREFIX: 'trading-clean',
      },
    },
    {
      name: 'trading-bot-recovery',
      script: './dist/main.js',
      cwd: '/var/www/trading',
      env: {
        ...recoveryEnv,
        ENV_FILE: '/var/www/trading/.env.recovery',
        PORT: 3001,
        DB_PATH: '/var/www/trading/data-recovery/trading.db',
        CACHE_PREFIX: 'trading-recovery',
      },
    },
  ],
};
