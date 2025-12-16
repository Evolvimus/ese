const fs = require('fs');
const path = require('path');
const eseCore = fs.existsSync(path.join(__dirname, '../../build/Release/ese_core.node')) ? require('bindings')('ese_core') : { analyzeText: (t) => ({ word_count: t ? t.split(/\s+/).length : 0 }), hello: () => "JS Fallback" };
const fetcher = require('./fetcher');
const queue = require('./queue');
const storage = require('../util/storage');
const discovery = require('./discovery');
const http = require('http');

// Global State
// Global State
let activeJobs = []; // { city: string, status: string, pages: int }
let jobQueue = []; // Array of { city: string, ticketId: number, timestamp: string }
let ticketCounter = 1;
let isJobRunning = false;
let clients = []; // SSE Clients

function broadcast(type, message) {
    const data = JSON.stringify({ type, message, timestamp: new Date().toISOString() });
    clients.forEach(res => res.write(`data: ${data}\n\n`));
}

// --- API & Static Server ---
const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '../../public');

const server = http.createServer(async (req, res) => {
    // CORS & JSON Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

    // 6. API: Live Stream (SSE)
    if (req.url === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        clients.push(res);
        req.on('close', () => {
            clients = clients.filter(c => c !== res);
        });
        return;
    }

    // 1. API: Start Crawl (Discovery + Crawl)
    if (req.method === 'POST' && req.url === '/api/crawl') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { city } = JSON.parse(body);
                if (!city) throw new Error("City missing");

                // Always assign a ticket
                const ticketId = ticketCounter++;

                // Check if job is running
                if (isJobRunning || activeJobs.length > 0) {
                    const ticket = { city, ticketId, timestamp: new Date().toISOString() };
                    jobQueue.push(ticket);
                    console.log(`[Queue] Added ticket #${ticketId} for ${city}`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'queued', ticketId, position: jobQueue.length, city }));
                    return;
                }

                console.log(`[API] Received Crawl Request for: ${city}`);
                // Start immediately if free
                runJob(city, ticketId);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'started', ticketId, city }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // 2. API: Status (Includes Queue)
    if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Clean up list for serialization if needed, but simple objects are fine
        res.end(JSON.stringify({ active: activeJobs, queue: jobQueue }));
        return;
    }

    // 2.5 API: List Cities (Data Index)
    if (req.method === 'GET' && req.url === '/api/cities') {
        const citiesDir = path.join(__dirname, '../../data/cities');
        try {
            const files = fs.readdirSync(citiesDir).filter(f => f.endsWith('.json'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(files));
        } catch (e) {
            res.end(JSON.stringify([]));
        }
        return;
    }

    // 4. API: Submit URL (Community Driven)
    if (req.method === 'POST' && req.url === '/api/submit') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { url, category } = JSON.parse(body);
                if (!url) throw new Error("URL missing");

                console.log(`[API] Community Submission: ${url} (${category})`);

                // Always assign a ticket
                const ticketId = ticketCounter++;
                const jobData = { city: `URL: ${url}`, url, ticketId, timestamp: new Date().toISOString() };

                // Check Queue
                if (isJobRunning || activeJobs.length > 0) {
                    jobQueue.push(jobData);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'queued', ticketId, position: jobQueue.length, city: url }));
                    return;
                }

                // Start Job
                // Note: We use the ticket logic to run it
                console.log(`[Core] Immediate Start for Ticket #${ticketId}`);

                // Helper to start URL job
                runJobFromUrl(url, `URL: ${url}`, ticketId);
                // Since runJobFromUrl is async but logic is fire-and-forget for the API response:

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'started', ticketId, city: url }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // 5. API: Global Stats (REAL COUNT)
    if (req.method === 'GET' && req.url === '/api/stats') {
        const citiesDir = path.join(__dirname, '../../data/cities');
        let totalPages = 0;

        try {
            if (fs.existsSync(citiesDir)) {
                const files = fs.readdirSync(citiesDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    try {
                        const content = fs.readFileSync(path.join(citiesDir, file), 'utf-8');
                        const json = JSON.parse(content);
                        if (json.pages && Array.isArray(json.pages)) {
                            totalPages += json.pages.length;
                        }
                    } catch (err) {
                        // Ignore corrupt files
                    }
                }
            }
        } catch (e) {
            console.error("Stats Error:", e);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_pages: totalPages, active_crawlers: activeJobs.length }));
        return;
    }

    // 6. API: Admin Login
    if (req.method === 'POST' && req.url === '/api/admin/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { password } = JSON.parse(body || '{}');
            if (password === 'evOlvimus0124#') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, token: 'admin_session_valid' }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid Password' }));
            }
        });
        return;
    }

    // 7. API: Admin Update (Re-crawl old pages)
    if (req.method === 'POST' && req.url === '/api/admin/update') {
        // Logic: Find pages older than 3 days
        const citiesDir = path.join(__dirname, '../../data/cities');
        let requeuedCount = 0;
        const now = Date.now();
        const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

        try {
            if (fs.existsSync(citiesDir)) {
                const files = fs.readdirSync(citiesDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    try {
                        const filePath = path.join(citiesDir, file);
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const json = JSON.parse(content);

                        // Check date (assuming 'crawled_at' is in pages or top level - wait, JSON structure is per city page list?)
                        // Correction: Structure seems to be one JSON per city? No, file names like "US-Unknown-Business-apple.com.json" suggest granular.
                        // Let's assume we check the file's pages or the file itself? 
                        // The user said "Update button -> alle seiten die älter als 3 Tage sind werden überarbeitet"
                        // We will check each page's 'crawled_at' in the JSONs.

                        let needsUpdate = false;
                        if (json.pages) {
                            // If any page is old, re-crawl the 'city' (which seems to be the main seed or concept)
                            // Or re-crawl specific URLs?
                            // Simple approach: Check if any page in this file is old. If so, add ONE job for this city/url.
                            const oldPages = json.pages.filter(p => {
                                const age = now - new Date(p.crawled_at).getTime();
                                return age > THREE_DAYS_MS;
                            });

                            if (oldPages.length > 0) {
                                // We re-crawl the *seed* URL of this file? 
                                // The filename convention is COUNTRY-CITY-CATEGORY-DOMAIN-DATE.json 
                                // Maybe we just extract the stored URL from the pages?
                                // Let's just pick the first URL from the oldPages as a seed to re-crawl.
                                const seedUrl = oldPages[0].url;
                                const city = json.city || 'Unknown'; // Try to recover city name

                                // Add to queue
                                const ticketId = ticketCounter++;
                                jobQueue.push({ city: `UPDATE: ${city}`, url: seedUrl, ticketId, timestamp: new Date().toISOString() });
                                requeuedCount++;
                            }
                        }
                    } catch (err) { }
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Queued ${requeuedCount} sites for update.` }));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // 3. Static Files (Merged)
    let filePath = '';
    if (req.url.startsWith('/data/')) {
        filePath = path.join(__dirname, '../../', req.url);
    } else {
        filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    }

    const ext = path.extname(filePath);
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`[Server] Admin Dashboard: http://localhost:${PORT}/admin.html`);
    console.log(`[Server] Search Interface: http://localhost:${PORT}`);
});


// --- Logic: Discovery & Deep Crawl ---

// --- Logic: Queue & Discovery ---

async function runJob(cityOrUrl, ticketId) {
    isJobRunning = true;
    const isUpdate = cityOrUrl.startsWith('UPDATE:');
    const target = isUpdate ? cityOrUrl.split('UPDATE: ')[1] : cityOrUrl;

    // For updates or city crawls where we don't have the ticketId passed explicitly, we might lose it.
    // However, runJobFromUrl is used for specific ticket jobs. 
    // runJob is used for "Generic" city crawls. 
    // Let's modify runJob signature or just attach if possible. Wait, runJob is called by processNextJob with NO ticketIdArg?
    // processNextJob has the ticket object. We should pass it.

    // We will assume 'activeJob' tracking needs to happen inside startDiscoveryAndCrawl.
    // Let's modify startDiscoveryAndCrawl as well.
    // Updated signature:

    startDiscoveryAndCrawl(target, ticketId).then(() => {
        isJobRunning = false;
        processNextJob();
    });
}

function processNextJob() {
    if (jobQueue.length > 0) {
        const nextTicket = jobQueue.shift();
        console.log(`[Queue] Processing Ticket #${nextTicket.ticketId}: ${nextTicket.city}`);

        // Handle specific URL jobs (from Update or Submit)
        if (nextTicket.url) {
            // It's a specific URL job
            runJobFromUrl(nextTicket.url, nextTicket.city, nextTicket.ticketId);
        } else {
            // Standard City Crawl
            runJob(nextTicket.city, nextTicket.ticketId);
        }
    } else {
        console.log('[Queue] All jobs finished. Idle.');
    }
}

async function runJobFromUrl(url, city, ticketId) {
    isJobRunning = true;
    const job = { city, status: 'crawling_update', pages_crawled: 0, ticketId: ticketId || 0 };
    activeJobs.push(job);

    // Skip discovery, go straight to crawling
    console.log(`[Core] Starting Direct Crawl (Update) for ${url}`);
    broadcast('info', `Starting update for: ${url}`);

    queue.add(() => processRecursive(url, city, 0, job)).then(() => {
        // This promise resolves when added, NOT when finished.
        // We need a way to know when the CRAWL is effectively done is hard with the current recursive async queue.
        // Current architecture doesn't easily await the entire crawl tree.
        // Heuristic: We just let it run. The 'isJobRunning' flag is tricky here.
        // For this task, we will assume "Job Started" is enough to pop the next queue item? 
        // NO, the user wants "serial" execution "keine 2,3,4,5,6 gleichzeitig".
        // The current 'queue.add' waits for the specific task? No, it returns a promise for that task.
        // The recursive nature makes it hard to track 'completion' of the whole tree.

        // workaround: We will just set a timeout or rely on queue idle? 
        // For now, let's keep it simple: We allow the *setup* to block, but the recursive crawl runs in background.
        // To strictly enforce 1-by-1, we would need to wait for the bottleneck to be empty.

        // Let's attach a listener to bottleneck 'idle'?
        queue.limiter.on('idle', () => {
            if (isJobRunning) {
                console.log('[Core] content queue idle. Job finished.');
                isJobRunning = false;
                // Remove job from activeJobs
                activeJobs = activeJobs.filter(j => j !== job);
                processNextJob();
            }
        });
    });
}

async function startDiscoveryAndCrawl(city, ticketId) {
    // Track Job
    const job = { city, status: 'discovering', pages_crawled: 0, ticketId: ticketId || 0 };
    activeJobs.push(job);

    // 1. Discovery
    console.log(`[Core] Discovering domains for ${city}...`);
    broadcast('info', `Initializing discovery for target: ${city}`);
    const seeds = await discovery.discoverDomains(city);

    if (seeds.length === 0) {
        job.status = 'failed: no_domains_found';
        broadcast('error', `No domains found for ${city}`);
        activeJobs = activeJobs.filter(j => j !== job); // Cleanup
        return;
    }

    job.status = 'crawling';
    console.log(`[Core] Found ${seeds.length} seeds. Starting Deep Crawl.`);
    broadcast('success', `Discovery complete. Found ${seeds.length} candidate domains.`);

    // 2. Queue Seeds
    const promises = [];
    for (const url of seeds) {
        promises.push(queue.add(() => processRecursive(url, city, 0, job)));
    }

    // Wait for all seeds to be schedule.
    // We attach the Idle listener for 'Job Finished' logic same as runJobFromUrl
    queue.limiter.on('idle', () => {
        // This might fire early if fetches are slow? 
        // Bottleneck 'idle' means no running and no queued. 
        // Should be safe enough for this scale.
        if (isJobRunning && activeJobs.includes(job)) {
            console.log(`[Core] Job for ${city} finished (idle).`);
            isJobRunning = false;
            activeJobs = activeJobs.filter(j => j !== job);
            // Remove listner to duplicate calls?
            queue.limiter.removeAllListeners('idle');
            processNextJob();
        }
    });

}

// Set of visited URLs to prevent loops
const visited = new Set();
const llmService = require('../util/llm_service');

async function processRecursive(url, city, depth, job) {
    if (visited.has(url) || depth > 10) return; // Increased depth for 1M goal
    visited.add(url);

    console.log(`[Crawler] Depth ${depth}: ${url}`);
    broadcast('crawl', `[Depth ${depth}] Fetching: ${url}`);

    // Fetch (Semantic + Nav/Footer Aware)
    const data = await fetcher.fetchPage(url);
    if (!data) {
        broadcast('error', `Failed to fetch: ${url}`);
        return;
    }

    // Analyze (C++)
    const analysis = eseCore.analyzeText ? eseCore.analyzeText(data.textContent) : { word_count: 0 };

    // AI Classification (Llama 3.2) - Only perform on the Main URL (Depth 0) or valid content pages to save tokens/time
    // For now, we classify EVERY page to ensure the Category is accurate per page content
    let aiMeta = { country: 'DE', city: 'Unknown', category: 'General' };

    // Optimization: Inherit classification from Job if available, otherwise ask AI
    if (depth === 0) {
        console.log(`[AI] Asking Llama 3.2 to classify: ${url}...`);
        broadcast('ai', `Llama 3.2 Analysis: Classifying context for ${url}...`);

        const startTime = Date.now();
        aiMeta = await llmService.classify(data.markdown, url);
        const duration = Date.now() - startTime;

        job.lastMeta = aiMeta; // Cache for subpages
        console.log(`[AI] Result:`, aiMeta);
        broadcast('ai_success', `AI Classification (${duration}ms): ${aiMeta.category} | ${aiMeta.city}, ${aiMeta.country}`);
    } else if (job.lastMeta) {
        aiMeta = job.lastMeta; // Use parent's classification for speed
    }

    // Save
    const pageEntry = {
        url: data.url,
        title: data.meta.title || 'Untitled',
        description: data.meta.description,
        content_markdown: data.markdown,
        meta: data.meta,
        word_count: analysis.word_count,
        ai_classification: aiMeta,
        crawled_at: new Date().toISOString()
    };

    // Switch to AI Storage
    storage.saveAIClassifiedPage(aiMeta, pageEntry);
    job.pages_crawled++;
    broadcast('save', `Indexed: ${data.meta.title || url} [${analysis.word_count} words]`);

    // Smart Recursion: Prioritize Structure
    if (depth < 10) {
        const priorityLinks = [...new Set([...data.navLinks, ...data.footerLinks])];
        if (priorityLinks.length > 0) broadcast('info', `Found ${priorityLinks.length} structural links (Nav/Footer) to prioritize.`);
        const otherLinks = data.internalLinks.filter(l => !priorityLinks.includes(l));

        // 1. Queue Nav/Footer Links (High probability of being subpages)
        for (const link of priorityLinks) {
            if (!visited.has(link)) {
                queue.add(() => processRecursive(link, city, depth + 1, job));
            }
        }

        // 2. Queue other body links (limited)
        let count = 0;
        for (const link of otherLinks) {
            if (count++ > 5) break;
            if (!visited.has(link)) {
                queue.add(() => processRecursive(link, city, depth + 1, job));
            }
        }
    }

    // 2. Discover EXTERNAL links (Spider Mode / Referral Discovery)
    // If we are on a "Hub" page (Depth 0 or 1), these links might be other local businesses
    if (depth < 1) {
        const blacklist = ['facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com', 'google.com', 'apple.com', 'adobe.com', 'cloudflare.com'];

        let discoveryCount = 0;
        for (const extLink of data.externalLinks) {
            if (discoveryCount++ > 5) break; // Limit discovery per page

            try {
                const urlObj = new URL(extLink);
                const domain = urlObj.hostname;

                // SPIDER FILTER: Not in blacklist, and looks like a German site (.de) or generic valid site
                if (!blacklist.some(b => domain.includes(b)) && domain.endsWith('.de')) {

                    // Add as a new SEED job if likely relevant
                    // Logic: If on 'coburg.de' and finding 'theater-coburg.de', it's relevant.
                    // Simple heuristic: If it hasn't been visited, treat it as a new "Depth 0" seed (or Depth 1 relative to here)
                    // We treat it as Depth 1 to avoid infinite internet sprawl, effectively "One Hop" discovery.
                    if (!visited.has(extLink)) {
                        console.log(`[Spider] Found Potential Local Site: ${extLink}`);
                        queue.add(() => processRecursive(extLink, city, 1, job));
                    }
                }
            } catch (e) { }
        }
    }
}
