export function buildProvenanceView(event, { includeSourceRecord = true } = {}) {
  const provenance = event?.provenance || {};
  return Object.freeze({
    authority: provenance.authority || 'unknown',
    kind: provenance.kind || 'unknown',
    recordId: includeSourceRecord ? provenance.recordId || null : provenance.recordId ? '[redacted]' : null,
    sourceVersion: provenance.sourceVersion || null,
    sourceOccurredAt: provenance.sourceOccurredAt || null,
    committedAt: provenance.committedAt || event?.createdAt || null,
    classification: provenance.authority?.startsWith('tmrw-director') ? 'director-intervention'
      : provenance.authority === 'preview37-migration' ? 'migrated-canon'
        : provenance.authority === 'sillytavern-main-rp' ? 'main-rp-handoff'
          : provenance.authority?.startsWith('tmrw') ? 'tmrw-canon' : 'external-canon',
  });
}
