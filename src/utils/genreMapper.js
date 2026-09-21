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

const awardKeywords = ['audie award', 'grammy award', 'best audio book', 'audiobook of the year', 'hugo award', 'nebula award'];

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

export function extractAwards(subjects) {
    if (!subjects || !Array.isArray(subjects)) return [];
    const awards = new Set();
    for (const subject of subjects) {
        const lower = String(subject).toLowerCase();
        for (const keyword of awardKeywords) {
            if (lower.includes(keyword)) awards.add(subject.trim());
        }
    }
    return Array.from(awards);
}
