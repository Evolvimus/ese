const axios = require('axios');
const cheerio = require('cheerio');
const axiosRetry = require('axios-retry').default; // Robustness

const RAW_USER_AGENT = 'Mozilla/5.0 (compatible; EvolvimusBot/1.0; +https://evolvimus.com/bot)';

class SemanticFetcher {
    constructor() {
        this.client = axios.create({
            timeout: 30000, // 30s timeout (increased from 15s)
            headers: {
                'User-Agent': RAW_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 500 // Accept 404s/403s to handle gracefully in logic
        });

        // 3 Retries with exponential backoff
        axiosRetry(this.client, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
            }
        });
    }

    async fetchPage(url) {
        try {
            const start = Date.now();
            const response = await this.client.get(url);
            const duration = Date.now() - start;

            const $ = cheerio.load(response.data);

            // 1. Cleanup
            $('script, style, noscript, iframe, svg').remove();

            // 2. Metadata Extraction
            const meta = {
                title: $('title').text().trim(),
                description: $('meta[name="description"]').attr('content') || '',
                keywords: $('meta[name="keywords"]').attr('content') || '',
                ogTitle: $('meta[property="og:title"]').attr('content'),
                ogImage: $('meta[property="og:image"]').attr('content'),
                generator: $('meta[name="generator"]').attr('content')
            };

            // 3. Semantic Content Extraction (Markdown-ish)
            let structuredContent = "";

            $('body').find('h1, h2, h3, h4, h5, h6, p, ul, ol, table').each((i, el) => {
                const tag = el.tagName.toLowerCase();
                const text = $(el).text().trim().replace(/\s+/g, ' ');
                if (!text) return;

                if (['h1', 'h2', 'h3'].includes(tag)) {
                    structuredContent += `\n\n# ${text}`;
                } else if (['h4', 'h5', 'h6'].includes(tag)) {
                    structuredContent += `\n## ${text}`;
                } else if (tag === 'p') {
                    structuredContent += `\n${text}`;
                } else if (tag === 'ul' || tag === 'ol') {
                    $(el).find('li').each((j, li) => {
                        structuredContent += `\n - ${$(li).text().trim()}`;
                    });
                } else if (tag === 'table') {
                    structuredContent += `\n[Table Data: ${text.substring(0, 100)}...]`;
                }
            });

            // 4. Link Access & Classification (Smart Structure Detection)
            const internalLinks = new Set();
            const externalLinks = new Set();
            const navLinks = new Set();
            const footerLinks = new Set();
            const baseUrlObj = new URL(url);

            const procesLink = (el, targetSet) => {
                let href = $(el).attr('href');
                if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
                try {
                    const absUrl = new URL(href, url).href;
                    targetSet.add(absUrl);

                    // Also add to general classification
                    if (new URL(absUrl).hostname === baseUrlObj.hostname) {
                        internalLinks.add(absUrl);
                    } else {
                        externalLinks.add(absUrl);
                    }
                } catch (e) { }
            };

            // Prioritize Structural Links
            $('nav').find('a').each((i, el) => procesLink(el, navLinks));
            $('footer').find('a').each((i, el) => procesLink(el, footerLinks));

            // General Links
            $('a').each((i, el) => procesLink(el, new Set())); // Just to populate internal/external

            return {
                url,
                statusCode: response.status,
                meta,
                markdown: structuredContent.trim(),
                textContent: structuredContent.trim(), // Keep compatibility
                internalLinks: [...internalLinks],
                externalLinks: [...externalLinks],
                navLinks: [...navLinks],
                footerLinks: [...footerLinks],
                duration
            };

        } catch (error) {
            console.error(`[Fetcher] Error fetching ${url}:`, error.message);
            return null;
        }
    }
}

module.exports = new SemanticFetcher();
