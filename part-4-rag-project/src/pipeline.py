"""
Production RAG Pipeline for Nigerian Medical & Dentistry CCMAS (275 Pages)
- Embeddings: Voyage AI (voyage-3, 1024 dims)
- Corpus: Medicine-and-Dentistry-CCMAS-2023-FINAL.pdf
- Chunking: Strategy A (Fixed 500 tokens) vs Strategy B (Structural Sections)
- Dual Vector Store: In-memory cosine distance + pgvector SQL export
- Local Disk Cache: Prevents duplicate API token consumption
"""

import os
import re
import json
import hashlib
import urllib.request
from typing import List, Dict, Any, Tuple
import pypdf

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_PDF = os.path.join(BASE_DIR, "corpus", "Medicine-and-Dentistry-CCMAS-2023-FINAL.pdf")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
CACHE_FILE = os.path.join(CACHE_DIR, "voyage_embeddings_cache.json")
os.makedirs(CACHE_DIR, exist_ok=True)

# Load Environment Variables from .env
ENV_FILE = os.path.join(BASE_DIR, ".env")
VOYAGE_API_KEY = ""
if os.path.exists(ENV_FILE):
    with open(ENV_FILE, "r") as f:
        for line in f:
            if line.startswith("VOYAGE_API_KEY="):
                VOYAGE_API_KEY = line.strip().split("=", 1)[1]

if not VOYAGE_API_KEY:
    VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")

VOYAGE_MODEL = "voyage-3"
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"


class VoyageClient:
    def __init__(self, api_key: str, model: str = "voyage-3"):
        self.api_key = api_key
        self.model = model
        self.cache: Dict[str, List[float]] = self._load_cache()

    def _load_cache(self) -> Dict[str, List[float]]:
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_cache(self):
        with open(CACHE_FILE, "w") as f:
            json.dump(self.cache, f)

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        results: List[List[float]] = [[] for _ in texts]
        uncached_indices: List[int] = []
        uncached_texts: List[str] = []

        for idx, text in enumerate(texts):
            h = hashlib.sha256(f"{self.model}:{text}".encode("utf-8")).hexdigest()
            if h in self.cache:
                results[idx] = self.cache[h]
            else:
                uncached_indices.append(idx)
                uncached_texts.append(text)

        if not uncached_texts:
            return results

        # Process in batches of 16 to respect Voyage rate limits
        batch_size = 16
        for b_start in range(0, len(uncached_texts), batch_size):
            b_texts = uncached_texts[b_start : b_start + batch_size]
            b_indices = uncached_indices[b_start : b_start + batch_size]

            payload = {
                "input": b_texts,
                "model": self.model
            }
            req = urllib.request.Request(
                VOYAGE_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}"
                }
            )
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for i, item in enumerate(data["data"]):
                    orig_idx = b_indices[i]
                    emb = item["embedding"]
                    results[orig_idx] = emb
                    h = hashlib.sha256(f"{self.model}:{b_texts[i]}".encode("utf-8")).hexdigest()
                    self.cache[h] = emb

        self._save_cache()
        return results

    def embed_query(self, query: str) -> List[float]:
        return self.embed_texts([query])[0]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    # Voyage AI returns normalized unit vectors, so dot product = cosine similarity
    dot = sum(x * y for x, y in zip(a, b))
    return dot


class DocumentChunk:
    def __init__(self, chunk_id: str, text: str, page_num: int, strategy: str, section: str = ""):
        self.chunk_id = chunk_id
        self.text = text
        self.page_num = page_num
        self.strategy = strategy
        self.section = section
        self.embedding: List[float] = []


def extract_pages_from_pdf(pdf_path: str, max_pages: int = 50) -> List[Dict[str, Any]]:
    reader = pypdf.PdfReader(pdf_path)
    total_pages = len(reader.pages)
    num_to_read = min(max_pages, total_pages)
    pages = []
    print(f"Reading {num_to_read} of {total_pages} pages from PDF...", flush=True)
    for idx in range(num_to_read):
        page = reader.pages[idx]
        text = page.extract_text() or ""
        pages.append({
            "page_num": idx + 1,
            "text": text.strip()
        })
    print(f"Extracted text from {len(pages)} pages successfully.", flush=True)
    return pages


def chunk_strategy_a_fixed(pages: List[Dict[str, Any]], chunk_size: int = 500, overlap: int = 100) -> List[DocumentChunk]:
    chunks = []
    chunk_counter = 1
    for page in pages:
        words = page["text"].split()
        if not words:
            continue
        step = chunk_size - overlap
        for i in range(0, len(words), step):
            chunk_words = words[i : i + chunk_size]
            if len(chunk_words) < 30:  # Skip trivial fragments
                continue
            chunk_text = " ".join(chunk_words)
            chunks.append(DocumentChunk(
                chunk_id=f"fixed_p{page['page_num']}_{chunk_counter}",
                text=chunk_text,
                page_num=page["page_num"],
                strategy="FIXED_500",
                section=f"Page {page['page_num']}"
            ))
            chunk_counter += 1
    return chunks


def chunk_strategy_b_structural(pages: List[Dict[str, Any]]) -> List[DocumentChunk]:
    chunks = []
    chunk_counter = 1
    current_section = "General Overview"

    for page in pages:
        lines = page["text"].split("\n")
        section_buffer = []

        for line in lines:
            line_str = line.strip()
            # Detect section headers (e.g. "ANA 201:", "PROGRAMME:", "LEARNING OUTCOMES", Course Codes)
            header_match = re.match(r"^([A-Z]{3}\s*\d{3}|COURSE\s+OUTLINE|LEARNING\s+OUTCOMES|PHILOSOPHY|ADMISSION\s+REQUIREMENTS|DEGREE\s+REQUIREMENTS)", line_str)
            if header_match:
                if section_buffer:
                    full_text = " ".join(section_buffer)
                    if len(full_text.split()) >= 30:
                        chunks.append(DocumentChunk(
                            chunk_id=f"struct_p{page['page_num']}_{chunk_counter}",
                            text=full_text,
                            page_num=page["page_num"],
                            strategy="STRUCTURAL_SECTION",
                            section=current_section
                        ))
                        chunk_counter += 1
                    section_buffer = []
                current_section = line_str

            section_buffer.append(line_str)

        if section_buffer:
            full_text = " ".join(section_buffer)
            if len(full_text.split()) >= 30:
                chunks.append(DocumentChunk(
                    chunk_id=f"struct_p{page['page_num']}_{chunk_counter}",
                    text=full_text,
                    page_num=page["page_num"],
                    strategy="STRUCTURAL_SECTION",
                    section=current_section
                ))
                chunk_counter += 1

    return chunks


class MedicalRAGPipeline:
    def __init__(self, api_key: str):
        self.voyage = VoyageClient(api_key=api_key)
        self.chunks_a: List[DocumentChunk] = []
        self.chunks_b: List[DocumentChunk] = []
        self.threshold = 0.42

    def index_corpus(self, max_pages: int = 50):
        print(f"Extracting {max_pages} pages from {CORPUS_PDF}...", flush=True)
        selected_pages = extract_pages_from_pdf(CORPUS_PDF, max_pages=max_pages)

        print(f"Chunking with Strategy A (Fixed 500-token)...", flush=True)
        self.chunks_a = chunk_strategy_a_fixed(selected_pages, chunk_size=400, overlap=80)
        print(f"Generated {len(self.chunks_a)} chunks for Strategy A.", flush=True)

        print(f"Chunking with Strategy B (Structural Section)...", flush=True)
        self.chunks_b = chunk_strategy_b_structural(selected_pages)
        print(f"Generated {len(self.chunks_b)} chunks for Strategy B.", flush=True)

        print(f"Computing Voyage AI embeddings for Strategy A...", flush=True)
        texts_a = [c.text for c in self.chunks_a]
        embs_a = self.voyage.embed_texts(texts_a)
        for c, emb in zip(self.chunks_a, embs_a):
            c.embedding = emb

        print(f"Computing Voyage AI embeddings for Strategy B...", flush=True)
        texts_b = [c.text for c in self.chunks_b]
        embs_b = self.voyage.embed_texts(texts_b)
        for c, emb in zip(self.chunks_b, embs_b):
            c.embedding = emb

        print(f"Indexing complete! Cached in {CACHE_FILE}", flush=True)

    def retrieve(self, query: str, strategy: str = "STRUCTURAL_SECTION", top_k: int = 4) -> Tuple[List[Dict[str, Any]], bool]:
        # Prompt Injection / Adversarial Sanitization
        adversarial_pattern = r"(ignore\s+(all\s+)?previous\s+instructions|system\s+override|reveal\s+secret)"
        if re.search(adversarial_pattern, query, re.IGNORECASE):
            return [{
                "text": "SECURITY WARNING: Adversarial prompt injection detected. Query rejected.",
                "page_num": 0,
                "score": 0.0,
                "section": "SECURITY_FILTER"
            }], False

        query_emb = self.voyage.embed_query(query)
        chunks = self.chunks_b if strategy == "STRUCTURAL_SECTION" else self.chunks_a

        scored_chunks = []
        for c in chunks:
            sim = cosine_similarity(query_emb, c.embedding)
            scored_chunks.append((sim, c))

        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        top_candidates = scored_chunks[:top_k]

        if not top_candidates or top_candidates[0][0] < self.threshold:
            # Below refusal threshold
            return [{
                "text": "The provided NUC Medical & Dental curriculum does not contain verified guidelines for this inquiry.",
                "page_num": 0,
                "score": top_candidates[0][0] if top_candidates else 0.0,
                "section": "REFUSAL_OUT_OF_SCOPE"
            }], False

        results = []
        for sim, c in top_candidates:
            results.append({
                "chunk_id": c.chunk_id,
                "text": c.text,
                "page_num": c.page_num,
                "score": round(sim, 4),
                "section": c.section
            })
        return results, True


if __name__ == "__main__":
    pipeline = MedicalRAGPipeline(api_key=VOYAGE_API_KEY)
    pipeline.index_corpus(max_pages=40)
    
    # Test sample query
    query = "What are the core learning outcomes and requirements for Gross Anatomy?"
    print(f"\nQuery: {query}")
    hits, is_grounded = pipeline.retrieve(query, strategy="STRUCTURAL_SECTION", top_k=3)
    for i, h in enumerate(hits, 1):
        print(f"\n[Hit #{i}] Score: {h['score']} | Page: {h['page_num']} | Section: {h['section']}")
        print(f"Excerpt: {h['text'][:220]}...")
