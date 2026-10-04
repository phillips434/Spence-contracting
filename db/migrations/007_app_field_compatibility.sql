-- Rebuild only these derived columns from the preserved app payload.
-- No documents, children, timestamps or legacy payloads are replaced.
UPDATE projects
SET po_number = coalesce(legacy_payload->>'poNum', legacy_payload->>'po', legacy_payload->>'poNumber')
WHERE po_number IS DISTINCT FROM coalesce(legacy_payload->>'poNum', legacy_payload->>'po', legacy_payload->>'poNumber');

WITH source AS (
  SELECT id, coalesce(legacy_payload->>'tax', legacy_payload->>'taxRate', '0') AS value
  FROM estimates
), numeric_source AS (
  SELECT id, CASE WHEN btrim(value) = '' THEN 0::numeric
    WHEN value ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN value::numeric
    ELSE NULL END AS value FROM source
)
UPDATE estimates e SET tax_rate = s.value
FROM numeric_source s
WHERE e.id = s.id AND s.value BETWEEN -99999.999 AND 99999.999
  AND e.tax_rate IS DISTINCT FROM s.value::numeric(8,3);
