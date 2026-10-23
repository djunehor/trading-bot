import { runScheduledTick } from './src/services/scheduled.js';
import type { CloudflareEnv } from './src/types/cloudflare.js';

// @ts-ignore .open-next/worker.js is generated at build time
import { default as handler } from './.open-next/worker.js';

export default {
  // @ts-ignore
  fetch: handler.fetch,

  async scheduled(event: { cron: string; type: string; scheduledTime: number }, env: CloudflareEnv, ctx: { waitUntil: (promise: Promise<unknown>) => void }) {
    ctx.waitUntil(runScheduledTick(env));
  },
};

// @ts-ignore
export { DOQueueHandler, DOShardedTagCache } from './.open-next/worker.js';
