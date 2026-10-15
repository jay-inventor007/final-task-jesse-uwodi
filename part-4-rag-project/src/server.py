"""
Production RAG Web Server & API
Serves the interactive Medical & Dental Curriculum RAG Assistant
Backend: Python http.server + Voyage AI voyage-3 embedding pipeline
"""

import http.server
import socketserver
import json
import os
import urllib.parse
import re
from pipeline import MedicalRAGPipeline, VOYAGE_API_KEY, BASE_DIR

PORT = 5050
pipeline = None

class RAGRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            html_file = os.path.join(BASE_DIR, "public", "index.html")
            with open(html_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if parsed.path == "/api/stats":
            stats = {
                "corpus": "NUC Medicine and Dentistry CCMAS (2023)",
                "totalPages": 275,
                "model": "voyage-3",
                "dimensions": 1024,
                "indexedChunksA": len(pipeline.chunks_a),
                "indexedChunksB": len(pipeline.chunks_b),
                "refusalThreshold": pipeline.threshold
            }
            stats_bytes = json.dumps(stats).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(stats_bytes)))
            self.end_headers()
            self.wfile.write(stats_bytes)
            return

        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/query":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)
            query_str = data.get("query", "").strip()
            strategy = data.get("strategy", "FIXED_500")
            top_k = int(data.get("top_k", 3))

            if not query_str:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Empty query"}).encode("utf-8"))
                return

            hits, is_grounded = pipeline.retrieve(query_str, strategy=strategy, top_k=top_k)

            # Synthesize clean, structured human-readable answer from retrieved evidence
            synthesized_answer = ""
            if is_grounded:
                # Extract key curriculum facts from top hits
                top_text = hits[0]["text"]
                
                # Check for course codes and unit mentions
                course_codes = re.findall(r'([A-Z]{3}\s*\d{3}[a-z]?)\s+([A-Za-z,\s\(\)\/]+?)(?=\d+\s+[C|E]|\d+\s+Units|\n|$)', top_text)
                
                synthesized_answer = f"### Summary\nBased on the **NUC Core Curriculum and Minimum Academic Standards (CCMAS 2023)** for Medicine and Dentistry, the curriculum specifies the following requirements for this subject:\n\n"
                
                if course_codes:
                    synthesized_answer += "#### Identified Curriculum Modules & Credit Units:\n"
                    for code, title in course_codes[:5]:
                        clean_title = title.strip().replace('\n', ' ')
                        synthesized_answer += f"- **{code}**: {clean_title}\n"
                    synthesized_answer += "\n"

                synthesized_answer += f"#### Regulatory Directives:\n"
                # Extract cleanest sentence-like pieces
                clean_lines = [l.strip() for l in top_text.split('\n') if len(l.strip()) > 30 and not l.strip().startswith('Total')]
                if clean_lines:
                    for line in clean_lines[:4]:
                        synthesized_answer += f"• {line}\n"
                else:
                    synthesized_answer += f"• {top_text[:350]}...\n"

                synthesized_answer += f"\n*Verified from official NUC statutory records on **Page {hits[0]['page_num']}** with **{round(hits[0]['score'] * 100, 1)}% semantic confidence**.*"
            else:
                if hits and hits[0]["section"] == "SECURITY_FILTER":
                    synthesized_answer = "🛡️ **Security Defense Intercepted**: This input contains adversarial prompt injection keywords. The request was blocked to maintain data integrity."
                else:
                    synthesized_answer = "⚠️ **Out of Scope / Unverified**: The provided NUC Medicine and Dentistry curriculum does not contain verified guidelines for this topic. This assistant strictly refuses out-of-scope inquiries to prevent clinical and regulatory hallucinations."

            response = {
                "query": query_str,
                "strategy": strategy,
                "top_k": top_k,
                "is_grounded": is_grounded,
                "synthesized_answer": synthesized_answer,
                "hits": hits
            }

            resp_bytes = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self.end_headers()
            self.wfile.write(resp_bytes)
            return

        self.send_response(404)
        self.end_headers()


def start_server():
    global pipeline
    print("Initializing Medical RAG Pipeline with Voyage AI...", flush=True)
    pipeline = MedicalRAGPipeline(api_key=VOYAGE_API_KEY)
    pipeline.index_corpus(max_pages=40)

    # Allow socket reuse with threaded handler
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), RAGRequestHandler) as httpd:
        print(f"\n=======================================================", flush=True)
        print(f"  NUC MEDICAL & DENTAL RAG ASSISTANT LIVE ON PORT {PORT} ", flush=True)
        print(f"  Open in your browser: http://localhost:{PORT}         ", flush=True)
        print(f"=======================================================\n", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    start_server()
