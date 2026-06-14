import pg from 'pg';
import { createClient } from 'redis';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/postgres';
const redisUrl = 'redis://localhost:6379';
const backendUrl = 'http://localhost:3001';

async function verifyTrending() {
  const client = new pg.Client({ connectionString });
  const redisClient = createClient({ url: redisUrl });

  try {
    console.log('--- Phase 5 Trending Verification ---');
    await client.connect();
    await redisClient.connect();

    // 1. Truncate DB tables for clean environment
    console.log('Clearing database tables...');
    await client.query('TRUNCATE TABLE queries RESTART IDENTITY CASCADE;');
    await client.query('TRUNCATE TABLE search_events RESTART IDENTITY CASCADE;');

    // 2. Clear Redis global trending cache
    console.log('Clearing Redis trending cache...');
    await redisClient.del('global:trending');

    // 3. Insert test queries
    console.log('Inserting test queries...');
    // Query A: count = 100,000, recent = 0 (Score: 70,000)
    await client.query("INSERT INTO queries (query, count) VALUES ('trend_historical_only', 100000)");
    // Query B: count = 10, recent = 10 (Score: 10)
    await client.query("INSERT INTO queries (query, count) VALUES ('trend_recent_only', 10)");
    // Query C: count = 99,900, recent = 300 (Score: 70,020)
    await client.query("INSERT INTO queries (query, count) VALUES ('trend_heavy_recent', 99900)");

    // 4. Insert recent search events
    console.log('Inserting recent search events (last 1 hour)...');
    // 10 search events for Query B
    for (let i = 0; i < 10; i++) {
      await client.query("INSERT INTO search_events (query, searched_at) VALUES ('trend_recent_only', NOW())");
    }
    // 300 search events for Query C
    const eventValues = [];
    const placeholders = [];
    for (let i = 0; i < 300; i++) {
      placeholders.push(`($${i + 1}, NOW())`);
      eventValues.push('trend_heavy_recent');
    }
    await client.query(`INSERT INTO search_events (query, searched_at) VALUES ${placeholders.join(', ')}`, eventValues);

    // 5. Test First GET /trending (MISS - Hits DB)
    console.log('\nFetching /trending first time (Cache MISS)...');
    const start1 = process.hrtime();
    const res1 = await fetch(`${backendUrl}/trending`);
    const data1 = await res1.json();
    const diff1 = process.hrtime(start1);
    const duration1 = (diff1[0] * 1000) + (diff1[1] / 1e6);
    console.log(`First /trending response time: ${duration1.toFixed(2)}ms`);
    console.log('Trending results:', JSON.stringify(data1, null, 2));

    // Assert ranking and scoring
    if (data1.length >= 3) {
      const q1 = data1[0];
      const q2 = data1[1];
      const q3 = data1[2];

      console.log('\nVerifying assertions:');
      
      // Assertion 1: trend_recent_only appears (total count = 10)
      if (data1.some(item => item.query === 'trend_recent_only')) {
        console.log('✅ PASS: Brand-new query searched 10 times appears in trending list (even though count=10)');
      } else {
        console.log('❌ FAIL: Brand-new query did not appear in trending');
      }

      // Assertion 2: trend_historical_only appears but is outscored by something recent (trend_heavy_recent)
      if (q1.query === 'trend_heavy_recent' && q2.query === 'trend_historical_only') {
        console.log('✅ PASS: Query with 100,000 count is outscored by recent query with count 99,900 + 300 recent searches');
      } else {
        console.log(`❌ FAIL: Expected rank 1 to be trend_heavy_recent and rank 2 to be trend_historical_only. Got: 1: ${q1.query}, 2: ${q2.query}`);
      }
    } else {
      console.log('❌ FAIL: Trending did not return enough test results');
    }

    // 6. Test Second GET /trending (HIT - Hits Redis Cache)
    console.log('\nFetching /trending second time (Cache HIT)...');
    const start2 = process.hrtime();
    const res2 = await fetch(`${backendUrl}/trending`);
    const data2 = await res2.json();
    const diff2 = process.hrtime(start2);
    const duration2 = (diff2[0] * 1000) + (diff2[1] / 1e6);
    console.log(`Second /trending response time: ${duration2.toFixed(2)}ms`);

    if (duration2 < 100) {
      console.log('✅ PASS: Cache HIT responds in under 100ms (typically < 5ms)');
    } else {
      console.log(`❌ FAIL: Cache HIT took ${duration2.toFixed(2)}ms (Expected < 100ms)`);
    }

    // 7. Restore database state by running the seed script
    console.log('\nRestoring database to full state by running seed.js...');
    const { stdout, stderr } = await execPromise('node db/seed.js', { cwd: '/home/x002/Desktop/Typeahead System/backend' });
    console.log(stdout.trim().split('\n').slice(-3).join('\n')); // Log the last few lines of seed
    console.log('✅ Database restored.');

  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await client.end();
    await redisClient.disconnect();
  }
}

verifyTrending();
