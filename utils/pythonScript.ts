
export const PYTHON_OPTIMIZER_SCRIPT = `
import os
import sys
import json
import time
import re
import multiprocessing
from concurrent.futures import ThreadPoolExecutor

# --- CONFIGURATION ---
OLLAMA_URL = "http://localhost:11434/api/generate"
LOCAL_MODEL = "llama3" # Change to 'mistral', 'qwen', or 'gemma' as needed
MAX_WORKERS = os.cpu_count() or 4

def install_dependencies():
    """Auto-install basics if missing."""
    import subprocess
    packages = ["requests", "nltk", "spacy", "tqdm"]
    for package in packages:
        try:
            __import__(package)
        except ImportError:
            print(f"Installing missing package: {package}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", package])

try:
    import requests
    import nltk
    from nltk.corpus import stopwords
    from nltk.tokenize import word_tokenize
except ImportError:
    install_dependencies()
    import requests
    import nltk
    from nltk.corpus import stopwords
    from nltk.tokenize import word_tokenize

# Ensure NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')
    nltk.download('stopwords')

def clean_text_fast(text, lang='english'):
    """
    High-performance cleaning using NLTK native C-optimized tokenizers.
    """
    # 1. Basic Regex Cleaning
    text = re.sub(r'\\s+', ' ', text)
    text = re.sub(r'\\[.*?\\]', '', text) # Remove [References]
    
    # 2. Tokenization & Stopwords
    tokens = word_tokenize(text.lower())
    stop_words = set(stopwords.words(lang))
    filtered = [w for w in tokens if w.isalnum() and w not in stop_words]
    
    return " ".join(filtered)

def analyze_with_local_ai(text_chunk):
    """
    Connects to local OLLAMA instance for zero-cost analysis.
    """
    prompt = f"Extract 5 key concepts and sentiment from: {text_chunk[:1000]}"
    try:
        response = requests.post(OLLAMA_URL, json={
            "model": LOCAL_MODEL,
            "prompt": prompt,
            "stream": False
        }, timeout=10)
        if response.status_code == 200:
            return response.json().get("response", "").strip()
    except:
        return None
    return None

def process_file(filepath):
    """
    Worker function for multiprocessing.
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        filename = os.path.basename(filepath)
        lang = 'spanish' if 'es_' in filename or '_es' in filename else 'english'
        
        # CPU Bound Task: Cleaning
        cleaned = clean_text_fast(content, lang)
        
        # IO Bound Task: AI Analysis (Optional)
        ai_meta = analyze_with_local_ai(content)
        
        return {
            "file": filename,
            "cleaned_tokens": len(cleaned.split()),
            "ai_analysis": ai_meta,
            "status": "success"
        }
    except Exception as e:
        return {"file": filepath, "error": str(e), "status": "failed"}

def main():
    print("=================================================")
    print(f" CMBI CORPUS OPTIMIZER (CPU Cores: {MAX_WORKERS})")
    print("=================================================")
    
    target_dir = input("Enter path to Corpus folder (unzipped): ").strip().strip('"')
    
    if not os.path.exists(target_dir):
        print("Error: Directory not found.")
        return

    files = [os.path.join(target_dir, f) for f in os.listdir(target_dir) if f.endswith('.txt')]
    print(f"Found {len(files)} text files. Starting optimization...")
    
    start_time = time.time()
    
    # PARALLEL PROCESSING
    results = []
    with multiprocessing.Pool(processes=MAX_WORKERS) as pool:
        for res in pool.imap_unordered(process_file, files):
            results.append(res)
            print(f"[{len(results)}/{len(files)}] Processed {res.get('file', 'unknown')}")

    duration = time.time() - start_time
    
    # Save Report
    report_path = os.path.join(target_dir, "optimization_report.json")
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2)
        
    print("=================================================")
    print(f"Done in {duration:.2f} seconds.")
    print(f"Report saved to: {report_path}")
    print("=================================================")

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
`;
