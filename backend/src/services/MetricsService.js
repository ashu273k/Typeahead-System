export class MetricsService {
  constructor() {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.dbReads = 0;
    this.dbWrites = 0;
    this.suggestLatencies = [];
  }

  // Record a successful Redis cache HIT and log latency
  recordHit(duration) {
    this.cacheHits++;
    this.recordLatency(duration);
  }

  // Record a cache MISS fallback to DB and log latency
  recordMiss(duration) {
    this.cacheMisses++;
    this.dbReads++;
    this.recordLatency(duration);
  }

  // Record DB writes count (triggered during batch writer flush)
  recordDbWrite(count) {
    this.dbWrites += count;
  }

  // Keep a rolling latency list capped at 10,000 values
  recordLatency(duration) {
    this.suggestLatencies.push(duration);
    if (this.suggestLatencies.length > 10000) {
      this.suggestLatencies.shift();
    }
  }

  // Compute the 95th percentile latency
  getP95Latency() {
    if (this.suggestLatencies.length === 0) return 0;
    const sorted = [...this.suggestLatencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index];
  }

  // Retrieve aggregate stats payload
  getMetrics() {
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      dbReads: this.dbReads,
      dbWrites: this.dbWrites,
      p95LatencyMs: parseFloat(this.getP95Latency().toFixed(2))
    };
  }
}
