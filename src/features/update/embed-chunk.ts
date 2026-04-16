import { createHash } from "node:crypto";

export type ChunkKind = "name" | "description" | "content";

export type Chunk = {
    kind: ChunkKind;
    chunkIndex: number;
    text: string;
    contentHash: string;
};

function hash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function splitByHeadings(body: string): string[] {
    const lines = body.split(/\r?\n/);
    const sections: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
        if (/^#{2,3}\s+/.test(line) && current.length > 0) {
            sections.push(current.join("\n").trim());
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) sections.push(current.join("\n").trim());
    return sections.filter(Boolean);
}

function splitOversized(text: string, maxChars: number, overlapChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const out: string[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + maxChars, text.length);
        out.push(text.slice(start, end));
        if (end === text.length) break;
        start = end - overlapChars;
    }
    return out;
}

export function chunkSkill(params: {
    name: string | null;
    description: string | null;
    body: string;
    chunkTokens: number;
    chunkOverlap: number;
}): Chunk[] {
    const { name, description, body, chunkTokens, chunkOverlap } = params;
    // Rough heuristic: 1 token ~= 4 chars
    const maxChars = chunkTokens * 4;
    const overlapChars = chunkOverlap * 4;
    const chunks: Chunk[] = [];
    let idx = 0;
    if (name) {
        chunks.push({
            kind: "name",
            chunkIndex: idx++,
            text: name,
            contentHash: hash(name),
        });
    }
    if (description) {
        chunks.push({
            kind: "description",
            chunkIndex: idx++,
            text: description,
            contentHash: hash(description),
        });
    }
    for (const section of splitByHeadings(body)) {
        for (const piece of splitOversized(section, maxChars, overlapChars)) {
            const text = piece.trim();
            if (!text) continue;
            chunks.push({
                kind: "content",
                chunkIndex: idx++,
                text,
                contentHash: hash(text),
            });
        }
    }
    return chunks;
}
