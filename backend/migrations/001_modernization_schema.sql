-- ============================================================================
-- BACO / TennisLine — modernization schema migration #001
--
-- Brings a legacy `play_tennis` database up to the current app schema.
-- Applies THREE changes:
--   1. NEW table  `audit_log`            (manager/admin action trail)
--   2. NEW column `holiday_dates.court_number`  (per-court holiday blocking)
--   3. NEW column `club.slot_window_days`       (per-club slot generation window)
--
-- SAFE TO RUN ONCE, and idempotent (re-running does nothing if already applied).
-- It only ADDS objects — it never drops or modifies existing data.
--
-- HOW TO RUN (from a machine that can reach the DB):
--   mysql -h HOST -u USER -p YOUR_DB_NAME < 001_modernization_schema.sql
-- e.g. locally:
--   mysql -u root -p play_tennis < 001_modernization_schema.sql
--
-- REQUIRES the `mysql` command-line client (it understands DELIMITER).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) audit_log  (CREATE TABLE IF NOT EXISTS is natively idempotent)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`         INT           NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- app sets this; default is a safety net
  `user_id`    INT           NULL,
  `user_name`  VARCHAR(255)  NOT NULL DEFAULT '',                 -- denormalized "First Last <email>"
  `club_id`    INT           NULL,                                -- NULL = global action
  `club_name`  VARCHAR(255)  NULL,                                -- denormalized club name
  `action`     VARCHAR(64)   NOT NULL,                            -- stable code, e.g. 'schedule.save'
  `summary`    VARCHAR(512)  NOT NULL DEFAULT '',                 -- human Hebrew one-liner
  `detail`     TEXT          NULL,                                -- JSON blob with specifics
  PRIMARY KEY (`id`),
  KEY `idx_audit_created_at` (`created_at`),
  KEY `idx_audit_club`       (`club_id`),
  KEY `idx_audit_user`       (`user_id`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- NOTE: if the FK errors because the legacy `user` table isn't InnoDB / uses a
-- different id type, delete the CONSTRAINT line above and re-run — the app does
-- not depend on the FK, only on the columns.

-- ----------------------------------------------------------------------------
-- 2) + 3) Add columns idempotently.
-- MySQL has no "ADD COLUMN IF NOT EXISTS", so use a helper procedure that checks
-- information_schema first, then re-adds only if missing.
-- ----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `baco_add_column_if_missing`;
DELIMITER $$
CREATE PROCEDURE `baco_add_column_if_missing`(
  IN p_table  VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_ddl    VARCHAR(255)   -- column definition, e.g. '`court_number` INT NULL'
)
BEGIN
  IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = p_table
           AND COLUMN_NAME  = p_column
     ) THEN
    SET @ddl := CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

-- 2) per-court holiday blocking: holiday_dates.court_number (NULL = all courts)
CALL `baco_add_column_if_missing`('holiday_dates', 'court_number', '`court_number` INT NULL');

-- 3) per-club slot generation window: club.slot_window_days (NULL = default 30 days)
CALL `baco_add_column_if_missing`('club', 'slot_window_days', '`slot_window_days` INT NULL');

DROP PROCEDURE IF EXISTS `baco_add_column_if_missing`;

-- ----------------------------------------------------------------------------
-- Verification (optional — prints the resulting structures)
-- ----------------------------------------------------------------------------
SELECT 'audit_log columns:' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log'
 ORDER BY ORDINAL_POSITION;

SELECT 'holiday_dates.court_number present?' AS info;
SELECT COUNT(*) AS present
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'holiday_dates' AND COLUMN_NAME = 'court_number';

SELECT 'club.slot_window_days present?' AS info;
SELECT COUNT(*) AS present
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club' AND COLUMN_NAME = 'slot_window_days';
