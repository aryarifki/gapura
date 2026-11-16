-- P2: validate history only after reviewing the read-only score audit and any
-- explicit old/new mappings. This migration never changes scoring evidence,
-- verdicts, topic status, prompt versions, weights, or editorial approvals.
-- Requires 20261116_source_integrity.sql. Safe to run more than once.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE invalid_rows bigint;
BEGIN
  SELECT COUNT(*) INTO invalid_rows FROM topic_scores
  WHERE score_total IS DISTINCT FROM score_relevance::bigint + score_credibility
          + score_momentum + score_engagement + score_compliance
     OR score_total NOT BETWEEN 0 AND 100
     OR score_relevance NOT BETWEEN 0 AND 100 OR score_credibility NOT BETWEEN 0 AND 100
     OR score_momentum NOT BETWEEN 0 AND 100 OR score_engagement NOT BETWEEN 0 AND 100
     OR score_compliance NOT BETWEEN 0 AND 100;
  IF invalid_rows > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('topic_scores: %s invalid historical row(s); audit and explicit row mapping required before VALIDATE', invalid_rows);
  END IF;
END $$;

ALTER TABLE topic_scores VALIDATE CONSTRAINT topic_scores_component_total;
COMMIT;
