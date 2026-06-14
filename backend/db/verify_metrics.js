const backendUrl = 'http://localhost:3001';

async function verifyMetrics() {
  try {
    console.log('--- Phase 7 Metrics Verification ---');

    // 1. Send 20 suggest calls for the same query "testmetric"
    console.log('Sending 20 sequential suggestion requests for "testmetric"...');
    for (let i = 1; i <= 20; i++) {
      const start = process.hrtime();
      const res = await fetch(`${backendUrl}/suggest?q=testmetric`);
      await res.json();
      const diff = process.hrtime(start);
      const duration = (diff[0] * 1000) + (diff[1] / 1e6);
      if (i === 1 || i === 2 || i === 20) {
        console.log(`  Call ${i} response time: ${duration.toFixed(2)}ms`);
      }
    }

    // 2. Query `/metrics` endpoint
    const metricsRes = await fetch(`${backendUrl}/metrics`);
    const metrics = await metricsRes.json();
    console.log('\nFetched Metrics:');
    console.log(JSON.stringify(metrics, null, 2));

    // 3. Verify Cache Hit Rate > 50%
    const total = metrics.cacheHits + metrics.cacheMisses;
    const hitRate = total > 0 ? (metrics.cacheHits / total) * 100 : 0;
    console.log(`\nVerification: Cache Hit Rate = ${hitRate.toFixed(2)}%`);
    
    if (hitRate > 50) {
      console.log('✅ PASS: Cache Hit Rate is > 50%');
    } else {
      console.log('❌ FAIL: Cache Hit Rate is <= 50%');
    }

    // 4. Verify p95 Latency is calculated and is a valid number
    console.log(`Verification: p95 Latency = ${metrics.p95LatencyMs}ms`);
    if (typeof metrics.p95LatencyMs === 'number' && metrics.p95LatencyMs >= 0) {
      console.log('✅ PASS: p95 Latency is calculated and is a valid number');
    } else {
      console.log('❌ FAIL: p95 Latency is invalid');
    }

  } catch (error) {
    console.error('Error during verification:', error);
  }
}

verifyMetrics();
