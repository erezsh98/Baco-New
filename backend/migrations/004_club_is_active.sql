-- 004_club_is_active.sql
--
-- Soft "active" flag for clubs. Inactive clubs are hidden from the user-facing
-- club dropdowns (GET /clubs) but remain fully intact in the DB and visible to
-- super-admin — so a retired club can be hidden without deleting the many rows
-- that reference it, and can be re-activated at any time.
--
-- Default is ACTIVE: the column is NOT NULL DEFAULT 'Y', so every existing club
-- and every new club is active unless explicitly set to 'N'.
--
-- Safe and idempotent: only adds the column if it isn't already there.

SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club' AND COLUMN_NAME = 'is_active');
SET @sql = IF(@has = 0,
              "ALTER TABLE club ADD COLUMN is_active CHAR(1) NOT NULL DEFAULT 'Y'",
              'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Belt-and-suspenders: ensure no club is left without a value.
UPDATE club SET is_active = 'Y' WHERE is_active IS NULL OR is_active = '';
