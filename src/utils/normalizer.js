export function cleanTitle(title) {
    if (!title) return '';
    return String(title)
        .replace(/\b(unabridged|abridged|audiobook|audio edition|complete edition)\b/gi, '')
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function cleanAuthor(authors) {
    if (!authors) return '';
    const raw = Array.isArray(authors) ? authors[0] : authors;
    if (!raw) return '';
    return cleanTitle(String(raw).replace(/^(by|written by)\s+/i, ''));
}

export function cleanNarrator(narrators) {
    if (!narrators) return 'unknown';
    const raw = Array.isArray(narrators) ? narrators[0] : narrators;
    if (!raw || String(raw).trim() === '') return 'unknown';
    const cleaned = cleanTitle(String(raw).replace(/^(narrated by|read by|performed by)\s+/i, ''));
    return cleaned || 'unknown';
}

export function generateWorkFingerprint(title, authors) {
    const t = cleanTitle(title);
    const a = cleanAuthor(authors);
    return `${t}:${a}`;
}

export function generateFingerprint(title, authors, narrators) {
    const work = generateWorkFingerprint(title, authors);
    const n = cleanNarrator(narrators);
    return `${work}:${n}`;
}

export function generateSlug(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
