import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../src/index.js';

const listener = getRequestListener(app.fetch);

export default async function handler(
  req: IncomingMessage & { body?: any; rawBody?: any },
  res: ServerResponse
) {
  // Vercel Serverless Body parser bridge
  if (req.body && !req.rawBody) {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
    } else if (typeof req.body === 'string') {
      req.rawBody = Buffer.from(req.body);
    } else if (typeof req.body === 'object') {
      req.rawBody = Buffer.from(JSON.stringify(req.body));
    }
  }

  return listener(req, res);
}
