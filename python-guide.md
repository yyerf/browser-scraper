# Python guide: Visual Scraper midterm pitch

For **Geoffrey Diapana** and **Earl Cedric Coronado**, BSCS - 4A.
Deck: <https://claude.ai/artifact/D7EpitSGKiQYUdFU9xafWP>. Download the .pptx again, because the Python slides are new.

---

## 1. Does it need Python? (the honest answer)

**No. Visual Scraper today has no Python in it.** It is 100% TypeScript:

| Part | Language | Why it can't just be Python |
|---|---|---|
| Browser extension (picker, record detection, preview) | TypeScript + React | Chrome and Firefox extensions run only JavaScript. Python can't run inside a web page. |
| Shared engine (`scraper-dom`, `scraper-core`) | TypeScript | The same code has to run in the extension and in the worker. |
| Worker CLI (`apps/worker`) | TypeScript on Node.js | Uses Playwright + Crawlee for Node and `better-sqlite3`. |

**How we fix it without lying:** we add a second part written in Python, the **Scraper Data Lab**. The extension collects the data. Python takes the files it saves and does the file handling and the machine learning. That's also how real companies work: data gets collected in whatever language fits, and the analysis and ML happen in Python.

> **The one sentence to remember:**
> "The clicking part has to be JavaScript because it runs inside the browser. Everything after the data is saved is Python, and that Python part is our midterm project."

Say it early (slide 6). If the instructor hears "TypeScript" first and "Python" only at the end, it will sound like an excuse.

---

## 2. The 30-second pitch

> "Our app is **Visual Scraper**. You open a website with a list, like products or job posts, and click one example of each thing you want: the name, the price. The app finds every similar item on the page, follows the next pages, and saves everything as a file.
> For this Python subject we're building the **Scraper Data Lab** in Python. It **reads** the files the scraper saves (CSV, JSON, a SQLite database), **merges** them into one dataset without duplicates, keeps a **history log**, and trains a **machine-learning model** with scikit-learn. The model learns to recognise what kind of data each column holds (price, date, number or text), so the data comes out clean."

---

## 3. What the Python app is (the midterm deliverable)

**Name:** Scraper Data Lab (`datalab.py`)
**Form:** a simple menu app in the terminal. A Tkinter window only if time allows.
**Purpose:** turn raw scraper output into a clean, merged dataset and a trained model.
**Target users:** the same people as the extension (students, ML beginners, small businesses), once they have exported their data.

```
=== Scraper Data Lab ===
1  Import scraped files
2  Clean & merge into dataset
3  Train field-type model
4  Predict types for a new file
5  Show report
0  Exit
```

### Files the Python app handles

| File | Made by | Python reads / writes | Python module |
|---|---|---|---|
| `shop-definition.json` (the recipe) | Extension: **Download definition** button | **Read**, then validate | `json` |
| `shop.csv` / `.json` / `.xlsx` (the results) | Extension or worker export | **Read** | `csv`, `json`, `openpyxl` (xlsx, optional) |
| `worker-data/runs.sqlite` | Worker CLI | **Read** (read-only mode) | `sqlite3` |
| `datalab/dataset.csv` (master dataset) | **Python** | **Append / update**, skipping duplicates | `csv` |
| `datalab/history.log` | **Python** | **Append** one line per action | `open(..., "a")` |
| `datalab/training.csv` | **Python** | **Write**, then read to train | `csv` |
| `datalab/model.joblib` (the model) | **Python** | **Write** after training, **read** to predict | `joblib` |
| `datalab/metrics.json` (accuracy) | **Python** | **Write** | `json` |
| `datalab/cleaned.csv` | **Python** | **Write**: typed prices, numbers, dates | `csv` |

That covers every operation the activity asks for: **read, write, update, process**.

### Details from the real code (use these to sound like you know it deeply)

These come from reading the actual source. They're the non-obvious things the Python code has to handle:

1. **The CSV starts with a BOM** (`﻿`, in `packages/scraper-export/src/index.ts`) so Excel shows ₱ and accents correctly. In Python, open it with `encoding="utf-8-sig"` or the first column name comes out as `"﻿title"`.
2. **Every CSV cell is quoted and lines end in `\r\n`.** `csv.DictReader` with `newline=""` handles both.
3. **Formula guard:** text starting with `= + - @` gets a `'` in front so Excel won't run it as a formula (a CSV-injection defence). Python strips that `'` for analysis.
4. **Prices in the CSV look like `1299.00 ₱`** (amount, space, symbol). In the JSON export they're an object: `{"amount": "1299.00", "currency": "₱"}`.
5. **`runs.sqlite` has 3 tables:** `runs(run_id, definition_json, profile_name)`, `records(run_id, hash, record_json)`, `checkpoints(run_id, checkpoint_json)`. Each record is JSON holding `rawValue`, `normalizedValue` and `status` per field. We open it **read-only** (`?mode=ro`) so Python can never damage the worker's data.
6. **Every field in the definition already has a `type`** (`text`, `currency`, `number`, `date`, …). That gives us free labels for ML training.
7. **Today's type detection is regex rules** (`classifyValue` in `packages/scraper-dom/src/index.ts`). It knows dates only in ISO form (`2026-09-29`), so **"Sep 29, 2026" gets saved as plain text**. That gap is exactly what our ML model fixes.

---

## 4. The Python code (tested)

I ran this against sample files built in the exact formats the app writes: CSV with BOM, the formula guard, the same SQLite schema. It works. Put it in `datalab.py`.

```python
"""Scraper Data Lab: the Python half of Visual Scraper."""
import csv
import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

DATA = Path("datalab")
MASTER = DATA / "dataset.csv"
LOG = DATA / "history.log"


def log(message):
    """APPEND one line per action, so the history is never overwritten."""
    DATA.mkdir(exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {message}\n")


def read_definition(path):
    """READ the recipe JSON the extension downloads, and check it is really one."""
    with open(path, encoding="utf-8") as f:
        definition = json.load(f)
    if definition.get("version") != 1 or not definition.get("fields"):
        raise ValueError(f"{path} is not a Visual Scraper definition (version 1)")
    return definition


def read_results_csv(path):
    """READ an exported CSV. utf-8-sig drops the BOM the app adds for Excel."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        for key, value in row.items():
            # The app writes '=... so Excel won't run it as a formula; undo that for analysis.
            if len(value) > 1 and value[0] == "'" and value[1:].lstrip()[:1] in ("=", "+", "-", "@"):
                row[key] = value[1:]
    log(f"read {len(rows)} rows from {path}")
    return rows


def read_training_values(db_path):
    """READ (value, type) pairs from the worker's database, opened read-only."""
    pairs = []
    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as db:
        definitions = {
            run_id: json.loads(text)
            for run_id, text in db.execute("SELECT run_id, definition_json FROM runs")
        }
        for run_id, record_text in db.execute("SELECT run_id, record_json FROM records"):
            types = {field["id"]: field["type"] for field in definitions[run_id]["fields"]}
            for result in json.loads(record_text)["fields"]:
                if result["status"] == "success" and result["rawValue"]:
                    pairs.append((result["rawValue"], types[result["fieldId"]]))
    log(f"read {len(pairs)} labelled values from {db_path}")
    return pairs


def write_training_csv(pairs, path):
    """WRITE training data: one row per value, with its label."""
    DATA.mkdir(exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["value", "label"])
        writer.writerows(pairs)
    log(f"wrote {len(pairs)} training rows to {path}")


def merge_into_master(rows, key_fields):
    """UPDATE the master dataset: append new rows, skip ones already there."""
    DATA.mkdir(exist_ok=True)
    seen = set()
    if MASTER.exists():
        with open(MASTER, newline="", encoding="utf-8") as f:
            seen = {tuple(row[k] for k in key_fields) for row in csv.DictReader(f)}
    fresh = [row for row in rows if tuple(row[k] for k in key_fields) not in seen]
    new_file = not MASTER.exists()
    with open(MASTER, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        if new_file:
            writer.writeheader()
        writer.writerows(fresh)
    log(f"merged {len(fresh)} new rows, skipped {len(rows) - len(fresh)} duplicates")
    return len(fresh)


def train_model(training_csv, model_path=DATA / "model.joblib"):
    """Train a field-type classifier and WRITE the model plus its accuracy."""
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import make_pipeline

    with open(training_csv, newline="", encoding="utf-8") as f:
        data = list(csv.DictReader(f))
    texts = [row["value"] for row in data]
    labels = [row["label"] for row in data]
    x_train, x_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.25, random_state=42, stratify=labels
    )
    model = make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(1, 3)),
        LogisticRegression(max_iter=1000),
    )
    model.fit(x_train, y_train)
    accuracy = accuracy_score(y_test, model.predict(x_test))
    joblib.dump(model, model_path)
    with open(DATA / "metrics.json", "w", encoding="utf-8") as f:
        json.dump({"accuracy": round(accuracy, 3), "train": len(x_train), "test": len(x_test)}, f, indent=2)
    log(f"trained model, test accuracy {accuracy:.1%}")
    return accuracy


def predict_types(values, model_path=DATA / "model.joblib"):
    """READ the saved model and label new values. Only load model files you made yourself."""
    import joblib

    return [str(label) for label in joblib.load(model_path).predict(values)]
```

Install: `pip install scikit-learn joblib` (add `openpyxl` if you read .xlsx).

**What the test showed:**
- Reading the CSV gave clean rows (`'price': '1299.00 ₱'`), and the formula guard was undone correctly.
- Merging the same file twice: first time **3 new rows**, second time **0 new, 3 duplicates skipped**. The "update without duplicates" works.
- Reading `runs.sqlite` gave labelled pairs such as `('₱1,299.00', 'currency')`, `('2026-09-01', 'date')`.
- After adding hand-labelled examples like "Sep 29, 2026" → `date`, the model predicted `date` for "Sep 29, 2026", which the regex rules call `text`.
- `history.log` recorded every step.

> ⚠️ **Don't quote an accuracy number yet.** My test data was small and made up, so its 100% means nothing. Tell the instructor: "We'll measure accuracy on real scraped data, with a 75/25 train/test split, and save it to `metrics.json`."

> ⚠️ **One gap to fix when you build it:** `dataset.csv` is written without the formula guard. If someone opens it in Excel, re-add the `'` in front of cells starting with `= + - @`, the same way the app does.

---

## 5. The ML part, in plain words

**What problem it solves:** the scraper has to decide what kind of value each field is (price, date, number, text) so it can store `₱1,299.00` as the number `1299.00` and not as text. Today it uses hand-written rules (regex), and those miss formats like "Sep 29, 2026".

**How the model works (say it like this):**
1. "We collect a lot of example values with the right answer. The scraper's database already stores each field's type, and we hand-fix the ones the rules got wrong."
2. "**TF-IDF on characters** turns each value into numbers based on the little letter groups it contains: `₱1`, `,2`, `Sep`. Prices share `₱` and `.00`; dates share month names and years."
3. "**Logistic regression** learns which letter groups point to which type."
4. "We test it on 25% of the data it never saw, and save the model to a `.joblib` file and the accuracy to `metrics.json`."
5. "The app loads the model file later to label new columns, so the model is trained once and reused."

**Why it counts as ML and not just rules:** the rules were written by a person; the model learns the patterns from labelled examples. Give it new examples (other currencies, Filipino date formats) and it gets better without anyone writing a new regex.

**The existing "learning from examples" part (slide 14):** the extension already learns from your clicks. It scores candidate record containers with a weighted formula: 0.40 coverage + 0.25 similarity + 0.23 repetition + 0.12 compactness. **Those weights were set by hand; nothing was trained.** Say so if asked. Learning those weights too is a stretch goal.

**Stretch goals (only mention as "if time allows"):**
- Train on the *scraped data itself*: price trends over time, or sentiment on scraped reviews.
- Learn the record-detection weights (needs changes to the TypeScript side, so it's harder).

---

## 6. Slide-by-slide script

The speaker notes in the deck have the full text. This is the short version, with the Python angle. **G** = Geoffrey, **E** = Earl.

| # | Slide | Who | Say this |
|---|---|---|---|
| 1 | Cover | G | "We're Geoffrey and Earl from BSCS - 4A. Our concept is Visual Scraper: collect website data by clicking examples." |
| 2 | Problem | G | "Getting data off a website means copy-paste by hand, or writing a scraper, which needs coding and breaks when the site changes. We sit in between." |
| 3 | Users | G | "It's for students and researchers who need datasets, ML beginners who need training data, small businesses tracking prices, and analysts." |
| 4 | How it works | G | "Four steps: click examples, it finds the pattern, preview and follow pages, export. Our test: 4 fields, 60 rows over 3 pages." |
| 5 | Features | G | "Point and click, record detection, auto paging, self-healing when the site changes, export to JSON/CSV/Excel, and it's private: no server." |
| 6 | **Where Python fits** | E | "**The clicking part has to be JavaScript because browsers only run JavaScript. The files it saves are the bridge. Everything after that is our Python app, the Scraper Data Lab.**" |
| 7 | **The Python app** | E | Walk through the menu: import → merge → train → predict → report, and name each file operation (read, update, write, append). |
| 8 | File handling intro | E | "Every step reads or writes a file." |
| 9 | Files table | E | Go through the rows. Point out the two Python rows: `dataset.csv` and the model file. |
| 10 | File flow | E | "Recipe is read, the engine processes, rows and checkpoint are saved together, then exported. If it crashes, it resumes from the checkpoint." |
| 11 | Read/Write/Update/Process | E | "The four operations the activity asks for, each with a real example." |
| 12 | Safety rules | E | "Validate every file, save rows and checkpoint in one transaction, hash rows to skip duplicates, protect Excel from formulas, never store passwords." |
| 13 | **Python code** | E | "This is the core of our file handling in Python: `json` for the recipe, `csv` with `utf-8-sig` for the export, `sqlite3` read-only for the database, and append mode for the log." |
| 14 | ML today | G | "The extension already learns from examples with a weighted score. Honestly, those weights are hand-set; no model is trained yet." |
| 15 | **ML in Python** | G | "Our model: collect labelled values into `training.csv`, train TF-IDF + logistic regression in scikit-learn, save to `.joblib`, use it to clean new exports. It catches dates like 'Sep 29, 2026' that the rules miss." |
| 16 | Status | G | "The TypeScript scraper already works as a pilot. What's new for the midterm is the Python Data Lab." |
| 17 | Team | E | "Geoffrey keeps the extension and writes the Python readers. I do merging, the log and reports. We build the ML model together." |
| 18 | Closing | Both | "Click. Learn. Export. Questions?" |

---

## 7. Questions the instructor may ask

**"This is a Python subject. Why is your app in TypeScript?"**
> "The scraper runs inside the browser, and browsers only run JavaScript, so that part can't be Python. Our midterm deliverable is the Python part: all the file handling and ML happen in Python on the files the scraper produces."

**"Why not just scrape with Python, like BeautifulSoup or Selenium?"**
> "You can, but then you write CSS selectors by hand in code. Our point is that you click instead. And we can do both: the recipe file is plain JSON, so Python can read it and scrape simple pages with BeautifulSoup. That's our Plan B." (See section 8.)

**"Where exactly is the file handling?"**
> "Reading the JSON recipe, reading the CSV export with the right encoding, reading SQLite read-only, appending to the master dataset without duplicates, appending to a history log, writing training data, writing and reading the model file, and writing metrics." Point at slide 7 or 9.

**"How is this machine learning and not just if-statements?"**
> "The model isn't told the rules. It learns from labelled examples, and we measure it on data it hasn't seen. The old regex is if-statements; the model replaces it."

**"Where do the labels come from?"**
> "Each field in the recipe already has a type, so every scraped value comes pre-labelled. The weak point is that those labels came from the same regex, so we hand-check a sample and add the formats the regex gets wrong. We're open about that."

**"How much data do you need?"**
> "Each scrape gives hundreds of values; one test run is 60 rows × 4 fields = 240 values. We'll combine several sites and report accuracy on a held-out 25%."

**"Is scraping legal / ethical?"**
> "We scrape only public pages, respect the site's terms, keep a delay between actions (1 second by default), and the app has no CAPTCHA or login bypass by design. We test on our own local test site."

**"What if the website changes its layout?"**
> "The saved scraper tries to re-find the field using a fingerprint of the element, and logs every fix with a confidence score. If it isn't sure, it leaves the value missing instead of guessing."

**"Is the extension already done? What's left?"**
> "The TypeScript scraper works as a pilot and has automated tests. The Python Data Lab and the ML model are what we build for the midterm."

---

## 8. Plan B: if the instructor wants Python to do the scraping too

The recipe file is plain JSON, and its selectors are relative to each record. So Python can run a simple scraper from it. I tested this with a small HTML page:

```python
import requests
from bs4 import BeautifulSoup


def scrape_static(html, definition):
    """Run a Visual Scraper recipe on plain HTML with BeautifulSoup."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for record in soup.select(definition["record"]["locator"]["primarySelector"]):
        row = {}
        for field in definition["fields"]:
            element = record.select_one(field["locator"]["primarySelector"])
            if element is None:
                row[field["name"]] = None
            elif field["extractionMode"] in ("href", "src", "alt", "title"):
                row[field["name"]] = element.get(field["extractionMode"])
            else:
                row[field["name"]] = " ".join(element.get_text().split())
        rows.append(row)
    return rows


definition = read_definition("shop-definition.json")
html = requests.get(definition["scope"]["startUrls"][0], timeout=15).text
rows = scrape_static(html, definition)
```

**Be upfront about its limits:** it only works on pages whose HTML already contains the data. It doesn't run JavaScript, follow pagination, or self-heal like the real engine does. Needs `pip install requests beautifulsoup4`.

---

## 9. Don't claim these (they aren't true yet)

- ❌ "The app uses AI / a trained model." → The extension uses **hand-tuned scoring**. The trained model is **planned** (Python).
- ❌ "It's written in Python." → The extension and worker are **TypeScript**. The **Data Lab** is Python.
- ❌ Any accuracy number. → "We'll measure it and save it to `metrics.json`."
- ❌ "It works on every website." → Closed shadow DOM, cross-site frames and CAPTCHA-protected sites don't work.
- ✅ True and safe to say: 60 unique rows over 3 pages in automated tests; reruns still work after HTML changes; exports to JSON/CSV/XLSX; no server or analytics.

---

## 10. Words to explain simply if asked

| Term | Say |
|---|---|
| Scraper | A program that copies data from web pages automatically. |
| DOM / HTML element | The building blocks of a web page, like a price tag or a title. |
| Selector | An address for an element, like `.price`. |
| Record | One repeated item on the page, like one product card. |
| Fingerprint | A short description of an element (tag, classes, parents, children) used to find it again. |
| Checkpoint | A save point, like in a video game, so a stopped run continues. |
| Hash | A short code made from a row's values; same values give the same code, so duplicates are easy to spot. |
| Transaction | Saving several things all at once, or none of them, so a crash can't leave half-saved data. |
| BOM | An invisible marker at the start of a file that tells Excel it's UTF-8. |
| TF-IDF | Turns text into numbers by counting which letter groups appear. |
| Logistic regression | A simple ML model that learns which features point to which category. |
| joblib | A Python library that saves a trained model to a file and loads it back. |

---

## 11. Checklist before you pitch

- [ ] Download the deck again as .pptx (it now has 18 slides with the Python ones).
- [ ] Practise the one sentence from section 1.
- [ ] Decide who presents which slides (table in section 6).
- [ ] Optional but strong: run `datalab.py` on a real export and show `history.log` and `dataset.csv` on your laptop.
