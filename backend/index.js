import express from 'express';
import pg from 'pg';
import { createClient } from 'redis';

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

// In-memory buffer variables for batch writing
let searchBuffer = [];
let flushTimeout = null;
let isFlushing = false;

// Schedule the background flush timer (runs every 30 seconds)
function scheduleFlush() {
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flush, 30000);
}

// Flush buffer to database
async function flush() {
  if (isFlushing || searchBuffer.length === 0) {
    scheduleFlush();
    return;
  }

  isFlushing = true;
  if (flushTimeout) clearTimeout(flushTimeout);

  const itemsToFlush = [...searchBuffer];
  searchBuffer = [];

  try {
    const flushedCount = itemsToFlush.length;
    console.log(`[BatchWriter] Flushing ${flushedCount} updates`);

    // Aggregate duplicates for queries table (e.g., "iphone" x 4 -> "iphone" +4)
    const aggregates = {};
    for (const item of itemsToFlush) {
      const q = item.query;
      aggregates[q] = (aggregates[q] || 0) + 1;
    }

    const uniqueQueries = Object.keys(aggregates);

    if (uniqueQueries.length > 0) {
      await pool.query('BEGIN');

      // 1. Bulk Upsert into queries table (add to existing count)
      const queriesValues = [];
      const queriesPlaceholders = [];
      for (let j = 0; j < uniqueQueries.length; j++) {
        const q = uniqueQueries[j];
        queriesPlaceholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
        queriesValues.push(q, aggregates[q]);
      }

      const queriesSql = `
        INSERT INTO queries (query, count) 
        VALUES ${queriesPlaceholders.join(', ')} 
        ON CONFLICT (query) 
        DO UPDATE SET count = queries.count + EXCLUDED.count;
      `;
      await pool.query(queriesSql, queriesValues);

      // 2. Bulk Insert into search_events table
      const eventsValues = [];
      const eventsPlaceholders = [];
      for (let j = 0; j < itemsToFlush.length; j++) {
        const item = itemsToFlush[j];
        eventsPlaceholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
        eventsValues.push(item.query, item.searchedAt);
      }

      const eventsSql = `
        INSERT INTO search_events (query, searched_at) 
        VALUES ${eventsPlaceholders.join(', ')};
      `;
      await pool.query(eventsSql, eventsValues);

      await pool.query('COMMIT');
    }
  } catch (err) {
    console.error('[BatchWriter Error] Failed to flush search events:', err);
    try {
      await pool.query('ROLLBACK');
    } catch (rbErr) {}
  } finally {
    isFlushing = false;
    scheduleFlush();
  }
}

// Add query event to in-memory buffer
function addSearchEvent(query) {
  searchBuffer.push({ query, searchedAt: new Date() });
  
  if (searchBuffer.length >= 100) {
    console.log(`[BatchWriter] Buffer limit hit (100 items). Flushing immediately.`);
    flush();
  }
}

// Start the background timer
scheduleFlush();

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

// Search API (with batch-writing buffer)
app.post('/search', (req, res) => {
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required and must be a string' });
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') {
    return res.status(400).json({ error: 'Query cannot be empty' });
  }

  // Add query to the batch buffer
  addSearchEvent(normalizedQuery);

  // Return message: "Searched" immediately
  return res.json({ message: "Searched" });
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
