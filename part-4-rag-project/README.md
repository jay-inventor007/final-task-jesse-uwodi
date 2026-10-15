# Part 4: RAG Project (NUC CCMAS Medicine & Dentistry)

A retrieval system over the National Universities Commission Core Curriculum and Minimum Academic Standards (CCMAS 2023) for Medicine and Dentistry.

## Current state

What works today:

- PDF text extraction with `pypdf` ([`src/pipeline.py`](./src/pipeline.py)). Only the **first 40 pages** of the 275-page document are indexed so far.
- Two chunking strategies: fixed-size word windows with overlap, and section-based splitting on headings and course codes.
- Embeddings from Voyage AI (`voyage-3`), cached on disk by a SHA-256 hash of model + text so the same text is never embedded twice.
- In-memory cosine similarity search with a top-k cutoff and a similarity threshold (0.42). Below the threshold the system refuses.
- A local web page ([`public/index.html`](./public/index.html)) served by [`src/server.py`](./src/server.py) that shows the retrieved chunks with page numbers.

Not built yet (required by the brief):

- A language model step that writes an answer from the retrieved chunks. Today the "answer" is the retrieved text itself.
- Full-corpus ingestion, running as a background job with progress shown
- pgvector storage with a vector index
- Metadata filters, rate limiting on the chat endpoint, and per-query logging (chunk IDs, scores, latency, token cost)
- A planted prompt-injection document and a test of how the system handles it
- An evaluation that checks whether the *correct* chunk was retrieved and the answer was correct, for both chunking strategies and two values of k
- Deployment

## Run locally

```powershell
cd part-4-rag-project
pip install pypdf
copy .env.example .env   # then add your own VOYAGE_API_KEY
python src/server.py     # http://localhost:5050
```
