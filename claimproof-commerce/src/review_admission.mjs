// Controls in-memory review/advisory admission for the loopback-only contest demo.
// A pending AI request counts toward the same live budget as a saved review.
export class ReviewAdmission {
  constructor({liveLimit = 250, pendingLimit = 8, ttlMs = 30 * 60 * 1000} = {}) {
    for (const [name, value] of Object.entries({liveLimit, pendingLimit, ttlMs})) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + ' must be a positive integer');
    }
    if (pendingLimit > liveLimit) throw new RangeError('pendingLimit cannot exceed liveLimit');
    this.liveLimit = liveLimit;
    this.pendingLimit = pendingLimit;
    this.ttlMs = ttlMs;
    this.pending = 0;
  }

  prune(reviews, now = Date.now()) {
    for (const [id, review] of reviews) {
      if (!Number.isFinite(review?.created) || now - review.created > this.ttlMs) reviews.delete(id);
    }
  }

  reserve(reviews, now = Date.now()) {
    this.prune(reviews, now);
    if (this.pending >= this.pendingLimit) return {accepted: false, reason: 'advisory_concurrency'};
    if (reviews.size + this.pending >= this.liveLimit) return {accepted: false, reason: 'review_capacity'};
    ++this.pending;
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        --this.pending;
      }
    };
  }
}
