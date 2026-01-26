# 📖 Complete Setup Guide - AI Email Secretary

> **Time required:** 20-30 minutes  
> **Skills required:** None (just follow the steps)  
> **Cost:** ~€8/month

---

## 🎯 What You Will Get

By the end of this guide you will have a system that:
- ✅ Automatically answers simple emails 24/7
- ✅ Handling requests in Italian, English, Spanish
- ✅ Automatically verifies if an address is in the parish territory
- ✅ Marks emails that need human attention
- ✅ Keeps memory of conversations

---

## 📋 Prerequisites Checklist

Before you start, make sure you have:

- [ ] **Parish Gmail Account** (e.g. `info@saintagatha.org`)
  - Must be Gmail or Google Workspace
  - You must have full access (username + password)
  
- [ ] **30 minutes of time** without interruptions

- [ ] **Computer** (Windows, Mac or Linux)

- [ ] **Credit Card** for Gemini API (prepaid is fine)
  - Required to activate API, even for free quota
  - Charges only after exceeding €0 (first 60 uses/min free)

**✋ IMPORTANT:** No programming skills needed!

---

## Phase 1: Get Google Gemini API Key

### Step 1.1: Log in to Google AI Studio

1. Go to: https://aistudio.google.com/
2. Click **"Sign In"** (top right)
3. Use the **parish** Gmail account (NOT your personal one)

### Step 1.2: Create the project

1. On the homepage, look for the left menu
2. Click on **"Get API Key"**
3. A window will open → Click **"Create API Key in new project"**
4. Google will automatically create a project (name: "Generative Language Client")

### Step 1.3: Copy the API Key

1. A string like: `AIzaSyD...XYZ123` will appear
2. **COPY** this key (copy button next to it)
3. **PASTE** into a text file on your desktop (you will use it later)

**⚠️ SECURITY:** 
- This key is like a password
- DO NOT share it
- DO NOT publish it online
- If you lose it, you can generate a new one

**💰 Gemini API Costs:**
- First **60 requests/minute** → FREE
- Over 60/minute → ~€0.001 per request
- An average parish (100 emails/week) = **~€5-10/month**

---

## Phase 2: Prepare Google Sheets (Knowledge Base)

### Step 2.1: Create the main sheet

1. Go to https://docs.google.com/spreadsheets
2. Click **"Blank"** (new sheet)
3. Rename the sheet to: **"ParishAI - Knowledge Base"**

### Step 2.2: Create the 4 necessary sheets

**In the sheet you just created:**

1. At the bottom see tab "Sheet1" → **Rename it to:** `Istruzioni` (Instructions)
2. Click **+** (bottom left) to add a new sheet
3. Rename it to: `AI_CORE_LITE`
4. Add 2 more sheets:
   - `AI_CORE`
   - `Dottrina` (Doctrine)

**Final result (4 tabs at the bottom):**
```
Istruzioni | AI_CORE_LITE | AI_CORE | Dottrina
```

### Step 2.3: Populate the "Istruzioni" sheet

**In the `Istruzioni` sheet, insert in the first row:**

| A | B | C |
|---|---|---|
| Category | Information | Details |

**In the following rows, add your parish information:**

Example:

| Category | Information | Details |
|-----------|--------------|----------|
| Weekday Mass Schedule | Winter | Monday-Saturday 6:00 PM |
| Weekday Mass Schedule | Summer | Monday-Saturday 7:00 PM |
| Sunday Mass Schedule | Winter | Saturday 6:00 PM, Sunday 8:30, 10:00, 11:30 AM, 6:00 PM |
| Sunday Mass Schedule | Summer | Saturday 7:00 PM, Sunday 8:30, 10:00, 11:30 AM, 7:00 PM |
| Contacts | Phone | 06-12345678 |
| Contacts | Email | info@parishexample.org |
| Contacts | Address | Via Roma 10, 00100 Rome |
| Office Hours | Mon-Fri | 9:00-12:00, 16:00-18:00 |
| Baptism | Documents | Birth certificate, family status, request form |
| Baptism | Course | First Saturday of the month 4:00 PM |

**💡 TIP:** You can add as much info as you want! More information = more precise answers.

### Step 2.4: Populate the AI_CORE sheets

**These sheets contain the "pastoral instructions" for the AI.**

In **`AI_CORE_LITE`** insert:

| Principle | Instruction |
|-----------|-----------|
| Tone | Always use a professional but warm tone |
| Signature | Always sign as "Parish Secretariat [Parish Name]" |
| Referrals | If someone asks for a personal interview, suggest calling or coming to the office |

In **`AI_CORE`** (for more complex situations):

| Principle | Instruction |
|-----------|-----------|
| Delicate Situations | For divorced/remarried, cohabiting couples, complex pastoral situations: DO NOT judge, invite to speak with the priest |
| Emergencies | For bereavement, serious illness: respond with empathy and provide direct contacts immediately |
| Doctrinal Doubts | You can explain doctrine simply, citing the Catechism when possible |

**📝 NOTE:** You can customize these instructions according to your parish style!

### Step 2.5: Save the Sheet ID

1. Look at the sheet URL (address bar)
2. It will be like: `https://docs.google.com/spreadsheets/d/`**`1ABC...XYZ789`**`/edit`
3. The part **`1ABC...XYZ789`** is the **Sheet ID**
4. **COPY IT** and save it in the text file (together with the API Key)

---

## Phase 3: Create the Google Apps Script Project

### Step 3.1: Open Apps Script

1. Go to: https://script.google.com
2. Log in with the parish Gmail account
3. Click **"New Project"**

### Step 3.2: Download system files

1. Go to the GitHub repository: https://github.com/rasanfil-source/segreteria
2. Click on the green **"Code"** button → **"Download ZIP"**
3. Extract the ZIP to your desktop

### Step 3.3: Upload files to the project

**Now you must copy the files one by one:**

1. In the Apps Script project, see `Code.gs` → **Delete it** (trash icon)
2. Click **+** (next to "Files") → **Script**
3. Rename it to: `gas_config.js`
4. Open the `gas_config.js` file (from the ZIP folder)
5. **Copy all** contents
6. **Paste** into the new `gas_config.js` file in Apps Script

**Repeat for ALL `.js` files:**
- gas_main.js
- gas_classifier.js
- gas_email_processor.js
- gas_gemini_service.js
- gas_gmail_service.js
- gas_memory_service.js
- gas_prompt_engine.js
- gas_rate_limiter.js
- gas_response_validator.js
- gas_territory_validator.js
- gas_request_classifier.js
- gas_prompt_context.js
- gas_logger.js

**⏱️ Time:** 5-10 minutes to upload all files

### Step 3.4: Configure keys

In **`gas_config.js`**, find these lines:

```javascript
GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY_HERE',
SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
```

**Replace:**
- `YOUR_GEMINI_API_KEY_HERE` → with the API Key you copied earlier
- `YOUR_SPREADSHEET_ID_HERE` → with the Google Sheet ID

**⚠️ IMPORTANT:** Leave the quotes `'` before and after!

Correct example:
```javascript
GEMINI_API_KEY: 'AIzaSyD...XYZ123',
SPREADSHEET_ID: '1ABC...XYZ789',
```

### Step 3.5: Save the project

1. Click the **disk** icon (top)
2. Rename the project to: **"ParishAI System"**
3. Click **"Save"**

---

## Phase 4: Configure Permissions

### Step 4.1: Authorize the script

1. In the top menu, find the function (dropdown)
2. Select: **`setupTrigger`**
3. Click **"Run"** (play button ▶️)
4. "Authorization required" popup will appear
5. Click **"Review Permissions"**
6. Choose the parish Gmail account
7. Click **"Advanced"** (at the bottom)
8. Click **"Go to ParishAI System (unsafe)"**
9. Click **"Allow"**

**❓ Why "unsafe"?**
Google always shows this for personal scripts. It's normal! The code is safe (you can read it).

### Step 4.2: Verify operation

1. Change function to: **`healthCheck`**
2. Click **"Run"** ▶️
3. Watch "Execution log" (at the bottom)
4. You should see: `status: "OK"` for all components

**If you see errors:**
- Check that API Key and Spreadsheet ID are correct
- Verify that the Google Sheet is shared with the Gmail account

---

## Phase 5: Territory Configuration (Optional but Recommended)

If you want the system to automatically verify addresses:

### Step 5.1: Find the territory file

1. Open **`gas_territory_validator.js`**
2. Find `this.territory = {`

### Step 5.2: Insert your parish streets

Example:
```javascript
this.territory = {
    'via roma': { tutti: true },  // All of Via Roma
    'via garibaldi': { dispari: [1, 99] },  // Only odd numbers from 1 to 99
    'piazza duomo': { pari: [2, 50] },  // Only even numbers from 2 to 50
}
```

**Syntax:**
- `tutti: true` = All house numbers
- `tutti: [10, 50]` = Only numbers from 10 to 50 (even and odd)
- `dispari: [1, null]` = Odd numbers from 1 to infinity
- `pari: [2, 100]` = Even numbers from 2 to 100

### Step 5.3: Save

Click the **"Save"** button (disk icon)

---

## Phase 6: Test Operation

### Step 6.1: Send test email

1. From another email (NOT the parish one)
2. Send to: `info@yourparish.org`
3. Subject: `AI System Test`
4. Body: `Good morning, I would like to know the Sunday mass times. Thanks`

### Step 6.2: Check response

**After ~5 minutes** (trigger time):

1. Check parish inbox
2. You should see the automatic reply
3. Email will have label "IA"

### Step 6.3: Verify in Apps Script

1. Go to Apps Script
2. Left menu → **"Executions"**
3. You should see the `main` function executed
4. Status: **Completed** (if everything ok)

**If it doesn't work:**
- Check "Execution log" for errors
- Verify the email wasn't filtered as spam
- Ensure trigger is active (Menu → Triggers)

---

## Phase 7: Final Customizations

### Step 7.1: Configure office hours

In **`gas_config.js`**, find:

```javascript
WORKING_HOURS_START: 9,  // Start hour (24h)
WORKING_HOURS_END: 18,   // End hour (24h)
```

**Modify** with your office hours.

**💡 What it does:** Outside these hours, the system DOES NOT suspend (continues to reply). Only serves for statistics.

### Step 7.2: Configure supported languages

In **`gas_config.js`**:

```javascript
LANGUAGES_SUPPORTED: ['it', 'en', 'es'],
DEFAULT_LOCALE: 'it'
```

**Add/remove** languages as needed:
- `it` = Italian
- `en` = English
- `es` = Spanish
- `fr` = French
- `de` = German

### Step 7.3: Customize signature

In **`gas_gmail_service.js`**, search:

```javascript
const signature = `
Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio
`;
```

**Replace** with your parish name.

---

## 🎉 Congratulations!

The system is active!

### What Happens Now

**Every 5 minutes**, the system:
1. ✅ Checks unread emails
2. ✅ Filters spam and automatic emails
3. ✅ Classifies requests
4. ✅ Consults the Knowledge Base
5. ✅ Generates and sends responses

### Gmail Labels

Verify that these labels appeared in your Gmail:
- 🟢 **IA** → Email with automatic reply sent
- 🟡 **Verifica** → Emails processed but need check
- 🔴 **Errore** → Emails with technical problems

---

## 📊 Monitoring

### Check statistics

**Every week**, run:

1. Go to Apps Script
2. Select function: `showQuotaDashboard`
3. Click **"Run"**
4. Watch "Execution log"

You will see:
- Number of processed emails
- API tokens used
- Emails filtered vs sent

### Processed email examples

To see examples of emails the system answered:

1. In Gmail, click label **"IA"**
2. Open some conversations
3. Verify response quality

**If you see inappropriate responses:**
- Add missing info in Knowledge Base
- Customize instructions in AI_CORE
- Report the case to improve the system

---

## 🆘 Common Problems

### "Emails not processed"

**Cause:** Trigger not active

**Solution:**
1. Apps Script → Menu → **Triggers**
2. Verify there is `main` every 5 minutes
3. If missing, run `setupTrigger` again

### "Response in wrong language"

**Cause:** Email with words from multiple languages

**Solution:**
In **`gas_config.js`**, find:
```javascript
LANGUAGE_CONFIDENCE_THRESHOLD: 0.7
```
Lower it to `0.6` if necessary.

### "Too many 'Verifica' emails"

**Cause:** Validation threshold too high

**Solution:**
In **`gas_config.js`**:
```javascript
VALIDATION_MIN_SCORE: 0.5  // Was 0.6
```

### "API Quota Exceeded"

**Cause:** Too much email traffic

**Solution:**
1. Check costs in: https://console.cloud.google.com/billing
2. If necessary, reduce `MAX_EMAILS_PER_RUN` in Config
3. Or increase API budget

---

## 📞 Support

**Need help?**

1. 📧 Email: rasanfil@gmail.com
2. 💬 Community: [GitHub Discussions](...)
3. 🐛 Bug: [GitHub Issues](...)

**Before writing:**
- Check this guide
- Watch "Common Problems" (above)
- Run `healthCheck` and copy result

---

## 🚀 Next Steps

Now that the system is active:

1. **Populate Knowledge Base** with all parish info
2. **Monitor responses** ("IA" label) for first days
3. **Refine instructions** in AI_CORE to improve tone
4. **Share feedback** with community

**Good luck! 🙏**
