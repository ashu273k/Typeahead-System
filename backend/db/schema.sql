-- Create queries table
CREATE TABLE IF NOT EXISTS queries (
    id SERIAL PRIMARY KEY,
    query TEXT UNIQUE NOT NULL,
    count INTEGER DEFAULT 0
);

-- Create index on query for prefix search performance using text_pattern_ops
CREATE INDEX IF NOT EXISTS idx_queries_query_prefix ON queries (query text_pattern_ops);

-- Create search_events table
CREATE TABLE IF NOT EXISTS search_events (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    searched_at TIMESTAMP DEFAULT NOW()
);

-- Create index on searched_at for performance
CREATE INDEX IF NOT EXISTS idx_search_events_searched_at ON search_events (searched_at);
