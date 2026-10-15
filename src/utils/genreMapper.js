const genreMap = {
    'sci-fi & fantasy': 'Science Fiction', 'science fiction': 'Science Fiction', 'sci-fi': 'Science Fiction',
    'fantasy': 'Fantasy', 'thriller': 'Thriller', 'mystery': 'Mystery', 'romance': 'Romance',
    'horror': 'Horror', 'history': 'History', 'historical': 'History', 'biography': 'Biography',
    'memoir': 'Biography', 'self-help': 'Self-Help', 'business': 'Business', 'economics': 'Business',
    'religion': 'Religion', 'spirituality': 'Religion', 'young adult': 'Young Adult', 'children': 'Children',
    'classics': 'Classics', 'literature': 'Literature', 'fiction': 'Fiction', 'nonfiction': 'Non-Fiction',
    'non-fiction': 'Non-Fiction', 'true crime': 'True Crime', 'comedy': 'Comedy', 'humor': 'Comedy',
    'drama': 'Drama', 'action': 'Action', 'adventure': 'Adventure', 'speculative': 'Science Fiction'
};

const awardKeywords = [
    'audie award', 'grammy award', 'best audiobook', 'best audio book',
    'audiobook of the year', 'hugo award', 'nebula award', 'newbery medal',
    'caldecott medal', 'pulitzer prize', 'national book award',
    'goodreads choice award', 'man booker prize', 'booker prize'
];

const awardAchievement = /\\b(winner|winners|won|recipient|recipients|award[- ]winning|received|awarded)\\b/i;

export function normalizeGenres(genres) {
    if (!genres || !Array.isArray(genres)) return [];
    const normalized = new Set();
    for (const genre of genres) {
        if (!genre) continue;
        const lower = String(genre).toLowerCase().trim();
        if (genreMap[lower]) normalized.add(genreMap[lower]);
        else normalized.add(lower.charAt(0).toUpperCase() + lower.slice(1));
    }
    return Array.from(normalized);
}

export function extractAwards(evidence) {
    if (!evidence) return [];
    const entries = Array.isArray(evidence) ? evidence : [evidence];
    const awards = new Set();

    for (const entry of entries) {
        if (entry === null || entry === undefined) continue;
        const text = String(entry).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        const lower = text.toLowerCase();
        if (!awardAchievement.test(lower)) continue;

        for (const keyword of awardKeywords) {
            if (lower.includes(keyword)) {
                awards.add(keyword.replace(/\\b\\w/g, character => character.toUpperCase()));
            }
        }
    }
    return [...awards];
}
