export class BatchWriter {
  constructor(databaseService, metricsService, options = {}) {
    this.dbService = databaseService;
    this.metricsService = metricsService;
    this.flushIntervalMs = options.flushIntervalMs || 30000;
    this.bufferLimit = options.bufferLimit || 100;
    
    this.buffer = [];
    this.flushTimeout = null;
    this.isFlushing = false;
  }

  // Start background flush schedule
  start() {
    this.scheduleFlush();
  }

  // Stop background timer on process exit
  stop() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
  }

  scheduleFlush() {
    if (this.flushTimeout) clearTimeout(this.flushTimeout);
    this.flushTimeout = setTimeout(() => this.flush(), this.flushIntervalMs);
  }

  // Adds a search term to buffer and checks limit threshold
  addSearchEvent(query) {
    this.buffer.push({ query, searchedAt: new Date() });
    if (this.buffer.length >= this.bufferLimit) {
      console.log(`[BatchWriter] Buffer limit hit (${this.bufferLimit} items). Flushing immediately.`);
      this.flush();
    }
  }

  // Flushes aggregated buffer contents into database inside a single transaction
  async flush() {
    if (this.isFlushing || this.buffer.length === 0) {
      this.scheduleFlush();
      return;
    }

    this.isFlushing = true;
    if (this.flushTimeout) clearTimeout(this.flushTimeout);

    const itemsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      const flushedCount = itemsToFlush.length;
      console.log(`[BatchWriter] Flushing ${flushedCount} updates`);

      // Aggregate duplicates (e.g. "iphone" x5 -> "iphone" +5)
      const aggregates = {};
      for (const item of itemsToFlush) {
        const q = item.query;
        aggregates[q] = (aggregates[q] || 0) + 1;
      }

      const uniqueQueries = Object.keys(aggregates);

      if (uniqueQueries.length > 0) {
        // Build SQL statements
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

        // Execute transaction
        await this.dbService.runTransaction([
          { sql: queriesSql, values: queriesValues },
          { sql: eventsSql, values: eventsValues }
        ]);

        // Record flush writes in metrics
        this.metricsService.recordDbWrite(flushedCount);
      }
    } catch (err) {
      console.error('[BatchWriter Error] Failed to flush search events:', err);
    } finally {
      this.isFlushing = false;
      this.scheduleFlush();
    }
  }
}
