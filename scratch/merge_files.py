import os
import re

def find_method_end(content, start_idx):
    open_brace_idx = content.find('{', start_idx)
    if open_brace_idx == -1:
        return -1
    brace_count = 1
    i = open_brace_idx + 1
    in_string = False
    string_char = None
    escaped = False
    while i < len(content):
        c = content[i]
        if escaped:
            escaped = False
            i += 1
            continue
        if c == '\\':
            escaped = True
            i += 1
            continue
        if in_string:
            if c == string_char:
                in_string = False
            i += 1
            continue
        if c in ('"', "'", '`'):
            in_string = True
            string_char = c
            i += 1
            continue
        if c == '{':
            brace_count += 1
        elif c == '}':
            brace_count -= 1
            if brace_count == 0:
                return i
        i += 1
    return -1

def main():
    print("Starting merge...")
    
    # 1. Read current gas_email_processor.js
    with open('gas_email_processor.js', 'r', encoding='utf-8') as f:
        main_code = f.read()
        
    # 2. Insert updated _normalizeTextContent right after _getCachedTimeZone()
    timezone_pos = main_code.find('_getCachedTimeZone()')
    if timezone_pos == -1:
        print("Error: _getCachedTimeZone not found in gas_email_processor.js")
        return
        
    timezone_end = find_method_end(main_code, timezone_pos)
    if timezone_end == -1:
        print("Error: Could not find end of _getCachedTimeZone method")
        return
        
    # The user's updated _normalizeTextContent method:
    updated_normalize_method = """

  /**
   * Normalizza contenuti testuali/strutturati in stringa sicura per prompt/logica KB.
   * - stringhe: trim
   * - null/undefined: stringa vuota
   * - oggetti/array: JSON con gestione riferimenti circolari
   */
  _normalizeTextContent(content) {
    if (content === null || typeof content === 'undefined') {
      return '';
    }

    if (typeof content === 'string') {
      return content.trim();
    }

    if (typeof content === 'number' || typeof content === 'boolean') {
      return String(content);
    }

    const seen = new WeakSet();
    try {
      return JSON.stringify(content, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        if (typeof value === 'function') {
          return `[Function ${value.name || 'anonymous'}]`;
        }
        return value;
      }, 2);
    } catch (e) {
      try {
        return String(content);
      } catch (_ignored) {
        return '';
      }
    }
  }
"""
    
    # Construct the first part of the file with the new method inserted
    main_code_with_normalize = main_code[:timezone_end + 1] + updated_normalize_method + main_code[timezone_end + 1:]
    
    # 3. Truncate the file right after the end of _storeBatchCheckpointAndScheduleContinuation_ method
    checkpoint_msg_pos = main_code_with_normalize.find('Errore salvataggio checkpoint batch:')
    if checkpoint_msg_pos == -1:
        print("Error: Checkpoint error message not found in main_code")
        return
        
    first_brace = main_code_with_normalize.find('}', checkpoint_msg_pos)
    if first_brace == -1:
        print("Error: Could not find first brace after checkpoint error message")
        return
        
    second_brace = main_code_with_normalize.find('}', first_brace + 1)
    if second_brace == -1:
        print("Error: Could not find second brace after checkpoint error message")
        return
        
    truncated_main = main_code_with_normalize[:second_brace + 1]
    
    # 4. Read and process deleted_part.js
    with open('deleted_part.js', 'r', encoding='utf-8') as f:
        deleted_part = f.read()
        
    # 5. Remove the old _normalizeTextContent method from deleted_part
    old_normalize_pos = deleted_part.find('  _normalizeTextContent(value) {')
    if old_normalize_pos == -1:
        # Check without leading spaces
        old_normalize_pos = deleted_part.find('_normalizeTextContent(value) {')
        
    if old_normalize_pos != -1:
        old_normalize_end = find_method_end(deleted_part, old_normalize_pos)
        if old_normalize_end != -1:
            print("Removing old _normalizeTextContent from deleted_part...")
            # Remove from old_normalize_pos to old_normalize_end + 1
            # Also consume any preceding comments if we want, but simple removal is fine.
            deleted_part_clean = deleted_part[:old_normalize_pos] + deleted_part[old_normalize_end + 1:]
        else:
            print("Error: Could not find end of old _normalizeTextContent method")
            return
    else:
        print("Warning: old _normalizeTextContent not found in deleted_part.js")
        deleted_part_clean = deleted_part

    # 6. Combine truncated main and clean deleted part
    final_content = truncated_main + "\n\n" + deleted_part_clean
    
    # 7. Write to gas_email_processor.js
    with open('gas_email_processor.js', 'w', encoding='utf-8') as f:
        f.write(final_content)
        
    print("Merge completed successfully! File updated.")

if __name__ == "__main__":
    main()
