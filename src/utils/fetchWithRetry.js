import pRetry from 'p-retry';
import fetch from 'node-fetch';

export async function fetchWithRetry(url, options = {}) {
    const timeout = options.timeout || 5000;
    
    const headers = {
        'User-Agent': 'AudiobookStremioAddon/1.0.0 (https://github.com/stremio-audiobooks)',
        'Accept': 'application/json',
        ...(options.headers || {})
    };

    try {
        const res = await pRetry(
            async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                
                try {
                    const response = await fetch(url, { 
                        ...options, 
                        headers, 
                        signal: controller.signal 
                    });
                    clearTimeout(timer);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response;
                } catch (err) {
                    clearTimeout(timer);
                    throw err;
                }
            },
            { retries: 2, minTimeout: 300 }
        );
        
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    } catch (error) {
        console.warn(`[Fetch Fail] ${url}: ${error.message}`);
        return null;
    }
}
