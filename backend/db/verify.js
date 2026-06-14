import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/postgres';

async function verify() {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    
    // 1. Check table count
    const countRes = await client.query('SELECT COUNT(*) FROM queries');
    const count = parseInt(countRes.rows[0].count, 10);
    console.log(`Verification: SELECT COUNT(*) FROM queries -> ${count}`);
    
    if (count >= 100000) {
      console.log('✅ PASS: Count is >= 100,000');
    } else {
      console.log('❌ FAIL: Count is less than 100,000');
    }

    // 2. Check prefix query with iph%
    console.log('\nVerification: SELECT * FROM queries WHERE query LIKE \'iph%\' ORDER BY count DESC LIMIT 10:');
    const prefixRes = await client.query("SELECT id, query, count FROM queries WHERE query LIKE 'iph%' ORDER BY count DESC LIMIT 10");
    console.table(prefixRes.rows);

    if (prefixRes.rows.length === 10 && prefixRes.rows[0].query.startsWith('iph')) {
      console.log('✅ PASS: Prefix query returns sensible results');
    } else {
      console.log('❌ FAIL: Prefix query did not return 10 results or results do not match prefix');
    }

  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await client.end();
  }
}

verify();
