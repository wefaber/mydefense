# 0005 · Repos are indexed, not copied file by file

Status: accepted · 2026-11-02

## Context

A team can import the documents of an org repo (`eternum-docs`: 238 Markdown and text files). The first version made one
`materials` row per file, which ran into the 50-materials cap, made the user pick a folder by hand, and gave nothing to
search with: the F4 pipeline (questions from the sources) and Ask Ether (F7) both need chunks, not files.

eternum-board already solves this for the Eternum docs: it chunks each document, embeds the chunks with EmbeddingGemma 2
and ranks by cosine fused with a lexical match. ADR 0002 rules out reading the Board's `index.db`; MyDefense builds its
own index for the teams' own sources, with the same method.

## Decision

1. **A source, not N materials.** `sources` holds one row per (team, repo, folder, ref) with the tree sha that was
   indexed. `source_files` holds each file's blob sha and chunk count; `chunks` holds the text, a sha1 of
   `title + text`, the model and the vector (little-endian float32, null until embedded). Uploaded files stay in
   `materials`; the two are separate on purpose.
2. **Same chunker as the Board.** 1200 characters, 200 overlap, cut at a paragraph or sentence, at most 80 chunks per
   file, crumbs under 40 characters dropped (`chunkText` in `server/knowledge.ts`).
3. **Words always, meaning when it can.** Every chunk goes into an FTS5 table (`chunks_fts`, `unicode61` without
   diacritics, rowid = chunk id). Embeddings come from `@wefaber/embed` (the house embedder) when
   `MYDEFENSE_EMBED_URL` is set. A chunk the team already embedded (same hash, same model) is reused. If the embedder is
   off or down the sync still succeeds with words only, and the next sync embeds what is missing.
4. **Search = reciprocal-rank fusion** of the FTS5 ranking (bm25) and the cosine ranking, at most 2 passages per file.
   The query embedding gets 1.5 s; past that the answer is lexical. The query goes to FTS5 as quoted prefix terms joined
   with OR, so free text can never be FTS5 syntax.
5. **Incremental.** A re-sync fetches the tree once, compares blob shas, downloads only new or changed files, drops the
   chunks of removed ones, and writes everything in one transaction (rows, FTS index, counters).
6. **Limits.** 10 sources per team, 500 files per source (the user narrows with a folder when the repo has more),
   6000 chunks per team, 2 MB per file.
7. **Access.** Only fresh members of the configured GitHub org may sync (ADR 0004); the owner is always that org; the
   token (`MYDEFENSE_GITHUB_IMPORT_TOKEN`, read-only Contents) never leaves the server. Team members list and search;
   the director or whoever imported a source removes it.
8. **Content is data.** Repo text is stored and searched, never followed. Anything a later phase sends to an LLM from
   these chunks is fenced like the rest of the material.

## Consequences

- Needs a migration with a hand-written FTS5 table (drizzle-kit does not model it). Expand-only, so blue and green can
  share the database.
- Vectors are stored in SQLite and ranked in memory per query: fine up to the 6000-chunk cap (about 18 MB per team at
  768 dimensions). A larger team needs a vector index; revisit then.
- F4 (generate points and questions, `server/authoring.ts`) and F7 (Ask Ether) read from `chunks` through
  `server/db/knowledge.ts`. The generated draft stays in `generation_runs` until a director approves it.
- Other source kinds (uploaded PDF and DOCX, text extraction) can write the same `chunks` table with another `kind`.
