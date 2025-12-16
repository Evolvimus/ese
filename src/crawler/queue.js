const Bottleneck = require('bottleneck');

class RequestQueue {
    constructor() {
        // Limit to 50 requests simultaneous (Stable High Speed)
        this.limiter = new Bottleneck({
            minTime: 50, // 50ms (Polite but fast)
            maxConcurrent: 50
        });
    }

    /**
     * Schedule a task to be executed with rate limiting.
     * @param {Function} taskFunction - Async function to execute
     */
    async add(taskFunction) {
        return this.limiter.schedule(taskFunction);
    }
}

module.exports = new RequestQueue();
