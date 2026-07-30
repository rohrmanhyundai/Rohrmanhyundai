// Whether an employee has the Excel Training program (it's optional — not
// everyone is enrolled). An explicit `hasExcel` flag wins; otherwise infer from
// the value so existing "NA"/"—"/blank entries read as not-applicable without a
// data migration.
const NOT_APPLICABLE = new Set(['', '-', '—', 'NA', 'N/A', 'N/A.', 'NONE', 'N A']);

export function hasExcelTraining(emp) {
  if (!emp) return false;
  if (emp.hasExcel === true) return true;
  if (emp.hasExcel === false) return false;
  const v = String(emp.excel_training ?? emp.excel ?? '').trim().toUpperCase();
  return v !== '' && !NOT_APPLICABLE.has(v);
}
