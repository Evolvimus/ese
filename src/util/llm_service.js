const axios = require('axios');

class LLMService {
    constructor() {
        this.apiUrl = 'http://localhost:11434/api/generate';
        this.model = 'llama3.2:3b';
    }

    /**
     * Analyzes content to determine Country, City, and Category.
     * @param {string} content Markdown/Text content of the page
     * @param {string} url The URL of the page (for context)
     * @returns {Promise<{country: string, city: string, category: string}>}
     */
    async classify(content, url) {
        // Truncate content to avoid token limits (keep first 2000 chars which usually contain the essence)
        const snippet = content.substring(0, 2000);

        const prompt = `
        Analyze the following website content and URL to determine the Country (ISO 2-letter, e.g. DE, US), City (e.g. Coburg, Berlin), and Category.
        
        URL: ${url}
        Content Snippet:
        ${snippet}

        Categories: [Government, Business, Tourism, News, Education, Other]

        Return ONLY a JSON object with keys: "country", "city", "category". 
        Do not add any markdown formatting or explanation.
        Example: {"country": "DE", "city": "Coburg", "category": "Government"}
        `;

        try {
            const response = await axios.post(this.apiUrl, {
                model: this.model,
                prompt: prompt,
                stream: false,
                format: "json"
            });

            const result = JSON.parse(response.data.response);

            // Normalize
            return {
                country: (result.country || 'Unknown').toUpperCase(),
                city: (result.city || 'Unknown').replace(/\s+/g, '-'),
                category: (result.category || 'Other').replace(/\s+/g, '-')
            };

        } catch (error) {
            console.error('[LLM] Classification failed:', error.message);
            // Fallback
            return { country: 'DE', city: 'Unknown', category: 'General' };
        }
    }
}

module.exports = new LLMService();
