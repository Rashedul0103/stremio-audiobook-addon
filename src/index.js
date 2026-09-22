import pkg from 'stremio-addon-sdk';
const { getRouter } = pkg;
import express from 'express';
import compression from 'compression';
import { manifest } from './stremio/manifest.js';
import { addonInterface } from './stremio/router.js';
import { getConfigureHtml } from './stremio/configureHtml.js';

const app = express();
const PORT = process.env.PORT || 7000;
const HOST = '0.0.0.0';

const defaultExtra = [
    { name: 'skip', isRequired: false },
    { name: 'search', isRequired: false }
];

// 1. Gzip/Brotli Compression
app.use(compression());

// 2. Serve Penguplay-style Configuration UI (with Edit-Mode Pre-filling)
app.get(['/', '/configure', '/:config/configure'], (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getConfigureHtml(manifest, req.get('host'), req.params.config));
});

// 3. Dynamic Manifest: Filter Disabled Rows AND Inject Pinned Rows
app.get('/:config/manifest.json', (req, res, next) => {
    try {
        const config = JSON.parse(decodeURIComponent(req.params.config));
        
        let dynamicCatalogs = manifest.catalogs.filter(c => {
            const key = 'cat_' + c.id;
            return config[key] !== false;
        });

        if (config.pinned_author) {
            dynamicCatalogs.unshift({
                type: 'movie',
                id: 'pinned_author',
                name: 'Author: ' + config.pinned_author,
                extra: defaultExtra
            });
        }

        if (config.pinned_narrator) {
            dynamicCatalogs.unshift({
                type: 'movie',
                id: 'pinned_narrator',
                name: 'Narrated by: ' + config.pinned_narrator,
                extra: defaultExtra
            });
        }

        const filteredManifest = {
            ...manifest,
            catalogs: dynamicCatalogs
        };

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.json(filteredManifest);
    } catch (e) {
        next();
    }
});

// 4. Stremio Addon SDK Router
app.use(getRouter(addonInterface));

app.listen(PORT, HOST, () => {
    console.log('🎧 Cinemeta of Audiobooks running on port ' + PORT);
    console.log('⚙️  Penguplay-style Configurator: http://localhost:' + PORT + '/configure');
    console.log('📡 Default Manifest: http://localhost:' + PORT + '/manifest.json');
});
