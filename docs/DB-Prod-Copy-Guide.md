# Copy the production DB to the laptop as a new database

Export the real (production) database from GCP, import it on the private laptop
under a **new, unique name**, then apply the two migrations that bring it to the
current app structure.

Four phases: **export from GCP → (file is already on the laptop) → create + import
as a new DB → apply migrations**. Nothing here touches production (the dump is
read-only) or your existing local DBs.

Run the commands in **Git Bash** (where `<` redirection and forward slashes
work). If `mysql` / `mysqldump` aren't found, add your MySQL `bin` to PATH first:

```bash
export PATH="$PATH:/c/Program Files/MySQL/MySQL Server 9.7/bin"
```

(adjust the version number to match what you installed).

---

## 0. Get the production connection details from Toad

Open Toad → your GCP connection → **Edit / Properties**, and note:

- **Host** — the Cloud SQL public IP or proxy host
- **Port** — usually `3306`
- **User**
- **Schema name** — your prod DB, almost certainly `play_tennis`

You already know the password.

---

## 1. Export production → a dump file on the laptop

Run on the laptop; it connects to GCP and writes the file locally, so there is no
separate "move" step. Replace `<GCP_HOST>`, `<GCP_USER>`, `<PROD_DB>`:

```bash
mysqldump -h <GCP_HOST> -P 3306 -u <GCP_USER> -p --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 <PROD_DB> > ~/baco_prod_dump.sql
```

It prompts for the production password. Note: **no** `--databases` flag — that is
what lets us import under a new name. Confirm the file has content:

```bash
ls -lh ~/baco_prod_dump.sql
```

---

## 1b. If you exported per-table with Toad 7.3 (many .sql files)

Toad's per-table export writes **one `.sql` file per table** (each with its
`CREATE TABLE` + `INSERT`s). Merge them into a single file that (a) is
order-independent for foreign keys and (b) targets your new DB name:

```bash
cd "/c/path/to/the/toad/export/folder"      # folder holding the per-table .sql files
NEWDB=baco_prod_copy_20260826               # your new DB name
{ echo "SET FOREIGN_KEY_CHECKS=0;"; echo "SET NAMES utf8mb4;"; cat *.sql; echo "SET FOREIGN_KEY_CHECKS=1;"; } \
  | sed "s/\`play_tennis\`/\`$NEWDB\`/g" \
  > ~/baco_import_all.sql
```

What this does:
- **Merges** every per-table file into `~/baco_import_all.sql` (written to your
  home dir so it isn't re-included by the `*.sql` glob).
- **Solves the FK ordering problem** by wrapping the load in
  `SET FOREIGN_KEY_CHECKS=0; … SET FOREIGN_KEY_CHECKS=1;`. With FK checks off
  during load, the order of the table files no longer matters (a child table can
  be created/filled before its parent). This is simpler and safer than ordering
  25+ files by hand.
- **Renames the database** `play_tennis` → your new name. The files contain
  db-qualified names like `` `play_tennis`.`user` `` and `USE `play_tennis``;
  the `sed` rewrites the backtick-quoted `` `play_tennis` `` to `` `$NEWDB` ``
  so everything lands in your copy.

Then in Step 4, import `~/baco_import_all.sql` (instead of `~/baco_prod_dump.sql`).

### Do I need to re-enable foreign keys after import?
No extra step. The `SET FOREIGN_KEY_CHECKS=1;` at the **end** of the merged file
turns them back on, and `FOREIGN_KEY_CHECKS` is a **session** setting anyway — it
only affected that one import session, and every normal connection (including the
app) always starts with FK checks **on**.

### `ENGINE=InnoDB AUTO_INCREMENT=… DEFAULT CHARSET=utf8` — keep or change?
**Keep it as-is** — it imports fine on MySQL 9.7:
- `ENGINE=InnoDB` — correct, leave it.
- `AUTO_INCREMENT=14` — just seeds the next id; keep it so id sequences match production.
- `DEFAULT CHARSET=utf8` — `utf8` is 9.x's alias for `utf8mb3`; it's accepted, and
  Hebrew is 3-byte so nothing is lost (you already imported once with it).

Optional — if you'd rather standardize the copy on `utf8mb4`, extend the `sed`:
```bash
  ... | sed -E "s/\`play_tennis\`/\`$NEWDB\`/g; s/CHARSET=utf8([^m])/CHARSET=utf8mb4\1/g; s/utf8_unicode_ci/utf8mb4_unicode_ci/g" > ~/baco_import_all.sql
```
This is optional — the plain version above works.

---

## 2. (Only if step 4 errors on DEFINER / SUPER) strip DEFINER clauses

Cloud SQL dumps often carry `DEFINER=` on triggers/procedures that don't exist
locally. If the import fails with a DEFINER or SUPER/SET_USER_ID error, make a
cleaned copy and use it instead:

```bash
sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' ~/baco_prod_dump.sql > ~/baco_prod_dump_clean.sql
```

---

## 3. Create the new database (unique name)

Using today's date for uniqueness — `baco_prod_copy_20260826`:

```bash
mysql -u root -p -e "CREATE DATABASE baco_prod_copy_20260826 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

---

## 4. Import the dump into the new DB

```bash
mysql -u root -p baco_prod_copy_20260826 < ~/baco_prod_dump.sql
```

- If you took the **mysqldump** route (Step 1) and did Step 2, use
  `~/baco_prod_dump_clean.sql` instead.
- If you took the **Toad per-table** route (Step 1b), use the merged file:
  ```bash
  mysql -u root -p baco_prod_copy_20260826 < ~/baco_import_all.sql
  ```

---

## 5. Alter it to the new-app structure (the two migrations)

Run from the repo root so the paths resolve. **Order matters** (001 then 002):

```bash
mysql -u root -p baco_prod_copy_20260826 < backend/migrations/001_modernization_schema.sql
```

```bash
mysql -u root -p baco_prod_copy_20260826 < backend/migrations/002_version_default.sql
```

- **001** adds the objects the new app needs (`audit_log` table,
  `holiday_dates.court_number`, `club.slot_window_days`) — additive only,
  idempotent.
- **002** gives every legacy `version` column a `DEFAULT 0` so the new app can
  INSERT.

Nothing else is needed: the app's models already match the production names
(`rental_tamplate`, `minuts_offset`, `club.gate_pone`, `DOUBLE` prices), so there
is no table/column renaming to do on a **production** copy.

---

## 6. Point the app at the new DB and restart

Edit `backend/.env`:

```
DATABASE_URL=mysql+pymysql://root:<YOUR_LOCAL_PASSWORD>@127.0.0.1:3306/baco_prod_copy_20260826?charset=utf8mb4
```

Then restart the backend:

```bash
cd backend && ./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

---

## 7. Verify

```bash
mysql -u root -p baco_prod_copy_20260826 -e "SHOW TABLES LIKE 'audit_log'; SELECT COUNT(*) AS clubs FROM club; SELECT COUNT(*) AS users FROM user; SHOW COLUMNS FROM club LIKE 'slot_window_days';"
```

You should see `audit_log` present, your real club/user counts, and the
`slot_window_days` column.

---

## Troubleshooting

- `Unknown table 'column_statistics'` during export → add `--column-statistics=0`
  to the step-1 command (MySQL 8/9 client vs older server).
- Can't reach GCP / timeout → make sure the laptop's IP is in Cloud SQL
  **Authorized networks** and use the same host/creds Toad uses; if SSL is
  enforced, add `--ssl-mode=REQUIRED` to step 1.
- DEFINER / SUPER error on import → use the cleaned dump from step 2.
- GTID error on import → confirm `--set-gtid-purged=OFF` was in the step-1 dump.
- **Syntax error on an INSERT whose text ends with a backslash** — e.g.:
  ```sql
  INSERT INTO `user`(`id`,`version`,...,`first_name`,`last_name`,...) VALUES (985,0,...,'אורי \','אינשטיין',...);
  ```
  Toad exported the literal backslash as a single `\`, and MySQL reads `\'` as an
  *escaped quote*, so the string never closes and the statement breaks. **Manually
  edit** the merged `~/baco_import_all.sql`: find that value and either remove the
  stray trailing backslash (`'אורי \'` → `'אורי '`) or double it to keep the
  backslash (`'אורי \\'`). The error message points at the line/area to fix. (This
  is a known Toad export quirk with values ending in `\`.)
- Keep the dump **out of git** — leaving it in `~/` (your home dir) does that
  automatically; never add `*.sql` dumps to the repo.
