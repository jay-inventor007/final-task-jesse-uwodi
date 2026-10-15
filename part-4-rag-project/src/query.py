"""
Interactive Command-Line RAG Query Assistant
Allows developers and evaluators to query the 275-page NUC medical curriculum directly in the terminal.
"""

import sys
from pipeline import MedicalRAGPipeline, VOYAGE_API_KEY

def main():
    print("================================================================")
    print("   NUC MEDICINE & DENTISTRY CURRICULUM RAG ASSISTANT (CLI)      ")
    print("      Powered by Voyage AI (voyage-3, 1024 Dimensions)          ")
    print("================================================================\n")

    pipeline = MedicalRAGPipeline(api_key=VOYAGE_API_KEY)
    print("Indexing curriculum (using cached embeddings)...")
    pipeline.index_corpus(max_pages=40)

    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
    else:
        query = "What are the core learning outcomes and objectives of Human Gross Anatomy in the CCMAS?"

    print(f"\nUser Query: \"{query}\"")
    hits, is_grounded = pipeline.retrieve(query, strategy="FIXED_500", top_k=3)

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    if is_grounded:
        print(f"\n[GROUNDED] VERIFIED STATUTORY GROUNDING (Top Score: {hits[0]['score']})")
        for i, h in enumerate(hits, 1):
            print(f"\n--- Excerpt #{i} (Page {h['page_num']} | {h['section']}) ---")
            print(f"Similarity Score: {h['score']}")
            print(f"Text:\n{h['text']}\n")
    else:
        print(f"\n[REFUSED] (Score: {hits[0]['score']} < Threshold 0.42)")
        print(f"Response: {hits[0]['text']}")

if __name__ == "__main__":
    main()
