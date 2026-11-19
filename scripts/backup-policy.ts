export const backupPrefix = '_designx_backups/v1/';
export const backupRunPattern = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;
export function backupKey(run: string) {
  if (!backupRunPattern.test(run)) throw new Error('Invalid backup run ID');
  return `${backupPrefix}${run}/snapshot.tar.gz`;
}
/** Seven newest daily restore points plus one per week for four weeks. */
export function retainedBackups(runs: string[]) {
  const valid = [...new Set(runs.filter(run => backupRunPattern.test(run)))].sort().reverse();
  const keep = new Set<string>(), days = new Set<string>(), weeks = new Set<number>();
  for (const run of valid) {
    const day = run.slice(0, 8);
    const utc = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
    const week = Math.floor((utc / 86400000 + 3) / 7);
    if (!days.has(day) && days.size < 7) { keep.add(run); days.add(day); }
    if (!weeks.has(week) && weeks.size < 4) { keep.add(run); weeks.add(week); }
  }
  return keep;
}
export function restorePrefix(value: string) {
  if (!/^_designx_restore\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/$/.test(value)) throw new Error('Restore requires a fresh isolated _designx_restore/UUID/ prefix');
  return value;
}
