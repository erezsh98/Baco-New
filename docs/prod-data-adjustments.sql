-- ============================================================================
-- prod-data-adjustments.sql
--
-- Data adjustments to run on a PRODUCTION COPY database (e.g. the
-- baco_prod_copy_* DB created via DB-Prod-Copy-Guide.md) so the new app behaves
-- correctly on real production data. Run AFTER the import (Step 4) and the two
-- migrations (Step 5):
--
--   mysql -u root -p baco_prod_copy_20260826 < docs/prod-data-adjustments.sql
--
-- These are DATA changes only (no schema changes). Safe to re-run.
-- NOTE: edit @admin_email below before running.
-- ============================================================================

-- Who should get super-admin (ניהול על). Must be an existing user's username (email).
SET @admin_email := 'YOUR_EMAIL@example.com';

-- ----------------------------------------------------------------------------
-- 1) Super-admin role
--
-- Production only has ROLE_USER and ROLE_ADMIN. The new "ניהול על" screens are
-- gated on ROLE_SUPER_ADMIN, which doesn't exist yet. Create it and grant it to
-- the account above. (ROLE_ADMIN club managers already exist via user_role.)
-- ----------------------------------------------------------------------------
INSERT INTO role (version, authority)
SELECT 0, 'ROLE_SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM role WHERE authority = 'ROLE_SUPER_ADMIN');

INSERT IGNORE INTO user_role (role_id, user_id)
SELECT r.id, u.id
FROM role r
JOIN user u ON u.username = @admin_email
WHERE r.authority = 'ROLE_SUPER_ADMIN';

-- ----------------------------------------------------------------------------
-- 2) Keep the current schedules generating slots
--
-- The scheduler only generates future slots inside a template's
-- [start_effective_date, end_effective_date]. In production every active
-- template ends <= 2026, and each court has several historical active periods.
--
--   2a. Extend ONLY the latest period per still-open court to the 2050 "renew"
--       sentinel (RENEW_END = 2050-12-31). This makes that court an
--       "auto/renew" schedule that generates perpetually. We deliberately do
--       NOT bump every active row — that would make the old historical periods
--       overlap the current one and create duplicate / double-booked slots.
--   2b. Deactivate the leftover historical periods (end already in the past) so
--       they never generate and don't clutter the schedule editor.
--
-- Courts whose latest period already ended (defunct clubs) are left closed;
-- create a fresh schedule for them in the app if you want them live.
-- ----------------------------------------------------------------------------

-- 2a — extend the current period of each still-open court to 2050
UPDATE rental_tamplate r
JOIN (
  SELECT club_id, court_number, MAX(end_effective_date) AS mx
  FROM rental_tamplate
  WHERE is_active = 'Y'
  GROUP BY club_id, court_number
) m
  ON r.club_id = m.club_id
 AND r.court_number = m.court_number
 AND r.end_effective_date = m.mx
SET r.end_effective_date = '2050-12-31 00:00:00'
WHERE r.is_active = 'Y' AND m.mx >= CURDATE();

-- 2b — retire the old historical periods (run AFTER 2a)
UPDATE rental_tamplate
SET is_active = 'N'
WHERE is_active = 'Y' AND end_effective_date < CURDATE();

-- ----------------------------------------------------------------------------
-- 3) OPTIONAL tidy-ups (uncomment to apply)
--
-- The code already handles these as-is; these just normalize the values.
-- ----------------------------------------------------------------------------

-- for_member: production has both 'yes' and 'Y'. The code treats ANY non-null
-- value as subscriber-only, so both already work; normalize to 'Y' if you like.
-- UPDATE rental_tamplate SET for_member = 'Y' WHERE for_member IS NOT NULL;

-- court_order.is_final: production has stray 'CA' / 'CR' besides Y / C / NULL.
-- Only 'Y' counts as confirmed, so these are harmless; collapse to 'C' if you like.
-- UPDATE court_order SET is_final = 'C' WHERE is_final IN ('CA', 'CR');

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
SELECT 'super_admin_users' AS check_name,
       COUNT(*) AS n
FROM user_role ur
JOIN role r ON r.id = ur.role_id
WHERE r.authority = 'ROLE_SUPER_ADMIN';

SELECT 'renew_courts (end year >= 2050)' AS check_name,
       COUNT(DISTINCT CONCAT(club_id, '-', court_number)) AS n
FROM rental_tamplate
WHERE is_active = 'Y' AND YEAR(end_effective_date) >= 2050;

SELECT 'stale_active_remaining (should be 0)' AS check_name,
       COUNT(*) AS n
FROM rental_tamplate
WHERE is_active = 'Y' AND end_effective_date < CURDATE();
