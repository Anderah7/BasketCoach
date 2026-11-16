const { randomBytes, createHash } = require('node:crypto');
const { ServiceError } = require('./errors');

function verifiedTokenExpiry(authorization, now = Date.now()) {
    // Used only AFTER sportsService has verified this JWT. Identity is never read from claims.
    try {
        const payload = JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString('utf8'));
        if (typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp * 1000 > now) return payload.exp * 1000;
    } catch { /* Invalid JWT claims have no valid WebSocket lifetime. */ }
    throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired token');
}

class TicketStore {
    constructor({ ttlMs = 30000, now = Date.now, maxTickets = 1000, maxPerUser = 5 } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.maxTickets = maxTickets;
        this.maxPerUser = maxPerUser;
        this.entries = new Map();
    }

    purge() {
        for (const [key, value] of this.entries) if (value.expiresAt <= this.now()) this.entries.delete(key);
    }

    issue(userId, authorization, tokenExpiresAt) {
        this.purge();
        const count = [...this.entries.values()].filter((entry) => entry.userId === userId).length;
        if (this.entries.size >= this.maxTickets || count >= this.maxPerUser) {
            throw new ServiceError(429, 'RATE_LIMITED', 'Too many outstanding WebSocket tickets');
        }
        const expiresAt = Math.min(this.now() + this.ttlMs, tokenExpiresAt);
        if (expiresAt <= this.now()) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired token');
        const ticket = randomBytes(32).toString('base64url');
        this.entries.set(this.hash(ticket), { userId, authorization, tokenExpiresAt, expiresAt });
        return { ticket, expires_at: new Date(expiresAt).toISOString() };
    }

    hash(ticket) { return createHash('sha256').update(ticket).digest('hex'); }

    consume(ticket) {
        if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
            throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired WebSocket ticket');
        }
        const key = this.hash(ticket);
        const entry = this.entries.get(key);
        // Delete synchronously before any remote authentication call: one winner only.
        this.entries.delete(key);
        if (!entry || entry.expiresAt <= this.now()) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired WebSocket ticket');
        return entry;
    }

    clear() { this.entries.clear(); }
}

module.exports = { TicketStore, verifiedTokenExpiry };
