# 📚 Knowledge Base Guide - How to Populate Effectively

> **How to organize your parish information to get the best AI responses**

---

## 🎯 What is the Knowledge Base

The Knowledge Base (KB) is the "brain" of the system: it contains all the information the AI will use to respond to emails.

**Think of the KB as a parish manual** that the system consults before answering.

### The 4 Levels of Knowledge Base

| Sheet | When to Use | Content | Example |
|--------|---------------|-----------|---------|
| **Instructions** | ALWAYS | Basic info: schedules, contacts, documents | "Holiday Masses: Sat 18:00, Sun 10:00" |
| **AI_CORE_LITE** | Requests with pastoral/doctrinal aspect | Basic principles | "Use empathetic tone for bereavements" |
| **AI_CORE** | Complex situations | Extended pastoral principles | "Divorced remarried: refer to priest" |
| **Doctrine** | Theological questions | Catechism, Magisterium | "Why go to Mass on Sunday?" |

---

## 📝 "Instructions" Sheet - The Heart of the KB

### Basic Structure

| Category | Information | Details |
|-----------|--------------|----------|
| Holiday Mass Times | Winter | Pre-holiday Saturday 18:00, Sunday 8:30, 10:00, 11:30, 18:00 |
| Holiday Mass Times | Summer | Pre-holiday Saturday 19:00, Sunday 8:30, 10:00, 11:30, 19:00 |

### Recommended Categories

#### 1. Schedules (CRITICAL)

```
| Category | Information | Details |
|-----------|--------------|----------|
| Weekday Mass Times | Winter (Oct 1 - May 31) | Monday-Saturday 18:00 |
| Weekday Mass Times | Summer (Jun 1 - Sep 30) | Monday-Saturday 19:00 |
| Holiday Mass Times | Winter | Saturday 18:00, Sunday 8:30, 10:00, 11:30, 18:00 |
| Holiday Mass Times | Summer | Saturday 19:00, Sunday 8:30, 10:00, 11:30, 19:00 |
| Office Hours | Monday-Friday | 9:00-12:00, 16:00-18:00 |
| Office Hours | Saturday | 9:00-12:00 |
```

**⚠️ IMPORTANT:** 
- ALWAYS specify "Winter" and "Summer" for seasonal schedules
- System will automatically use the correct one based on the date

#### 2. Contacts

```
| Category | Information | Details |
|-----------|--------------|----------|
| Contacts | Phone | 06-1234567 |
| Contacts | Email | info@parish.org |
| Contacts | Address | Via Roma 10, 00100 Rome RM |
| Contacts | Parish Priest | Fr. Marco Rossi |
| Contacts | WhatsApp | 333-1234567 (messages only, no calls) |
```

#### 3. Baptism

```
| Category | Information | Details |
|-----------|--------------|----------|
| Baptism | Required Documents | Birth certificate, family status certificate, request form (downloadable from site) |
| Baptism | Preparation Course | First Saturday of the month 16:00, duration 2 hours. Mandatory for parents and godparents |
| Baptism | Celebration Dates | Every second and fourth Sunday of the month 12:00 |
| Baptism | Godparent Requirements | Baptized Catholics, confirmed, if married church marriage. Minimum 16 years old |
| Baptism | Registration | At least 2 months before desired date |
```

**💡 TRICK:** More details = Fewer follow-up questions!

#### 4. First Communion

```
| Category | Information | Details |
|-----------|--------------|----------|
| First Communion | Age | 3rd grade children (8-9 years) |
| First Communion | Catechism | Mandatory: 2 years of catechism before Communion |
| First Communion | Catechism Days | Thursday 17:00-18:00 (Group A), Saturday 16:00-17:00 (Group B) |
| First Communion | Registration | September each year, at the office |
| First Communion | Celebration Date 2026 | Sunday May 10, 2026 10:30 |
```

#### 5. Confirmation

```
| Category | Information | Details |
|-----------|--------------|----------|
| Confirmation Youth | Age | 8th grade (13-14 years) |
| Confirmation Youth | Path | 2 years of catechism. Weekly meetings Wednesday 18:00-19:00 |
| Confirmation Adults | Path | Personalized 1 year path. Fortnightly meetings Saturday 17:00 |
| Confirmation | Sponsor Requirements | Baptized and confirmed Catholic, minimum 16 years, if married church marriage |
```

#### 6. Marriage

```
| Category | Information | Details |
|-----------|--------------|----------|
| Marriage | First Meeting | Determine appointment with parish priest at least 6 months prior |
| Marriage | Pre-Cana Course | Mandatory. Upcoming dates: see parish notice board or call office |
| Marriage | Basic Documents | Recent baptism certificates (max 6 months), free status, nihil obstat (if from another parish) |
| Marriage | Banns | Posted 15 days before marriage |
```

**⚠️ COMPLEX SITUATIONS:**
Do not insert details on divorces, cohabitations, mixed marriages here. Let the AI refer to the parish priest.

#### 7. Events and Activities

```
| Category | Information | Details |
|-----------|--------------|----------|
| Eucharistic Adoration | When | Every first Friday of the month 21:00-22:00 |
| Youth Group | Meetings | Saturday 19:30, parish hall. Age 18-30 years |
| Adult Catechesis | When | Tuesday 20:30, Oct-May |
| Caritas | Distribution | Thursday 9:00-11:00, access from side street |
| Pilgrimages 2026 | Destinations | Medjugorje (May), Lourdes (September), Holy Land (October) - Programs in office |
```

---

## 🧭 "AI_CORE_LITE" Sheet - Basic Pastoral Principles

### What to Insert

**Instructions on HOW to respond**, not what to respond.

### Recommended Template

| Principle | Instruction |
|-----------|-----------|
| General Tone | Always use a professional but warm tone. We are a parish office, not a bureaucratic office |
| Signature | Always sign with "Parish Office [Parish Name]" |
| Greetings | Adapt greeting to time (Good morning/Good evening). If foreign user, greet in their language |
| Priest Reference | If someone asks for personal interview or spiritual support, suggest calling or coming to office to make appointment |
| Emergencies | For emergencies (bereavement, seriously ill), provide direct contacts IMMEDIATELY (office phone, priest number if available) |
| Children | If request concerns children (baptism, catechism), use even more welcoming tone |

### Practical Examples

**GOOD ✅:**
```
| Principle | Instruction |
| Tone for first contacts | "We are delighted to welcome you to our community" instead of "We inform you that..." |
```

**BAD ❌:**
```
| Principle | Instruction |
| Tone | Use a kind tone |  ← TOO VAGUE
```

---

## 🎓 "AI_CORE" Sheet - Complex Situation Management

### When It Is Used

System loads this sheet ONLY for:
- Requests classified "PASTORAL" or "MIXED"
- Emails with emotional indicators (grief, suffering)
- Complex canonical situations

### What to Insert

**Guidelines for delicate situations:**

```
| Principle | Instruction |
|-----------|-----------|
| Divorced Remarried | For civilly divorced and remarried persons: DO NOT give definitive answers. Explain that situation requires personalized pastoral discernment. Invite to speak with priest. DO NOT say "you cannot" but "your situation needs a conversation" |
| Cohabiting | For cohabiting couples asking for marriage: welcome request joyfully. Explain there is a path of accompaniment. DO NOT judge, invite to make appointment |
| Bereavement | For those who lost a loved one: express closeness immediately ("We are close to you and your family in this moment of sorrow"). THEN provide practical info on funeral |
| Serious Illness | Offer concrete support: priest visit, communion at home, anointing of sick. Provide immediate contacts |
| Faith Crisis | Do not give complex theological answers via email. Invite to personal dialogue with priest. Show understanding |
| Irregular Sponsors | If sponsor does not meet requirements: explain canonical requirements BUT add "Let's talk in the office, there might be solutions" |
```

### Anti-Patterns (What NOT To Do)

❌ **Judging:**
```
"If you are divorced and remarried you cannot receive sacraments"
```

✅ **Welcoming and referring:**
```
"Thank you for your trust. The situation of those who are divorced and remarried requires a personalized pastoral discernment. I invite you to speak with Fr. Marco..."
```

---

## 📖 "Doctrine" Sheet - Theological Answers

### When It Is Used

System loads this sheet for questions like:
- "Why does the Church say that..."
- "What does the Church teach on..."
- "Is it a sin..."

### Recommended Structure

| Sub-topic | Explanation | Source | Recommended Tone | Pastoral Criterion | Limits not to cross | AI Operational Indications |
|------------|-------------|-------|------------------|--------------------|-----------------------|-------------------------|
| Sunday Mass | The Church teaches that Sunday Mass is an obligation because we celebrate Christ's Resurrection, central moment of our faith. It is the Lord's day dedicated to Him | CCC 2042, 2180-2183 | Clear but not judgmental | Explain the "why" before the "what". Show beauty before obligation | Don't just say "it's an obligation", don't scare | Start explaining meaning of Sunday, then mention precept aspect |

### Population Examples

#### Topic: Sacrament of Reconciliation

```
| Sub-topic | Explanation | Source | Recommended Tone |
|------------|-------------|-------|------------------|
| Confession mandatory? | Confession of grave sins is necessary to receive Eucharist worthily. It is a gift: Jesus forgives us through the priest. Not a heavy obligation but opportunity for reconciliation | CCC 1456-1457, 1493 | Welcoming, show confession as gift not burden |
```

#### Topic: Moral Life

```
| Sub-topic | Explanation | Source | Limits not to cross |
|------------|-------------|-------|------------------------|
| Premarital cohabitation | The Church teaches that conjugal intimacy belongs to marriage. However every person has a history: accompaniment is important | CCC 2350-2391 | DO NOT judge people. Explain doctrine BUT always invite to personal dialogue for deepening |
```

---

## 💡 Best Practices

### 1. Be Specific, Not Generic

❌ **Generic:**
```
| Category | Information | Details |
| Baptism | Documents | Documents needed |
```

✅ **Specific:**
```
| Category | Information | Details |
| Baptism | Documents | 1) Original birth certificate 2) Family status 3) Baptism request form (downloadable from www.parish.org/baptism) 4) Photocopy of parents and godparents ID |
```

### 2. Use Concrete Examples

❌ **Abstract:**
```
| Catechism | Times | Various times available |
```

✅ **Concrete:**
```
| First Communion Catechism | Times | Group A (children born 2017): Thursday 17:00-18:00. Group B (children born 2016): Saturday 16:00-17:00 |
```

### 3. Anticipate Follow-up Questions

After every info, ask yourself: "What will the user ask next?"

Example:
```
| Baptism | Documents | ... (document list) |
| Baptism | Where to get birth cert | Place of birth Municipality, Vital Statistics Office. Can also be requested online at www.anpr.it |
| Baptism | Request Form | Downloadable from www.parish.org/documents or available in office |
```

### 4. Keep Updated

**Plan quarterly review:**
- ✅ Summer/Winter schedules
- ✅ Event dates
- ✅ Contacts (if changed)
- ✅ Prices (if applicable)

---

## 🚫 What NOT into Put in KB

### Sensitive Data

❌ **Never insert:**
- Personal phone numbers of parishioners
- Personal email addresses
- Personal data of individuals
- Pastoral situations of individuals

### Changeable Information

❌ **Avoid:**
```
| Event | Date | Details |
| Patron Feast | June 21, 2026 | ... |
```

✅ **Better:**
```
| Event | Date | Details |
| Patron Feast | Third Sunday of June | ... |
```

### Personal Opinions

❌ **Do not insert:**
```
| Principle | Instruction |
| Masses | The 10am Mass is the most beautiful |
```

✅ **Objective:**
```
| Mass Times | Sunday | 8:30 (no singing), 10:00 (choir), 11:30 (families), 18:00 (youth) |
```

---

## 📊 Testing Your KB

### Quality Checklist

Use this checklist to verify your KB:

```javascript
function testKnowledgeBase() {
  console.log('🧪 KNOWLEDGE BASE TEST\n');
  
  const tests = [
    { question: 'What time is Sunday mass?', expected_answer: 'Specific times' },
    { question: 'How to baptize a child?', expected_answer: 'Documents + course + dates' },
    { question: 'I live at Via Roma 10, is it your parish?', expected_answer: 'Territory verification' }
  ];
  
  console.log('Manually verify that KB contains info to answer:');
  tests.forEach((test, i) => {
    console.log(`${i+1}. "${test.question}"`);
    console.log(`   Expected: ${test.expected_answer}`);
  });
  
  console.log('\n✓ If you have info for ALL these questions, KB is good!');
}
```

### Success Metrics

**Good KB if:**
- ✅ >80% "IA" emails (not "Check")
- ✅ <20% emails with follow-up questions
- ✅ Average validation score >0.75

**Improve if:**
- ⚠️ >30% "Check" emails
- ⚠️ Many "I don't have this information" answers
- ⚠️ Users always ask asking same things

---

## 🔄 Update Workflow

### Weekly
1. Check "Check" emails
2. Identify missing info
3. Add to KB

### Monthly
1. Review schedules (if changing seasonally)
2. Update event dates
3. Verify contacts still valid

### Annual
1. Complete review
2. Removal of obsolete info
3. Liturgical calendar update

---

## 📝 Ready-to-Use Templates

### Small Parish Template

[Download example Google Sheet]
- 50 Instructions entries
- 10 AI_CORE_LITE entries
- 5 AI_CORE entries
- 10 Doctrine entries

### Medium Parish Template

[Download example Google Sheet]
- 150 Instructions entries
- 20 AI_CORE_LITE entries
- 15 AI_CORE entries
- 30 Doctrine entries

### Large Parish Template

[Download example Google Sheet]
- 300+ Instructions entries
- 30 AI_CORE_LITE entries
- 25 AI_CORE entries
- 50 Doctrine entries

---

**Happy population! 📚**
