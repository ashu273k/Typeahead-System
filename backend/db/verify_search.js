import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/postgres';
const backendUrl = 'http://localhost:3001/search';
const testQuery = 'testquery123';

async function verifySearch() {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    
    // 1. Get initial count
    const initRes = await client.query('SELECT count FROM queries WHERE query = $1', [testQuery]);
    const initialCount = initRes.rows.length > 0 ? initRes.rows[0].count : 0;
    console.log(`Initial count for "${testQuery}" in DB: ${initialCount}`);
    
    // 2. Perform 5 POST requests
    console.log('Sending 5 POST requests to /search...');
    for (let i = 0; i < 5; i++) {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: testQuery }),
      });
      const data = await response.json();
      console.log(`  POST ${i + 1} response:`, JSON.stringify(data));
      if (data.message !== 'Searched') {
        throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
      }
    }
    
    // 3. Immediately check database count (should still be initialCount because it's buffered)
    const midRes = await client.query('SELECT count FROM queries WHERE query = $1', [testQuery]);
    const midCount = midRes.rows.length > 0 ? midRes.rows[0].count : 0;
    console.log(`Immediate DB check count: ${midCount} (Expected: ${initialCount} due to batch buffering)`);
    
    if (midCount !== initialCount) {
      console.log('⚠️ WARNING: Count changed immediately, buffering might not be working!');
    } else {
      console.log('✅ PASS: Count did not change immediately.');
    }
    
    // 4. Wait for background flush (30 seconds + 2 seconds buffer)
    console.log('Waiting 32 seconds for background flush timer...');
    await new Promise(resolve => setTimeout(resolve, 32000));
    
    // 5. Check final database count
    const finalRes = await client.query('SELECT count FROM queries WHERE query = $1', [testQuery]);
    const finalCount = finalRes.rows.length > 0 ? finalRes.rows[0].count : 0;
    console.log(`Final count for "${testQuery}" in DB: ${finalCount}`);
    
    if (finalCount === initialCount + 5) {
      console.log('✅ PASS: Count increased by exactly 5!');
    } else {
      console.log(`❌ FAIL: Count increased by ${finalCount - initialCount} (Expected: 5)`);
    }

  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await client.end();
  }
}

verifySearch();
