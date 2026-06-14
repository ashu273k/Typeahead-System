import crypto from 'crypto';

export class HashRing {
  constructor(replicas = 21) {
    this.replicas = replicas;
    this.ring = [];
    this.nodeMap = new Map();
  }

  // Hashes a key using MD5 and converts to a 32-bit unsigned integer
  hash(key) {
    const md5 = crypto.createHash('md5').update(key).digest();
    return md5.readUInt32BE(0);
  }

  // Adds a node and its virtual replicas to the hash ring
  addNode(nodeName) {
    for (let i = 0; i < this.replicas; i++) {
      const virtualKey = `${nodeName}-${i}`;
      const h = this.hash(virtualKey);
      this.ring.push(h);
      this.nodeMap.set(h, nodeName);
    }
    this.ring.sort((a, b) => a - b);
  }

  // Resolves which cache node owns a given prefix key
  getNode(key) {
    if (this.ring.length === 0) return null;
    const h = this.hash(key);
    let idx = this.ring.findIndex(val => val >= h);
    if (idx === -1) idx = 0;
    return this.nodeMap.get(this.ring[idx]);
  }
}
