import os
import re

# Define the target directory relative to the script location or hardcoded
# We assume we run this from the project root
target_dir = os.getcwd()
target_file = os.path.join(target_dir, "gas_email_processor.js")

def fix_file(file_path):
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        separator_solid = '===================================================================================================='

        # 1. Replace spaced equals "= = = =" with solid "========"
        # Matches any sequence of "=" followed by space, repeated at least 3 times, ending with optional "="
        # matches: "= = = " or "= = = ="
        content = re.sub(r'(?:=\s){3,}=?', separator_solid, content)

        # 2. Replace lines that are just "= = =..." even if they don't have spaces in a weird way
        # Just to be sure, any line that is mostly "=" and spaces and length > 10
        def replace_separator_line(match):
            line = match.group(0)
            if re.search(r'[a-zA-Z0-9]', line): # content line
                return line
            return separator_solid
        
        # Regex for lines that look like separators (allow spaces, dashes, equals)
        # We need to be careful not to break code like "x = y"
        # We target lines that are comment-like `// = = ...` or string literal separators
        
        # match `//` followed by space/equals sequence
        content = re.sub(r'//\s*[= ]{5,}', f'// {separator_solid}', content)

        # match literal separators in backticks (multiline strings)
        # These usually appear as newlines followed by separator
        # We'll stick to the specific patterns we saw.
        content = re.sub(r'(?:\r?\n)[= ]{10,}(?:\r?\n)', f'\n{separator_solid}\n', content)

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"Fixed {file_path} visual style to solid lines.")

    except Exception as e:
        print(f"Error fixing {file_path}: {e}")

if __name__ == "__main__":
    fix_file(target_file)
