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
    const csvPath = path.resolve(__dirname, '../../datasets/trends.csv');
    console.log(`Reading dataset from: ${csvPath}`);
    const csvData = await fs.readFile(csvPath, 'utf8');
    const lines = csvData.split(/\r?\n/);

    const rawQueries = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      if (fields.length >= 5) {
        const q = fields[4].trim();
        if (q) {
          rawQueries.push(q);
        }
      }
    }
    console.log(`Parsed ${rawQueries.length} raw queries from trends.csv`);

    // Top queries to explicitly seed with high counts
    const iphoneQueries = [
      'iphone', 'iphone 15', 'iphone 15 pro', 'iphone 14', 'iphone 13', 
      'iphone 12', 'iphone case', 'iphone charger', 'iphone price', 
      'iphone 15 pro max', 'iphone 16', 'iphone 16 pro', 'iphone review', 
      'iphone specs', 'iphone wallpaper', 'iphone recovery mode', 'iphone settings',
      'iphone 15 price', 'iphone 14 pro', 'iphone 13 pro', 'iphone update'
    ];

    const uniqueQueriesSet = new Set();
    
    // Add raw queries (lowercase for consistency)
    for (const q of rawQueries) {
      uniqueQueriesSet.add(q.toLowerCase());
    }
    
    // Add explicit iphone queries
    for (const q of iphoneQueries) {
      uniqueQueriesSet.add(q.toLowerCase());
    }

    const baseQueries = Array.from(uniqueQueriesSet);
    const prefixes = ['best', 'how to', 'buy', 'free', 'latest', 'new', 'where to find', 'cheap', 'online', 'what is', 'top 10', 'easy'];
    const suffixes = ['review', 'price', '2026', 'tutorial', 'alternative', 'app', 'download', 'guide', 'near me', 'for sale', 'deals'];

    // Expand unique queries list to reach >= 105,000 rows
    let baseIdx = 0;
    while (uniqueQueriesSet.size < 105000 && baseIdx < baseQueries.length) {
      const base = baseQueries[baseIdx];
      for (const prefix of prefixes) {
        if (uniqueQueriesSet.size >= 105000) break;
        uniqueQueriesSet.add(`${prefix} ${base}`);
      }
      for (const suffix of suffixes) {
        if (uniqueQueriesSet.size >= 105000) break;
        uniqueQueriesSet.add(`${base} ${suffix}`);
      }
      baseIdx++;
    }

    console.log(`Generated a total of ${uniqueQueriesSet.size} unique queries`);

    const finalQueries = Array.from(uniqueQueriesSet);

    // Filter out top queries to rank them explicitly at the top
    const topQueriesSet = new Set(iphoneQueries.map(q => q.toLowerCase()));
    const topList = finalQueries.filter(q => topQueriesSet.has(q));
    const restList = finalQueries.filter(q => !topQueriesSet.has(q));

    // Shuffle other queries to randomize their ranking
    function shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    }
    shuffle(restList);

    // Combine topList with the shuffled restList
    const orderedQueries = [...topList, ...restList];

    // Assign power-law distributed counts
    const queriesToInsert = orderedQueries.map((query, index) => {
      const rank = index + 1;
      const noise = 0.8 + Math.random() * 0.4;
      let count = Math.floor((3000000 / Math.pow(rank, 1.15)) * noise);
      if (count < 1) {
        count = Math.random() > 0.5 ? 1 : 0;
      }
      return { query, count };
    });

    console.log('Top 15 seeded queries:');
    for (let i = 0; i < 15; i++) {
      console.log(`  ${i + 1}. "${queriesToInsert[i].query}": ${queriesToInsert[i].count}`);
    }

    // Insert queries using chunked bulk inserts
    console.log('Starting bulk insertion into queries table...');
    const batchSize = 2000;
    for (let i = 0; i < queriesToInsert.length; i += batchSize) {
      const batch = queriesToInsert.slice(i, i + batchSize);
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
      
      if ((i + batchSize) % 20000 === 0 || i + batch.length >= queriesToInsert.length) {
        console.log(`  Inserted ${Math.min(i + batch.length, queriesToInsert.length)} / ${queriesToInsert.length} queries...`);
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
