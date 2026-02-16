import os
import re

# Define the target directory (project root)
# Assumes script is in `scripts/` so we go up one level
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)

def fix_file(file_path):
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        separator_solid = '===================================================================================================='
        garbage_char = '\u0090' 
        
        new_lines = []
        changes = 0
        
        for line in lines:
            original_line = line
            
            # 1. Remove specific garbage characters
            if garbage_char in line:
                line = line.replace(garbage_char, '')
                changes += 1

            # 2. Fix spaced separators in comments: // = = = =
            # Regex: start of line, optional indent, //, spaces, sequence of = and spaces (at least 5 =), optional end
            comment_match = re.search(r'^(\s*)//\s*([= ]{5,})\s*$', line)
            if comment_match:
                content = comment_match.group(2)
                if '=' in content and ' ' in content: # Only if mixed with spaces
                    indent = comment_match.group(1)
                    line = f"{indent}// {separator_solid}\n"
                    changes += 1

            # 3. Fix spaced separators in string literals/content: = = = =
            # Regex: start of line, optional indent, sequence of = and spaces
            literal_match = re.search(r'^(\s*)([= ]{10,})\s*$', line)
            if literal_match:
                content = literal_match.group(2)
                if '=' in content and ' ' in content:
                    # heuristic: at least 10 chars, mixed = and space
                    indent = literal_match.group(1)
                    line = f"{indent}{separator_solid}\n"
                    changes += 1

            new_lines.append(line)

        if changes > 0:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f"Fixed {changes} issues in {os.path.basename(file_path)}")
        else:
            print(f"Clean: {os.path.basename(file_path)}")

    except Exception as e:
        print(f"Error fixing {file_path}: {e}")

def main():
    print(f"Scanning project root: {project_root}")
    # Walk through the directory
    for root, dirs, files in os.walk(project_root):
        # Skip .git, node_modules, etc.
        if '.git' in dirs:
            dirs.remove('.git')
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if 'scripts' in dirs:
             # Don't scan scripts folder itself if we don't want to fix the fixer
             pass

        for file in files:
            if file.endswith(".js"):
                file_path = os.path.join(root, file)
                fix_file(file_path)

if __name__ == "__main__":
    main()
