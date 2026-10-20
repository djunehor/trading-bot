import http from 'node:http';
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

    // Multi-account proxy router for /api
    this.app.use('/api', (request: Request, response: Response, next: NextFunction) => {
      if (request.path === '/accounts/summary') {
        next();
        return;
      }

      const target = (request.headers['x-target-account'] as string) || (request.query.targetAccount as string);
      const currentPort = Number(process.env.PORT || 3000);

      if (target === 'recovery' && currentPort === 3000) {
        this.forwardRequest(3001, request, response);
        return;
      }
      if (target === 'clean' && currentPort === 3001) {
        this.forwardRequest(3000, request, response);
        return;
      }
      next();
    });

    this.app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));
  }

  private forwardRequest(targetPort: number, request: Request, response: Response): void {
    const headers = { ...request.headers };
    headers.host = `127.0.0.1:${targetPort}`;
    delete headers['x-target-account'];

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: request.originalUrl || request.url,
        method: request.method,
        headers,
      },
      (proxyRes) => {
        response.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(response);
      }
    );

    proxyReq.on('error', (err) => {
      Logger.error(`Proxy to port ${targetPort} failed: ${err.message}`);
      response.status(502).json({ error: 'Target account server unavailable' });
    });

    if (request.body && Object.keys(request.body).length > 0) {
      const bodyData = JSON.stringify(request.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }

    proxyReq.end();
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
