import express from 'express';
import pg from 'pg';
import { createClient } from 'redis';

const app = express();
const port = process.env.PORT || 3001;

// Configuration from environment variables with sensible defaults for Docker Compose
const pgConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/postgres'
};

// Initialize PostgreSQL connection pool
const pool = new pg.Pool(pgConfig);

// Helper function to measure response time in milliseconds
function getDurationInMs(startTime) {
  const diff = process.hrtime(startTime);
  return (diff[0] * 1000) + (diff[1] / 1e6);
}

const redis1Url = process.env.REDIS_1_URL || 'redis://redis-1:6379';
const redis2Url = process.env.REDIS_2_URL || 'redis://redis-2:6380';

// Health endpoint returning { "status": "ok" }
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// An endpoint to explicitly test and return reachability status of services
app.get('/test-connections', async (req, res) => {
  const status = {
    postgres: 'unknown',
    'redis-1': 'unknown',
    'redis-2': 'unknown'
  };

  // 1. Test Postgres
  try {
    const client = new pg.Client(pgConfig);
    await client.connect();
    const dbRes = await client.query('SELECT NOW()');
    await client.end();
    status.postgres = `reachable (db time: ${dbRes.rows[0].now})`;
  } catch (err) {
    status.postgres = `unreachable: ${err.message}`;
  }

  // 2. Test Redis-1
  try {
    const client = createClient({ url: redis1Url });
    await client.connect();
    await client.ping();
    await client.disconnect();
    status['redis-1'] = 'reachable';
  } catch (err) {
    status['redis-1'] = `unreachable: ${err.message}`;
  }

  // 3. Test Redis-2
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

// Suggestion API (no cache yet)
app.get('/suggest', async (req, res) => {
  const startTime = process.hrtime();
  try {
    const rawQuery = req.query.q;
    
    // Handle empty input
    if (!rawQuery || typeof rawQuery !== 'string') {
      const duration = getDurationInMs(startTime);
      console.log(`[Suggest DB] q="" | Time: ${duration.toFixed(2)}ms | Results: 0`);
      return res.json([]);
    }
    
    // Lowercase and trim normalization
    const queryStr = rawQuery.trim().toLowerCase();
    if (queryStr === '') {
      const duration = getDurationInMs(startTime);
      console.log(`[Suggest DB] q="" | Time: ${duration.toFixed(2)}ms | Results: 0`);
      return res.json([]);
    }
    
    // Query PostgreSQL using LIKE for prefix search, order by count descending, limit 10
    const sql = `
      SELECT query 
      FROM queries 
      WHERE query LIKE $1 
      ORDER BY count DESC 
      LIMIT 10
    `;
    const searchPattern = `${queryStr}%`;
    const dbRes = await pool.query(sql, [searchPattern]);
    
    const suggestions = dbRes.rows.map(row => row.query);
    const duration = getDurationInMs(startTime);
    console.log(`[Suggest DB] q="${queryStr}" | Time: ${duration.toFixed(2)}ms | Results: ${suggestions.length}`);
    
    return res.json(suggestions);
  } catch (err) {
    const duration = getDurationInMs(startTime);
    console.error(`[Suggest DB Error] q="${req.query.q}" | Time: ${duration.toFixed(2)}ms | Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Hello world fallback
app.get('/', (req, res) => {
  res.send('Hello World from Backend!');
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
  console.log(`Configured Postgres: ${pgConfig.connectionString}`);
  console.log(`Configured Redis 1: ${redis1Url}`);
  console.log(`Configured Redis 2: ${redis2Url}`);
});
