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

                console.log(`[API] Received Crawl Request for: ${city}`);
                startDiscoveryAndCrawl(city); // Async trigger

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'started', city }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // 2. API: Status
    if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(activeJobs));
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

                // Start Job
                const job = { city: 'community', url, status: 'indexing', pages_crawled: 0 };
                activeJobs.push(job);
                queue.add(() => processRecursive(url, `community_${category || 'general'}`, 0, job));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'queued', url }));
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

        // Add active jobs to the "Pending" count or valid count depending on definition
        // For now, only completed/stored pages are counted.

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total_pages: totalPages, active_crawlers: activeJobs.length }));
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

async function startDiscoveryAndCrawl(city) {
    // Track Job
    const job = { city, status: 'discovering', pages_crawled: 0 };
    activeJobs.push(job);

    // 1. Discovery
    console.log(`[Core] Discovering domains for ${city}...`);
    broadcast('info', `Initializing discovery for target: ${city}`);
    const seeds = await discovery.discoverDomains(city);

    if (seeds.length === 0) {
        job.status = 'failed: no_domains_found';
        broadcast('error', `No domains found for ${city}`);
        return;
    }

    job.status = 'crawling';
    console.log(`[Core] Found ${seeds.length} seeds. Starting Deep Crawl.`);
    broadcast('success', `Discovery complete. Found ${seeds.length} candidate domains.`);

    // 2. Queue Seeds
    for (const url of seeds) {
        queue.add(() => processRecursive(url, city, 0, job));
    }
}

// Set of visited URLs to prevent loops
const visited = new Set();
const llmService = require('../util/llm_service');

async function processRecursive(url, city, depth, job) {
    if (visited.has(url) || depth > 2) return;
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
    if (depth < 2) {
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
