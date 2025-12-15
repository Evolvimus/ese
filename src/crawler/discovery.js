const fetcher = require('./fetcher');

class DiscoveryService {

    /**
     * Generates potential domains for a city and checks reachability.
     * @param {string} city 
     * @returns {Promise<string[]>} List of valid seed URLs
     */
    async discoverDomains(city) {
        const normalized = city.toLowerCase().replace(/ü/g, 'ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ß/g, 'ss');

        // Common patterns for German cities
        const candidates = [
            `https://www.${normalized}.de`,
            `https://${normalized}.de`,
            `https://tourismus-${normalized}.de`,
            `https://www.landkreis-${normalized}.de`
        ];

        console.log(`[Discovery] Probing ${candidates.length} candidates for ${city}...`);

        const validUrls = [];

        // In a real engine, we would use Google Search API here.
        // For ESE v1, we probe the candidates directly.
        for (const url of candidates) {
            try {
                // Quick HEAD check or shallow GET
                const data = await fetcher.fetchPage(url);
                if (data && data.statusCode < 400) {
                    console.log(`[Discovery] Found Valid entry: ${url}`);
                    validUrls.push(url);
                }
            } catch (e) {
                // Ignore failures
            }
        }

        return validUrls;
    }
}

module.exports = new DiscoveryService();
