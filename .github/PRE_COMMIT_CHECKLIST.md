# ✅ Developer Pre-Commit Checklist

> **Mandatory verification before every commit to the repository**

---

## 🧪 Testing

- [ ] `runAllTests()` executed (100% pass)
- [ ] No debug `console.log()` left in production code
- [ ] Manually tested on GAS Editor with real email
- [ ] Verified functionality in `DRY_RUN = true` mode
- [ ] Tested with emails in at least 2 languages (IT + EN)

### Test Commands

```javascript
// Run all unit tests
runAllTests();

// Test specific email
testSpecificEmail('Test subject', 'Test email body');

// Verify API connection
testGeminiConnection();
```

---

## 🔒 Security

- [ ] **No hardcoded API keys** in code
  ```javascript
  // ❌ WRONG
  const API_KEY = 'AIzaSy...';
  
  // ✅ CORRECT
  const API_KEY = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  ```

- [ ] **No sensitive data in logs**
  ```javascript
  // ❌ WRONG
  console.log('Email body:', emailBody);
  
  // ✅ CORRECT
  console.log('Processing email from:', senderEmail.substring(0, 3) + '***');
  ```

- [ ] **Regex validated against ReDoS** - Test on [regex101.com](https://regex101.com)
  ```javascript
  // ❌ DANGEROUS (exponential backtracking)
  const regex = /(a+)+b/;
  
  // ✅ SAFE
  const regex = /a+b/;
  ```

- [ ] **Input sanitized** before processing
- [ ] **No eval()** or dynamic constructors with user input

---

## 📝 Documentation

- [ ] **JSDoc updated** for all public functions
  ```javascript
  /**
   * Processes an email thread and generates a response.
   * @param {string} threadId - Unique Gmail thread ID
   * @param {Object} resources - Loaded resources (KB, doctrine, etc.)
   * @returns {Object} Processing result with status and details
   */
  function processThread(threadId, resources) { ... }
  ```

- [ ] **CHANGELOG.md updated** (UNRELEASED section)
  - Added: new features
  - Changed: modifications to existing features
  - Fixed: bug fixes
  - Security: security fixes

- [ ] **README updated** if public API or configuration changed

- [ ] **Version updated** if release (package.json, README badge)

---

## 🏗️ Architecture

- [ ] **Backward compatible modifications**
  - New optional parameters with default values
  - Deprecation warnings for removed functions
  
- [ ] **No external dependencies added** without discussion
  - GAS has limitations on external libraries
  - Prefer native implementations

- [ ] **Centralized configuration** (no magic numbers)
  ```javascript
  // ❌ WRONG
  if (score > 0.6) { ... }
  
  // ✅ CORRECT
  if (score > CONFIG.VALIDATION_MIN_SCORE) { ... }
  ```

- [ ] **Existing patterns respected**
  - Factory pattern for services
  - Singleton for config
  - Pure functions where possible

---

## 📊 Performance

- [ ] **No O(n²) loops introduced** without justification
  ```javascript
  // ❌ O(n²) - avoid
  for (const a of array1) {
    for (const b of array2) { ... }
  }
  
  // ✅ O(n) - prefer
  const set = new Set(array2);
  for (const a of array1) {
    if (set.has(a)) { ... }
  }
  ```

- [ ] **Cache used appropriately**
  - Sheet reads cached (expensive)
  - API responses cached if applicable

- [ ] **Rate limiter considered**
  - New API calls registered
  - Token consumption estimated

- [ ] **Batch operations preferred**
  ```javascript
  // ❌ N Sheet calls
  for (const row of data) {
    sheet.appendRow(row);
  }
  
  // ✅ 1 Sheet call
  sheet.getRange(...).setValues(data);
  ```

---

## 🔄 Final Pre-Push

- [ ] `git diff` reviewed for unintentional changes
- [ ] Temporary/debug files removed (`.log`, `.tmp`, `.bak`)
- [ ] Descriptive commit message (type: feat/fix/docs/refactor)
- [ ] Correct branch selected

### Commit Message Format

```
<type>(<scope>): <short description>

<optional extended description>

<optional issue references>
```

**Types:**
- `feat`: new feature
- `fix`: bug fix
- `docs`: documentation
- `refactor`: refactoring without functional change
- `test`: adding/modifying tests
- `perf`: performance improvements
- `security`: security fix

**Example:**
```
feat(validator): added thinking leak detection

Detects when Gemini 2.5 exposes internal reasoning
in the response and blocks with score=0.0

Closes #42
```

---

## 📋 Quick Template

```markdown
## Pre-Commit Checklist

### Testing
- [x] runAllTests() pass
- [x] No console.log debug
- [x] Manual GAS test

### Security
- [x] No hardcoded keys
- [x] No sensitive data in logs
- [x] Regex ReDoS-safe

### Documentation
- [x] JSDoc updated
- [x] CHANGELOG updated
- [ ] README updated (N/A)

### Architecture
- [x] Backward compatible
- [x] No new dependencies
- [x] Config centralized

### Performance
- [x] No O(n²) loops
- [x] Cache used
- [x] Rate limiter considered
```

---

**[Versione Italiana](PRE_COMMIT_CHECKLIST_IT.md)** | **[Contributing Guide](../CONTRIBUTING.md)**
