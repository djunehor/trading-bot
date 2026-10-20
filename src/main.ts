import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || undefined });

import { server } from './server.js';

server.listen();
