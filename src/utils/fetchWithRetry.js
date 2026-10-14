import pRetry from 'p-retry';
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

function redactUrl(rawUrl) {
    try {
        const safeUrl = new URL(rawUrl);
        for (const key of ['key', 'api_key', 'apikey', 'token', 'access_token']) {
            if (safeUrl.searchParams.has(key)) safeUrl.searchParams.set(key, '[REDACTED]');
        }
        return safeUrl.toString();
    } catch {
        return '[unparseable URL]';
    }
}

export async function fetchWithRetry(url, options = {}) {
    const timeout = Number(options.timeout) || 5000;
    const { timeout: _ignoredTimeout, ...fetchOptions } = options;
    const isHttps = url.startsWith('https:');

    const headers = {
        'User-Agent': 'CinemetaAudiobooks/1.0.0 (https://github.com/Rashedul0103/stremio-audiobook-addon)',
        'Accept': 'application/json',
        ...(fetchOptions.headers || {})
    };

    try {
        return await pRetry(
            async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);

                try {
                    const response = await fetch(url, {
                        ...fetchOptions,
                        headers,
                        agent: isHttps ? httpsAgent : httpAgent,
                        signal: controller.signal
                    });

                    if (!response.ok) {
                        const error = new Error('HTTP ' + response.status);
                        error.status = response.status;
                        error.nonRetryable = response.status >= 400 &&
                            response.status < 500 &&
                            response.status !== 408 &&
                            response.status !== 429;
                        throw error;
                    }

                    // Keep the abort timer active until the full response body is read.
                    const body = await response.text();
                    try {
                        return JSON.parse(body);
                    } catch {
                        return body;
                    }
                } finally {
                    clearTimeout(timer);
                }
            },
            {
                retries: 2,
                minTimeout: 300,
                shouldRetry: error => !error?.nonRetryable
            }
        );
    } catch (error) {
        console.warn('[Fetch Fail] ' + redactUrl(url) + ': ' + error.message);
        return null;
    }
}
