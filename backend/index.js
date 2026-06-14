import express from 'express';
import pg from 'pg';
import { createClient } from 'redis';

// Service Imports
import { HashRing } from './src/services/HashRing.js';
import { CacheService } from './src/services/CacheService.js';
import { DatabaseService } from './src/services/DatabaseService.js';
import { MetricsService } from './src/services/MetricsService.js';
import { BatchWriter } from './src/services/BatchWriter.js';

const app = express();
const port = process.env.PORT || 3001;

// Middlewares: JSON body parser and manual CORS headers
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Environment Configurations
const pgConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/postgres'
};

const redis1Url = process.env.REDIS_1_URL || 'redis://redis-1:6379';
const redis2Url = process.env.REDIS_2_URL || 'redis://redis-2:6380';

// Initialize PostgreSQL pool and wrap it in DatabaseService (Dependency Inversion Principle)
const pool = new pg.Pool(pgConfig);
const dbService = new DatabaseService(pool);

// Initialize Redis client nodes
const redisClient1 = createClient({ url: redis1Url });
const redisClient2 = createClient({ url: redis2Url });

redisClient1.on('error', (err) => console.error('Redis 1 Client Error', err));
redisClient2.on('error', (err) => console.error('Redis 2 Client Error', err));

await redisClient1.connect().catch(err => console.error('Failed to connect to Redis 1:', err));
await redisClient2.connect().catch(err => console.error('Failed to connect to Redis 2:', err));

// Initialize Consistent Hash Ring and CacheService
const hashRing = new HashRing(21);
const cacheService = new CacheService(hashRing);

// Register Redis instances as cache-node-1 and cache-node-2
cacheService.registerNode('cache-node-1', redisClient1);
cacheService.registerNode('cache-node-2', redisClient2);

// Initialize Telemetry and Batch Writing Services
const metricsService = new MetricsService();
const batchWriter = new BatchWriter(dbService, metricsService, {
  flushIntervalMs: 30000,
  bufferLimit: 100
});

// Start the background writer buffer flush scheduler
batchWriter.start();

// Helper function to measure response time in milliseconds
function getDurationInMs(startTime) {
  const diff = process.hrtime(startTime);
  return (diff[0] * 1000) + (diff[1] / 1e6);
}

// REST Route Endpoints

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// Connections reachability test
app.get('/test-connections', async (req, res) => {
  const status = {
    postgres: 'unknown',
    'redis-1': 'unknown',
    'redis-2': 'unknown'
  };

  try {
    const client = new pg.Client(pgConfig);
    await client.connect();
    const dbRes = await client.query('SELECT NOW()');
    await client.end();
    status.postgres = `reachable (db time: ${dbRes.rows[0].now})`;
  } catch (err) {
    status.postgres = `unreachable: ${err.message}`;
  }

  try {
    const client = createClient({ url: redis1Url });
    await client.connect();
    await client.ping();
    await client.disconnect();
    status['redis-1'] = 'reachable';
  } catch (err) {
    status['redis-1'] = `unreachable: ${err.message}`;
  }

  try {
    const client = createClient({ url: redis2Url });
    await client.connect();
    await client.ping();
    await client.disconnect();
    status['redis-2'] = 'reachable';
  } catch (err) {
    status['redis-2'] = `unreachable: ${err.message}`;
  }

  res.json(status);
});

// Autocomplete prefix suggestion endpoint (DIP & SOLID)
app.get('/suggest', async (req, res) => {
  const startTime = process.hrtime();
  try {
    const rawQuery = req.query.q;
    
    if (!rawQuery || typeof rawQuery !== 'string') {
      return res.json([]);
    }
    
    const queryStr = rawQuery.trim().toLowerCase();
    if (queryStr === '') {
      return res.json([]);
    }

    const cacheKey = `suggest:${queryStr}`;
    
    // 1. Check cache first
    try {
      const cachedVal = await cacheService.get(cacheKey);
      if (cachedVal) {
        const suggestions = JSON.parse(cachedVal);
        const duration = getDurationInMs(startTime);
        metricsService.recordHit(duration);
        console.log(`[Suggest Cache] HIT | node: ${cacheService.getNodeNameForKey(queryStr)} | q="${queryStr}" | Time: ${duration.toFixed(2)}ms`);
        return res.json(suggestions);
      }
    } catch (cacheErr) {
      console.error(`[Suggest Cache Error] Failed to read from cache:`, cacheErr.message);
    }
    
    // 2. Cache MISS: Query PostgreSQL using databaseService
    const nodeName = cacheService.getNodeNameForKey(queryStr);
    console.log(`[Suggest Cache] MISS | node: ${nodeName} | q="${queryStr}" | Querying DB`);
    
    const suggestions = await dbService.getSuggestions(queryStr);
    
    // 3. Write back to Redis
    try {
      await cacheService.set(cacheKey, JSON.stringify(suggestions), 60);
    } catch (cacheErr) {
      console.error(`[Suggest Cache Error] Failed to write cache:`, cacheErr.message);
    }
    
    const duration = getDurationInMs(startTime);
    metricsService.recordMiss(duration);
    console.log(`[Suggest DB] q="${queryStr}" | Time: ${duration.toFixed(2)}ms | Results: ${suggestions.length}`);
    
    return res.json(suggestions);
  } catch (err) {
    const duration = getDurationInMs(startTime);
    console.error(`[Suggest DB Error] q="${req.query.q}" | Time: ${duration.toFixed(2)}ms | Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Cache Debug API (checks node mapping and status)
app.get('/cache/debug', async (req, res) => {
  try {
    const prefix = req.query.prefix;
    if (!prefix || typeof prefix !== 'string') {
      return res.status(400).json({ error: 'prefix parameter is required' });
    }
    const queryStr = prefix.trim().toLowerCase();
    const cacheKey = `suggest:${queryStr}`;
    
    const nodeName = cacheService.getNodeNameForKey(queryStr);
    const exists = await cacheService.exists(cacheKey);
    
    return res.json({
      node: nodeName,
      status: exists === 1 ? 'HIT' : 'MISS'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Telemetry Metrics API
app.get('/metrics', (req, res) => {
  res.json(metricsService.getMetrics());
});

// Trending Queries API (uses DB Service + Cache Service)
app.get('/trending', async (req, res) => {
  const startTime = process.hrtime();
  const cacheKey = 'global:trending';

  try {
    // 1. Try Cache-node-1
    const cachedVal = await cacheService.getClientByName('cache-node-1').get(cacheKey);
    if (cachedVal) {
      const trending = JSON.parse(cachedVal);
      const duration = getDurationInMs(startTime);
      console.log(`[Trending Cache] HIT | Time: ${duration.toFixed(2)}ms | Results: ${trending.length}`);
      return res.json(trending);
    }

    // 2. Cache MISS: Query PostgreSQL
    console.log(`[Trending Cache] MISS | Querying DB`);
    const trending = await dbService.getTrendingQueries();

    // 3. Cache results for 5 mins (300 seconds) in cache-node-1
    await cacheService.getClientByName('cache-node-1').set(cacheKey, JSON.stringify(trending), {
      EX: 300
    });

    const duration = getDurationInMs(startTime);
    console.log(`[Trending DB] Time: ${duration.toFixed(2)}ms | Results: ${trending.length}`);
    return res.json(trending);
  } catch (err) {
    const duration = getDurationInMs(startTime);
    console.error(`[Trending Error] Time: ${duration.toFixed(2)}ms | Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Search API (writes to Batch Buffer)
app.post('/search', (req, res) => {
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required and must be a string' });
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') {
    return res.status(400).json({ error: 'Query cannot be empty' });
  }

  // Push to buffer
  batchWriter.addSearchEvent(normalizedQuery);

  return res.json({ message: "Searched" });
});

// Catch-all hello fallback
app.get('/', (req, res) => {
  res.send('Hello World from Backend!');
});

const server = app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  console.log(`Configured Postgres: ${pgConfig.connectionString}`);
  console.log(`Configured Redis 1: ${redis1Url}`);
  console.log(`Configured Redis 2: ${redis2Url}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  batchWriter.stop();
  server.close(async () => {
    console.log('HTTP server closed');
    await pool.end();
    await redisClient1.disconnect();
    await redisClient2.disconnect();
    console.log('Connections closed cleanly');
  });
});
