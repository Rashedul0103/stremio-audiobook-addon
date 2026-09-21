import NodeCache from 'node-cache';

export const metaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
export const catalogCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
export const streamCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
