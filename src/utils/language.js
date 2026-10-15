const aliases = new Map([
    ['en', 'en'], ['eng', 'en'], ['english', 'en'],
    ['bn', 'bn'], ['ben', 'bn'], ['bengali', 'bn'], ['bangla', 'bn'],
    ['hi', 'hi'], ['hin', 'hi'], ['hindi', 'hi'],
    ['ur', 'ur'], ['urd', 'ur'], ['urdu', 'ur'],
    ['ar', 'ar'], ['ara', 'ar'], ['arabic', 'ar'],
    ['tr', 'tr'], ['tur', 'tr'], ['turkish', 'tr'],
    ['es', 'es'], ['spa', 'es'], ['spanish', 'es'],
    ['fr', 'fr'], ['fra', 'fr'], ['fre', 'fr'], ['french', 'fr'],
    ['de', 'de'], ['deu', 'de'], ['ger', 'de'], ['german', 'de']
]);

export function normalizeLanguage(value) {
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
        if (candidate === null || candidate === undefined) continue;
        const raw = String(candidate).trim().toLowerCase();
        if (!raw || raw === 'multilingual' || raw === 'mul') continue;
        const finalSegment = raw.split('/').filter(Boolean).pop() || raw;
        const normalized = aliases.get(finalSegment) || aliases.get(raw);
        if (normalized) return normalized;
    }
    return null;
}

const libraryLanguageCodes = new Map([
    ['en', 'eng'], ['bn', 'ben'], ['hi', 'hin'], ['ur', 'urd'], ['ar', 'ara'],
    ['tr', 'tur'], ['es', 'spa'], ['fr', 'fre'], ['de', 'ger']
]);

export function toLibraryLanguageCode(value) {
    const language = normalizeLanguage(value);
    return language ? libraryLanguageCodes.get(language) || null : null;
}

export function filterByLanguage(items, language) {
    if (!language || language === 'all') return items;
    const wanted = normalizeLanguage(language);
    if (!wanted) return items;
    return items.filter(item => normalizeLanguage(item?.language) === wanted);
}
