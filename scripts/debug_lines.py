import os

file_path = "gas_email_processor.js"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print("Analyzing line 579 (approx index 578):")
# Line numbers in editor are 1-based. Python list is 0-based.
# 579 in 1-based is 578 in 0-based.
if len(lines) > 578:
    line = lines[578]
    print(f"Content: {repr(line)}")
    print(f"Hex: {line.encode('utf-8').hex()}")

print("\nScan for problematic separators:")
for i, line in enumerate(lines):
    # Check for lines that have multiple '=' separated by spaces
    if line.strip().startswith('//') and '= =' in line:
        print(f"Line {i+1}: {repr(line)}")
