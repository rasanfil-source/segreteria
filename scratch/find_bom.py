import os

def find_bom(root_dir):
    for root, dirs, files in os.walk(root_dir):
        if '.git' in dirs:
            dirs.remove('.git')
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        
        for file in files:
            if not file.endswith('.js'):
                continue
            path = os.path.join(root, file)
            try:
                with open(path, 'rb') as f:
                    header = f.read(3)
                    if header == b'\xef\xbb\xbf':
                        print(f"BOM detected: {path}")
            except Exception as e:
                print(f"Error reading {path}: {e}")

if __name__ == "__main__":
    find_bom(".")
