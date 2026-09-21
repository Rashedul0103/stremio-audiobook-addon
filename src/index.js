import pkg from 'stremio-addon-sdk';
const { serveHTTP } = pkg;
import { addonInterface } from './stremio/router.js';

const PORT = process.env.PORT || 7000;
const HOST = '0.0.0.0';

serveHTTP(addonInterface, { port: PORT, hostname: HOST }).then(() => {
    console.log(`🎧 Cinemeta of Audiobooks is LIVE on http://localhost:${PORT}`);
    console.log(`📡 Local Network / Nuvio Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(`🚀 Click to install on Stremio: stremio://localhost:${PORT}/manifest.json`);
});
