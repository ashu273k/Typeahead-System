import { createClient } from 'redis';

const backendUrl = 'http://localhost:3001';

async function verifyCache() {
  try {
    console.log('--- Phase 4 Cache Verification ---');
    
    // Invalidate suggest:testcache1 key from both redis nodes to guarantee MISS on first call
    const redis1 = createClient({ url: 'redis://localhost:6379' });
    const redis2 = createClient({ url: 'redis://localhost:6380' });
    await redis1.connect();
    await redis2.connect();
    await redis1.del('suggest:testcache1');
    await redis2.del('suggest:testcache1');
    await redis1.disconnect();
    await redis2.disconnect();
    console.log('Cleared existing Redis keys for "testcache1"');
    
    // 1. Get initial metrics
    const initMetricsRes = await fetch(`${backendUrl}/metrics`);
    const initMetrics = await initMetricsRes.json();
    const initialDbReads = initMetrics.dbReads;
    console.log(`Initial DB Read Counter: ${initialDbReads}`);

    // 2. First suggest query (MISS)
    console.log('Sending first suggestion request for q=testcache1...');
    const suggestRes1 = await fetch(`${backendUrl}/suggest?q=testcache1`);
    const data1 = await suggestRes1.json();
    
    // 3. Second suggest query (HIT)
    console.log('Sending second suggestion request for q=testcache1...');
    const suggestRes2 = await fetch(`${backendUrl}/suggest?q=testcache1`);
    const data2 = await suggestRes2.json();

    // 4. Verify metrics
    const finalMetricsRes = await fetch(`${backendUrl}/metrics`);
    const finalMetrics = await finalMetricsRes.json();
    const finalDbReads = finalMetrics.dbReads;
    console.log(`Final DB Read Counter: ${finalDbReads}`);

    const dbReadsDiff = finalDbReads - initialDbReads;
    if (dbReadsDiff === 1) {
      console.log('✅ PASS: DB Read Counter incremented by exactly 1 (1 MISS, 1 HIT)');
    } else {
      console.log(`❌ FAIL: DB Read Counter incremented by ${dbReadsDiff} (Expected: 1)`);
    }

    // 5. Verify debug endpoints
    console.log('Checking debug endpoint for prefix=testcache1...');
    const debugRes1 = await fetch(`${backendUrl}/cache/debug?prefix=testcache1`);
    const debugData1 = await debugRes1.json();
    console.log('  Debug response for "testcache1":', JSON.stringify(debugData1));

    console.log('Checking debug endpoint for prefix=java...');
    const debugRes2 = await fetch(`${backendUrl}/cache/debug?prefix=java`);
    const debugData2 = await debugRes2.json();
    console.log('  Debug response for "java":', JSON.stringify(debugData2));

    if (debugData1.node && debugData2.node && debugData1.node !== debugData2.node) {
      console.log('✅ PASS: "testcache1" and "java" are served by different nodes (proving consistent hashing distribution)');
    } else {
      console.log('❌ FAIL: Both prefixes mapped to the same node or node was missing');
    }

    if (debugData1.status === 'HIT') {
      console.log('✅ PASS: "testcache1" status is HIT');
    } else {
      console.log('❌ FAIL: "testcache1" status is NOT HIT');
    }

  } catch (error) {
    console.error('Error during verification:', error);
  }
}

verifyCache();
