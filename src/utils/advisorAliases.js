// Some advisors appear under a different name on the dealer's uploaded reports
// than they do in our roster/users list. Map the REPORT name to the canonical
// roster first name so every report upload attributes the data to the right
// person.
//
// Keys are the name as PRINTED on reports; values are the roster first name.
// Matching is case-insensitive and uses the FIRST word of the name only.
//   e.g. advisor "Isaiah" is listed as "CAIDEN" on the dealer reports.
export const ADVISOR_REPORT_ALIASES = { CAIDEN: 'ISAIAH' };

// First word of a name, uppercased. '' for empty/blank.
export function firstNameUpper(name) {
  return String(name ?? '').trim().split(/\s+/)[0].toUpperCase();
}

// Report name -> canonical roster first name (applies the alias if one exists,
// otherwise returns the name's own first word). Always UPPERCASE.
export function canonicalAdvisorFirst(reportName) {
  const first = firstNameUpper(reportName);
  return ADVISOR_REPORT_ALIASES[first] || first;
}

// The report names (first word, UPPERCASE) that should be treated as this
// roster advisor: the roster name itself plus any aliases pointing at it.
// Used by matchers that scan a report FOR known roster names.
export function reportNamesForAdvisor(rosterName) {
  const first = firstNameUpper(rosterName);
  const aliases = Object.keys(ADVISOR_REPORT_ALIASES).filter(k => ADVISOR_REPORT_ALIASES[k] === first);
  return [first, ...aliases];
}
