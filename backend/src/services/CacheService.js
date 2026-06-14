export class CacheService {
  constructor(hashRing) {
    this.hashRing = hashRing;
    this.nodes = new Map(); // nodeName -> redisClient
  }

  // Register a Redis client node onto the ring
  registerNode(nodeName, redisClient) {
    this.nodes.set(nodeName, redisClient);
    this.hashRing.addNode(nodeName);
  }

  // Retrieve the correct client and node name for a cache key
  getClientForKey(key) {
    const nodeName = this.hashRing.getNode(key);
    const client = this.nodes.get(nodeName);
    return { nodeName, client };
  }

  // Fetch cache value
  async get(key) {
    const { client } = this.getClientForKey(key);
    if (!client) return null;
    return await client.get(key);
  }

  // Set cache value with TTL
  async set(key, value, ttlSeconds = 60) {
    const { client } = this.getClientForKey(key);
    if (!client) return;
    await client.set(key, value, { EX: ttlSeconds });
  }

  // Check if cache key exists (used for debugging status checking)
  async exists(key) {
    const { client } = this.getClientForKey(key);
    if (!client) return 0;
    return await client.exists(key);
  }

  // Retrieve node name for debug endpoints
  getNodeNameForKey(key) {
    return this.hashRing.getNode(key);
  }

  // Get raw client by node name for global keys
  getClientByName(nodeName) {
    return this.nodes.get(nodeName);
  }
}
