SELECT currency, units, elapsed, decimal_sum(total_text) AS exact_total
FROM measure_totals
WHERE metric = ?
GROUP BY currency, units, elapsed
ORDER BY currency, units, elapsed;
