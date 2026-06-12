import express from 'express';
import pg from 'pg';
import { createClient } from 'redis';

const app = express();
const port = process.env.PORT || 3001;

// Configuration from environment variables with sensible defaults for Docker Compose
const pgConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/postgres'
};

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
