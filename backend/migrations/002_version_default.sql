-- 002_version_default.sql
--
-- The legacy Grails app added a NOT NULL optimistic-lock `version` column to
-- every table (except user_role / reset_password). The new app does not manage
-- `version`, so INSERTs against the existing production schema fail with
-- "Field 'version' doesn't have a default value". This gives every `version`
-- column a DEFAULT 0 so the new app can insert.
--
-- Idempotent and environment-safe: it only touches tables that actually have a
-- `version` column, so on the new-schema dev/laptop DBs (which have none) it is
-- a no-op. Run once on production (via mysql CLI or TOAD).

DELIMITER $$
DROP PROCEDURE IF EXISTS baco_version_default $$
CREATE PROCEDURE baco_version_default()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE tname VARCHAR(255);
  DECLARE cur CURSOR FOR
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'version';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO tname;
    IF done THEN LEAVE read_loop; END IF;
    -- Zero out any NULL version first, so MODIFY ... NOT NULL can't fail on legacy rows.
    SET @u = CONCAT('UPDATE `', tname, '` SET `version` = 0 WHERE `version` IS NULL');
    PREPARE ustmt FROM @u; EXECUTE ustmt; DEALLOCATE PREPARE ustmt;
    SET @s = CONCAT('ALTER TABLE `', tname, '` MODIFY `version` BIGINT NOT NULL DEFAULT 0');
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END $$
DELIMITER ;

CALL baco_version_default();
DROP PROCEDURE baco_version_default;
