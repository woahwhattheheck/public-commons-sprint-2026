SELECT project_key, period_key, series, currency, units, elapsed,
       material_resource_entity_id, total_text,
       value_rows, null_rows, not_applicable_rows, error_rows
FROM timephased_totals
WHERE series = ?
ORDER BY project_key, period_key, currency, units, material_resource_entity_id;
