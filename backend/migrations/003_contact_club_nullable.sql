-- 003_contact_club_nullable.sql
--
-- The legacy `contact` table had club_id NOT NULL (contact-us messages were
-- per-club and emailed to that club). The new app's "צור קשר" form is global —
-- it has no club and sends every message to the BACO service inbox — so it
-- inserts club_id = NULL, which the NOT NULL constraint rejects
-- (1048 "Column 'club_id' cannot be null"). Relax it to allow NULL.
--
-- Safe and idempotent:
--   * Only acts when contact.club_id exists AND is currently NOT NULL, so on
--     dev/new-schema DBs (already nullable) it is a no-op.
--   * Preserves the column's existing type (COLUMN_TYPE) — do NOT hardcode
--     BIGINT, or the change conflicts with the FK to club.id when that column
--     is INT (dev) vs BIGINT (production).

SET @ct = (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contact'
             AND COLUMN_NAME = 'club_id' AND IS_NULLABLE = 'NO');
SET @sql = IF(@ct IS NOT NULL,
              CONCAT('ALTER TABLE contact MODIFY club_id ', @ct, ' NULL'),
              'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
