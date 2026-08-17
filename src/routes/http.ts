import type { Response } from 'express';

export function sendError(response: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
}
