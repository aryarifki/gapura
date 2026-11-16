-- Read-only, repeatable snapshot. Run before validating historical scores.
-- Existing rows already store weighted points; never multiply by today's
-- weights, rescale, clip, or infer historical verdicts from today's threshold.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database() AS database_name, CURRENT_TIMESTAMP AS audited_at,
       MIN(id) AS min_id, MAX(id) AS max_id,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE score_total <> score_relevance::bigint + score_credibility
         + score_momentum + score_engagement + score_compliance) AS total_mismatch,
       COUNT(*) FILTER (WHERE score_total NOT BETWEEN 0 AND 100
         OR score_relevance NOT BETWEEN 0 AND 100 OR score_credibility NOT BETWEEN 0 AND 100
         OR score_momentum NOT BETWEEN 0 AND 100 OR score_engagement NOT BETWEEN 0 AND 100
         OR score_compliance NOT BETWEEN 0 AND 100) AS out_of_range,
       COUNT(*) FILTER (WHERE score_total IS NULL OR score_relevance IS NULL
         OR score_credibility IS NULL OR score_momentum IS NULL
         OR score_engagement IS NULL OR score_compliance IS NULL) AS missing_values
FROM topic_scores;

SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
FROM pg_constraint WHERE conrelid = 'topic_scores'::regclass ORDER BY conname;

SELECT model, prompt_version, verdict, COUNT(*) AS rows,
       MIN(score_total) AS min_total, MAX(score_total) AS max_total,
       COUNT(*) FILTER (WHERE score_total <> score_relevance::bigint + score_credibility
         + score_momentum + score_engagement + score_compliance) AS mismatches
FROM topic_scores GROUP BY model, prompt_version, verdict
ORDER BY model, prompt_version, verdict;

-- Explicit candidates for a separately reviewed old/new row mapping. Empty on
-- clean data. A mismatch alone does not establish which value is authoritative.
SELECT id, topic_id, score_relevance, score_credibility, score_momentum,
       score_engagement, score_compliance, score_total,
       score_relevance::bigint + score_credibility + score_momentum
         + score_engagement + score_compliance AS component_sum,
       verdict, model, prompt_version, reasoning
FROM topic_scores
WHERE score_total IS DISTINCT FROM score_relevance::bigint + score_credibility
        + score_momentum + score_engagement + score_compliance
   OR score_total NOT BETWEEN 0 AND 100
   OR score_relevance NOT BETWEEN 0 AND 100 OR score_credibility NOT BETWEEN 0 AND 100
   OR score_momentum NOT BETWEEN 0 AND 100 OR score_engagement NOT BETWEEN 0 AND 100
   OR score_compliance NOT BETWEEN 0 AND 100
ORDER BY id;

COMMIT;
