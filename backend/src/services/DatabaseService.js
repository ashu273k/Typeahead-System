export class DatabaseService {
  constructor(pool) {
    this.pool = pool;
  }

  // Fetch search prefix suggestions
  async getSuggestions(prefix) {
    const sql = `
      SELECT query 
      FROM queries 
      WHERE query LIKE $1 
      ORDER BY count DESC 
      LIMIT 10
    `;
    const searchPattern = `${prefix}%`;
    const dbRes = await this.pool.query(sql, [searchPattern]);
    return dbRes.rows.map(row => row.query);
  }

  // Fetch top 10 trending searches with weighted scoring
  async getTrendingQueries() {
    const sql = `
      WITH recent_counts AS (
        SELECT query, COUNT(*) AS recent_count
        FROM search_events
        WHERE searched_at >= NOW() - INTERVAL '24 hours'
        GROUP BY query
      )
      SELECT 
        COALESCE(q.query, r.query) AS query,
        (0.7 * COALESCE(q.count, 0) + 0.3 * COALESCE(r.recent_count, 0)) AS score
      FROM queries q
      FULL OUTER JOIN recent_counts r ON q.query = r.query
      ORDER BY score DESC
      LIMIT 10;
    `;
    const dbRes = await this.pool.query(sql);
    return dbRes.rows.map(row => ({
      query: row.query,
      score: parseFloat(row.score)
    }));
  }

  // Execute multiple queries inside a single managed transaction (e.g. for batch flushes)
  async runTransaction(queriesArray) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const q of queriesArray) {
        await client.query(q.sql, q.values);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
