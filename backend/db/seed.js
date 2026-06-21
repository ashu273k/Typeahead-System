import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connection configuration
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/postgres';

// CSV line parser to handle quotes and commas correctly
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function seed() {
  const client = new pg.Client({ connectionString });
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    
    // Apply schema
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    console.log(`Applying schema from: ${schemaPath}`);
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    await client.query(schemaSql);
    console.log('Schema applied successfully.');

    // Clear existing data to make the seed script repeatable
    console.log('Clearing existing tables...');
    await client.query('TRUNCATE TABLE queries RESTART IDENTITY CASCADE;');
    await client.query('TRUNCATE TABLE search_events RESTART IDENTITY CASCADE;');

    // Read CSV
    // trends.csv format: Query,Global Count,Weekly Count,Daily Count,Trending Score
    const csvPath = path.resolve(__dirname, '../../datasets/trends.csv');
    console.log(`Reading dataset from: ${csvPath}`);
    const csvData = await fs.readFile(csvPath, 'utf8');
    const lines = csvData.split(/\r?\n/);

    // Parse queries and their counts from the CSV
    const queryCountMap = new Map(); // query -> max global count seen
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      // fields[0] = Query, fields[1] = Global Count, fields[2] = Weekly Count,
      // fields[3] = Daily Count, fields[4] = Trending Score
      if (fields.length >= 2) {
        const q = fields[0].trim();
        if (!q) continue;

        const globalCount = parseInt(fields[1], 10) || 0;

        const existing = queryCountMap.get(q.toLowerCase());
        if (existing === undefined || globalCount > existing) {
          queryCountMap.set(q.toLowerCase(), globalCount);
        }
      }
    }
    console.log(`Parsed ${queryCountMap.size} unique queries from trends.csv`);

    // Top queries explicitly seeded with high counts (representative of trends.csv data)
    const topQueries = [
      'google', 'yahoo', 'ebay', 'yahoo.com', 'mapquest', 
      'hotmail', 'google.com', 'msn', 'ebay.com', 'aol',
      'amazon', 'myspace', 'weather', 'walmart', 'craigslist',
      'youtube', 'facebook', 'netflix', 'espn', 'cnn'
    ];

    const uniqueQueriesMap = new Map(queryCountMap);

    // Ensure explicit top queries are included
    for (const q of topQueries) {
      if (!uniqueQueriesMap.has(q.toLowerCase())) {
        uniqueQueriesMap.set(q.toLowerCase(), 5000);
      }
    }

    const baseQueries = Array.from(uniqueQueriesMap.keys());
    const prefixes = ['best', 'how to', 'buy', 'free', 'latest', 'new', 'where to find', 'cheap', 'online', 'what is', 'top 10', 'easy'];
    const suffixes = ['review', 'price', '2026', 'tutorial', 'alternative', 'app', 'download', 'guide', 'near me', 'for sale', 'deals'];

    // Expand unique queries list to reach >= 105,000 rows
    let baseIdx = 0;
    while (uniqueQueriesMap.size < 105000 && baseIdx < baseQueries.length) {
      const base = baseQueries[baseIdx];
      const baseCount = uniqueQueriesMap.get(base) || 1;
      for (const prefix of prefixes) {
        if (uniqueQueriesMap.size >= 105000) break;
        const expanded = `${prefix} ${base}`;
        if (!uniqueQueriesMap.has(expanded)) {
          // Expanded queries get a fraction of the parent query's count
          uniqueQueriesMap.set(expanded, Math.max(1, Math.floor(baseCount * 0.1 * (0.8 + Math.random() * 0.4))));
        }
      }
      for (const suffix of suffixes) {
        if (uniqueQueriesMap.size >= 105000) break;
        const expanded = `${base} ${suffix}`;
        if (!uniqueQueriesMap.has(expanded)) {
          uniqueQueriesMap.set(expanded, Math.max(1, Math.floor(baseCount * 0.1 * (0.8 + Math.random() * 0.4))));
        }
      }
      baseIdx++;
    }

    console.log(`Generated a total of ${uniqueQueriesMap.size} unique queries`);

    // Build final queries array sorted by count descending
    const finalQueries = Array.from(uniqueQueriesMap.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count);

    console.log('Top 15 seeded queries:');
    for (let i = 0; i < Math.min(15, finalQueries.length); i++) {
      console.log(`  ${i + 1}. "${finalQueries[i].query}": ${finalQueries[i].count}`);
    }

    // Insert queries using chunked bulk inserts
    console.log('Starting bulk insertion into queries table...');
    const batchSize = 2000;
    for (let i = 0; i < finalQueries.length; i += batchSize) {
      const batch = finalQueries.slice(i, i + batchSize);
      const values = [];
      const valuePlaceholders = [];
      
      for (let j = 0; j < batch.length; j++) {
        const q = batch[j];
        valuePlaceholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
        values.push(q.query, q.count);
      }
      
      const insertQuery = `
        INSERT INTO queries (query, count) 
        VALUES ${valuePlaceholders.join(', ')} 
        ON CONFLICT (query) 
        DO UPDATE SET count = EXCLUDED.count;
      `;
      
      await client.query(insertQuery, values);
      
      if ((i + batchSize) % 20000 === 0 || i + batch.length >= finalQueries.length) {
        console.log(`  Inserted ${Math.min(i + batch.length, finalQueries.length)} / ${finalQueries.length} queries...`);
      }
    }

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Error during seeding:', error);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

seed();
