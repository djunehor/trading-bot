import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express, { type Express } from 'express';

import { createAccountRouter } from './routes/account.js';
import { createBacktestRouter } from './routes/backtest.js';
import { createBotRouter } from './routes/bot.js';
import { createMarketRouter } from './routes/market.js';
import { createOrdersRouter } from './routes/orders.js';
import { BotManager } from './services/botManager.js';
import { Logger } from './services/logger.js';
import { portfolioService } from './services/portfolioService.js';

export class App {
  public readonly app: Express;
  private equityHistoryInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  listen(): void {
    const port = process.env.PORT || 3000;
    this.app.listen(port, () => {
      Logger.info(`Express Trading Server listening on http://localhost:${port}`);
      this.startEquityTracking();
      BotManager.restoreStateOnBoot();
    });
  }

  private setupMiddleware(): void {
    this.app.use((request: Request, response: Response, next: NextFunction) => {
      const authUsername = process.env.AUTH_USERNAME || '';
      const authPassword = process.env.AUTH_PASSWORD || '';
      if (!authUsername || !authPassword) {
        next();
        return;
      }

      const authHeader = request.headers.authorization || '';
      const [scheme, encoded] = authHeader.split(' ', 2);
      if (scheme === 'Basic' && encoded && this.isBasicAuthValid(encoded, authUsername, authPassword)) {
        next();
        return;
      }

      response.setHeader('WWW-Authenticate', 'Basic realm="trading-bot"');
      response.status(401).send('Unauthorized');
    });

    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));
  }

  private isBasicAuthValid(encoded: string, username: string, password: string): boolean {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const index = decoded.indexOf(':');
      const user = index === -1 ? '' : decoded.slice(0, index);
      const pass = index === -1 ? '' : decoded.slice(index + 1);
      return user === username && pass === password;
    } catch {
      return false;
    }
  }

  private setupRoutes(): void {
    this.app.use('/api', createAccountRouter());
    this.app.use('/api', createBacktestRouter());
    this.app.use('/api', createOrdersRouter());
    this.app.use('/api', createMarketRouter());
    this.app.use('/api', createBotRouter());
  }

  private startEquityTracking(): void {
    if (this.equityHistoryInterval) {
      return;
    }
    void portfolioService.recordEquitySnapshot();
    this.equityHistoryInterval = setInterval(() => void portfolioService.recordEquitySnapshot(), 5 * 60_000);
  }
}

export const server = new App();
export const app = server.app;
