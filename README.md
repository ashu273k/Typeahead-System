# Typeahead System

A full-stack, highly optimized typeahead system with an Express backend, React frontend, PostgreSQL database, and Redis caching.

## Phase 3: In-Memory Buffering & Data Loss Trade-Offs

To optimize database write performance under high search traffic, we implement an **in-memory batch buffering** mechanism for recording search queries.

### How the Buffer Works
1. Every time a user submits a search query (`POST /search`), it is pushed to an in-memory array (`searchBuffer`) instead of performing a direct database transaction.
2. The user receives a `200 OK` response with `{ "message": "Searched" }` immediately, keeping the client request latency minimal.
3. A background batch writer flushes the buffer to PostgreSQL under two conditions (whichever occurs first):
   - **Buffer Size Limit**: The buffer reaches 100 search events.
   - **Time Limit**: The buffer has been active for 30 seconds.
4. During a flush:
   - Duplicates within the buffer are aggregated (e.g., if "iphone" is searched 5 times, it aggregates to `+5` count).
   - A database transaction is run to:
     - Upsert aggregated query counts into the `queries` table.
     - Bulk-insert individual query events into the `search_events` table.

---

### Trade-Offs: Performance vs. Reliability

#### What happens if the server crashes before a flush?
Since the buffer is kept in the server's RAM, any searches submitted since the last flush that are still in the buffer will be **lost** if the server process terminates abruptly (e.g., crash, power failure, container restart).

#### Why this is the correct trade-off for a Typeahead system:
* **Database Relief**: Direct writes for every search event would overwhelm PostgreSQL with high-frequency write operations, leading to locks, high CPU utilization, and overall slowdown of read queries (which need to be sub-10ms for autocomplete).
* **Aggregation Savings**: By batching and aggregating duplicates (e.g., 5 searches for "iphone" becomes a single database update setting `count = count + 5`), we reduce write load by orders of magnitude.
* **Low Criticality**: For autocomplete typeahead systems, search counts and historical logs do not require ACID-level durability. If we lose the last 15-30 seconds of search query increments due to a rare crash, the autocomplete suggestion order remains practically unaffected. The performance gain vastly outweighs the negligible loss in count precision.

---

## Verification & Testing

### Verification Scripts
We have included automated verification scripts in the `backend/db/` directory.

#### Phase 1 Verification (Dataset loading)
To verify that the dataset was loaded correctly and contains >= 100,000 unique records:
```bash
cd backend
node db/verify.js
```

#### Phase 2 Verification (Suggest API)
To verify the suggest prefix-search endpoint:
```bash
# Test direct prefix suggestions
curl -s "http://localhost:3001/suggest?q=iph"
# Test empty query handling
curl -s "http://localhost:3001/suggest?q="
# Test case normalization
curl -s "http://localhost:3001/suggest?q=IPHONE"
```

#### Phase 3 Verification (Search Batching API)
To verify that `POST /search` is buffered, immediate, and aggregated correctly:
```bash
cd backend
node db/verify_search.js
```
The script will perform 5 searches, verify they return immediately, check that they are not written to the database yet, wait 30 seconds, and confirm the database count increments by exactly 5.
