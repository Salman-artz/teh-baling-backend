import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AppEnv, authMiddleware } from './middleware/auth.middleware.js';
import { auditLoggerMiddleware, rateLimitMiddleware } from './middleware/rate-limit.middleware.js';
import { authRouter } from './routes/auth.routes.js';
import { masterRouter } from './routes/master.routes.js';
import { shiftsRouter } from './routes/shifts.routes.js';
import { productionRouter } from './routes/production.routes.js';
import { summaryRouter } from './routes/summary.routes.js';
import { exportRouter } from './routes/export.routes.js';

const app = new Hono<AppEnv>();

// =============================================================================
// 1. CORS CONFIGURATION (ENV DRIVEN)
// =============================================================================

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return allowedOrigins[0];
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return origin;
      }
      return allowedOrigins[0];
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);

// =============================================================================
// 2. AUDIT & RATE LIMITING MIDDLEWARE
// =============================================================================

app.use('*', auditLoggerMiddleware);
app.use('/api/v1/*', rateLimitMiddleware);
app.use('/api/v1/*', authMiddleware);

// =============================================================================
// 3. MOUNT MODULAR ROUTERS
// =============================================================================

// Base API v1 prefix
const apiV1 = new Hono<AppEnv>();
apiV1.route('/auth', authRouter);
apiV1.route('/', masterRouter);
apiV1.route('/', shiftsRouter);
apiV1.route('/', productionRouter);
apiV1.route('/', summaryRouter);
apiV1.route('/', exportRouter);

app.route('/api/v1', apiV1);

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// =============================================================================
// 4. SERVER START
// =============================================================================

const port = Number(process.env.PORT) || 3001;

if (!process.env.VERCEL) {
  console.log(`🍵 Teh Baling API running on port ${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
}

export default app;
