const Bottleneck = require('bottleneck');

class RequestQueue {
    constructor() {
        // Limit to 2 requests per second to be polite (500ms min time)
        this.limiter = new Bottleneck({
            minTime: 500,
            maxConcurrent: 5
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
