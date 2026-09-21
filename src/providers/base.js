export class BaseProvider {
    constructor(name) {
        this.name = name;
    }
    async search(query, skip = 0) { throw new Error("Not implemented"); }
    async getMeta(id) { throw new Error("Not implemented"); }
    async getStreams(id) { throw new Error("Not implemented"); }
    async getByNarrator(narrator, skip = 0) { throw new Error("Not implemented"); }
    async getByGenre(genre, skip = 0) { throw new Error("Not implemented"); }
    async getSeries(seriesName, skip = 0) { throw new Error("Not implemented"); }
}
