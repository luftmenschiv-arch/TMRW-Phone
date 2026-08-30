export function dryRunLegacyPhoneMappings({ scope, legacyRecords = [], deviceCandidates = [], accountCandidates = [] }) {
  const deviceByLegacy = new Map(deviceCandidates.map(row => [row.legacyDeviceId, row.deviceId]));
  const accountByLegacy = new Map(accountCandidates.map(row => [row.legacyAccountId, row.accountId]));
  const mappings = []; const quarantined = [];
  for (const record of legacyRecords) {
    const deviceId = deviceByLegacy.get(record.legacyDeviceId); const accountId = record.legacyAccountId ? accountByLegacy.get(record.legacyAccountId) : null;
    if (!deviceId || (record.legacyAccountId && !accountId)) { quarantined.push(Object.freeze({ legacyRecordId: record.id, reason: 'unresolved-explicit-identity-mapping' })); continue; }
    mappings.push(Object.freeze({ legacyRecordId: record.id, storyId: scope.storyId, branchId: scope.branchId, deviceId, accountId, operation: 'copy-read-only-candidate' }));
  }
  return Object.freeze({ writesLegacyData: false, writesV3Data: false, mappings: Object.freeze(mappings), quarantined: Object.freeze(quarantined) });
}
