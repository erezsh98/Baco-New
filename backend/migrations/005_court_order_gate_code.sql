-- 005_court_order_gate_code.sql
--
-- TTLock integration (v1.1.0). Stores the offline keypad PIN minted for a booking
-- so the SAME code appears in the confirmation email and on the user's web
-- reservation. `keyboardPwd/get` returns a different code every call, so the
-- value must be persisted once, at booking finalization.
--
-- Nullable and additive: clubs without TTLock (and every existing row) simply
-- leave it NULL. No other schema changes — enabling a club is env-only.
--
-- Safe and idempotent: only adds the column if it isn't already there.

SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'court_order' AND COLUMN_NAME = 'gate_code');
SET @sql = IF(@has = 0,
              'ALTER TABLE court_order ADD COLUMN gate_code VARCHAR(16) NULL',
              'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
