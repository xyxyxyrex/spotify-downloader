import os
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

def search_files(directory, query):
    results = []
    for root, dirs, files in os.walk(directory):
        if "node_modules" in dirs:
            dirs.remove("node_modules")
        if ".git" in dirs:
            dirs.remove(".git")
        for file in files:
            if file.endswith((".js", ".html", ".css", ".rs", ".py")):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        for i, line in enumerate(f, 1):
                            if query.lower() in line.lower():
                                results.append((filepath, i, line.strip()))
                except Exception as e:
                    pass
    return results

if __name__ == "__main__":
    q = "spotiTauri" if len(sys.argv) < 2 else sys.argv[1]
    res = search_files(os.getcwd(), q)
    print(f"Found {len(res)} occurrences for '{q}':")
    for filepath, line_num, content in res:
        print(f"{filepath}:{line_num}: {content}")
