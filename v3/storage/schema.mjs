export const V3_DATABASE_NAME = 'tmrw-phone-v3-beta';
export const V3_SCHEMA_ID = 'tmrw-phone-v3-schema';
export const V3_SCHEMA_VERSION = 21;
export const V3_BETA_SETTINGS_KEY = 'tmrw-phone-v3-beta-control-v1';
export const V3_RUNTIME_LEASE_KEY = 'runtime-lease';
export const V3_SCHEMA_METADATA_KEY = 'schema';

export const PREVIEW_MIGRATION_CURRENT_STORAGE = Object.freeze({
  FALSE: 0,
  TRUE: 1,
});

export function encodePreviewMigrationCurrentStorage(value) {
  if (value === true) return PREVIEW_MIGRATION_CURRENT_STORAGE.TRUE;
  if (value === false) return PREVIEW_MIGRATION_CURRENT_STORAGE.FALSE;
  throw new TypeError('Preview migration current semantic value must be boolean');
}

export function normalizePreviewMigrationCurrentStorage(value) {
  if (value === PREVIEW_MIGRATION_CURRENT_STORAGE.TRUE || value === PREVIEW_MIGRATION_CURRENT_STORAGE.FALSE) return value;
  return encodePreviewMigrationCurrentStorage(value);
}

export function decodePreviewMigrationCurrentStorage(value) {
  if (value === PREVIEW_MIGRATION_CURRENT_STORAGE.TRUE) return true;
  if (value === PREVIEW_MIGRATION_CURRENT_STORAGE.FALSE) return false;
  throw new TypeError('Preview migration current persisted value must be numeric 0 or 1');
}

export const LEGACY_PREVIEW_STORAGE = Object.freeze({
  indexedDbName: 'tmrw-phone-project-storage-v1',
  indexedDbVersion: 1,
  objectStore: 'project-db',
  recordKey: 'main',
  settingsKey: 'tmrw-phone-v1-settings',
  fallbackProjectKey: 'tmrw-phone-preview-project-db-v2',
});

const scopeIndexes = [
  { name: 'by_story_branch', keyPath: ['storyId', 'branchId'], unique: false },
  { name: 'by_story', keyPath: 'storyId', unique: false },
];

export const V3_STORE_DEFINITIONS = Object.freeze({
  metadata: { keyPath: 'key', indexes: [] },
  migrations: { keyPath: 'id', indexes: [{ name: 'by_status', keyPath: 'status', unique: false }] },
  characterCards: { keyPath: 'id', indexes: [{ name: 'by_source_card', keyPath: ['sourceAuthority', 'sourceCardId'], unique: true }] },
  characterCardActors: { keyPath: 'id', indexes: [{ name: 'by_card_status', keyPath: ['cardId', 'status'], unique: false }, { name: 'by_card_actor', keyPath: ['cardId', 'actorId'], unique: true }] },
  actors: { keyPath: 'id', indexes: [{ name: 'by_control_key', keyPath: ['control', 'controlKey'], unique: true }, { name: 'by_source_actor', keyPath: ['sourceAuthority', 'sourceActorId'], unique: true }] },
  instances: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_actor_story', keyPath: ['actorId', 'storyId'], unique: false }, { name: 'by_actor_scope', keyPath: ['actorId', 'storyId', 'branchId'], unique: true }] },
  stories: { keyPath: 'id', indexes: [{ name: 'by_source_story', keyPath: ['sourceAuthority', 'sourceStoryId'], unique: true }, { name: 'by_character_card', keyPath: 'characterCardId', unique: false }] },
  branches: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_story_parent', keyPath: ['storyId', 'parentBranchId'], unique: false }, { name: 'by_story_route', keyPath: ['storyId', 'sourceAuthority', 'sourceRouteId'], unique: true }] },
  devices: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_owner_scope', keyPath: ['storyId', 'branchId', 'ownerInstanceId'], unique: false }, { name: 'by_owner_device_key', keyPath: ['storyId', 'branchId', 'ownerInstanceId', 'deviceKey'], unique: true }] },
  accounts: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_owner_scope', keyPath: ['storyId', 'branchId', 'ownerInstanceId'], unique: false }, { name: 'by_owner_account_key', keyPath: ['storyId', 'branchId', 'ownerInstanceId', 'accountKey'], unique: true }] },
  identityMappings: { keyPath: 'id', indexes: [{ name: 'by_source_identity', keyPath: ['sourceAuthority', 'sourceType', 'sourceId', 'scopeKey'], unique: true }, { name: 'by_canonical_identity', keyPath: ['canonicalType', 'canonicalId'], unique: false }, { name: 'by_mapping_status', keyPath: 'status', unique: false }] },
  identityBatches: { keyPath: 'id', indexes: [{ name: 'by_manifest', keyPath: 'manifestId', unique: true }, { name: 'by_batch_status', keyPath: 'status', unique: false }] },
  events: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_sequence', keyPath: ['storyId', 'branchId', 'sequence'], unique: true },
    { name: 'by_scope_commit_sequence', keyPath: ['storyId', 'branchId', 'lastCommitSequence'], unique: true },
    { name: 'by_scope_type_sequence', keyPath: ['storyId', 'branchId', 'eventType', 'sequence'], unique: false },
    { name: 'by_scope_status_sequence', keyPath: ['storyId', 'branchId', 'status', 'sequence'], unique: false },
    { name: 'by_source_event', keyPath: ['sourceAuthority', 'sourceRecordId', 'storyId', 'branchId'], unique: true },
  ] },
  eventRevisions: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_event', keyPath: ['storyId', 'branchId', 'eventId'], unique: false },
    { name: 'by_event_revision', keyPath: ['storyId', 'branchId', 'eventId', 'revision'], unique: true },
    { name: 'by_scope_commit_sequence', keyPath: ['storyId', 'branchId', 'commitSequence'], unique: true },
  ] },
  eventCausalEdges: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_cause', keyPath: ['storyId', 'branchId', 'causeEventId'], unique: false },
    { name: 'by_scope_effect', keyPath: ['storyId', 'branchId', 'effectEventId'], unique: false },
    { name: 'by_causal_relation', keyPath: ['storyId', 'branchId', 'causeEventId', 'effectEventId', 'relation'], unique: true },
  ] },
  eventIdempotency: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_producer_key', keyPath: ['storyId', 'branchId', 'producer', 'idempotencyKey'], unique: true },
  ] },
  eventSequences: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope', keyPath: ['storyId', 'branchId'], unique: true }] },
  projections: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_kind_key', keyPath: ['storyId', 'branchId', 'kind', 'projectionKey'], unique: true },
    { name: 'by_scope_event_projector', keyPath: ['storyId', 'branchId', 'sourceEventId', 'projectorId'], unique: false },
    { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceEventId'], unique: false },
    { name: 'by_scope_projector', keyPath: ['storyId', 'branchId', 'projectorId'], unique: false },
    { name: 'by_scope_projector_sequence', keyPath: ['storyId', 'branchId', 'projectorId', 'sourceEventSequence'], unique: false },
    { name: 'by_scope_projector_group_sequence', keyPath: ['storyId', 'branchId', 'projectorId', 'groupKey', 'sourceEventSequence'], unique: false },
  ] },
  projectionCheckpoints: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_projector', keyPath: ['storyId', 'branchId', 'projectorId'], unique: true }] },
  clockCheckpoints: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_kind', keyPath: ['storyId', 'branchId', 'kind'], unique: false },
    { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceEventId'], unique: true },
    { name: 'by_scope_ordinal', keyPath: ['storyId', 'branchId', 'sourceEventSequence'], unique: true },
  ] },
  pendingWorldEvents: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_pending', keyPath: ['storyId', 'branchId', 'pendingId'], unique: true },
    { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false },
    { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceCreateEventId'], unique: false },
  ] },
  activitySessions: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_session', keyPath: ['storyId', 'branchId', 'sessionId'], unique: true },
    { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false },
  ] },
  knowledgeClaims: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_claim', keyPath: ['storyId', 'branchId', 'claimId'], unique: true },
    { name: 'by_scope_subject', keyPath: ['storyId', 'branchId', 'subjectKind', 'subjectId'], unique: false },
    { name: 'by_scope_effective_status', keyPath: ['storyId', 'branchId', 'effectiveStatus'], unique: false },
  ] },
  audiencePolicies: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_policy', keyPath: ['storyId', 'branchId', 'policyId'], unique: true },
    { name: 'by_scope_kind', keyPath: ['storyId', 'branchId', 'kind'], unique: false },
  ] },
  evidenceFragments: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_fragment', keyPath: ['storyId', 'branchId', 'fragmentId'], unique: true },
    { name: 'by_scope_claim', keyPath: ['storyId', 'branchId', 'claimId'], unique: false },
  ] },
  knowledgeGrants: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_grant', keyPath: ['storyId', 'branchId', 'grantId'], unique: true },
    { name: 'by_scope_instance_status', keyPath: ['storyId', 'branchId', 'targetInstanceId', 'status'], unique: false },
    { name: 'by_scope_instance_active_recent', keyPath: ['storyId', 'branchId', 'targetInstanceId', 'status', 'reverseOrdinal'], unique: false },
    { name: 'by_scope_instance_claim_status', keyPath: ['storyId', 'branchId', 'targetInstanceId', 'claimId', 'status'], unique: false },
    { name: 'by_scope_claim_status', keyPath: ['storyId', 'branchId', 'claimId', 'status'], unique: false },
    { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceDisclosureEventId'], unique: false },
  ] },
  phoneStates: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: true },
    { name: 'by_scope_owner_instance', keyPath: ['storyId', 'branchId', 'deviceOwnerInstanceId'], unique: false },
    { name: 'by_scope_holder_instance', keyPath: ['storyId', 'branchId', 'currentHolderInstanceId'], unique: false },
  ] },
  accountSessions: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'accountId'], unique: true },
    { name: 'by_scope_owner_instance', keyPath: ['storyId', 'branchId', 'accountOwnerInstanceId'], unique: false },
    { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false },
  ] },
  phonePlayerAccessOverrides: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_device_action', keyPath: ['storyId', 'branchId', 'deviceId', 'action'], unique: true },
    { name: 'by_scope_player_instance', keyPath: ['storyId', 'branchId', 'playerInstanceId'], unique: false },
  ] },
  phoneNumbers: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account_number', keyPath: ['storyId', 'branchId', 'viewerAccountId', 'normalizedNumber'], unique: true },
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'viewerAccountId'], unique: false },
  ] },
  contactPoints: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'ownerAccountId'], unique: false },
    { name: 'by_scope_account_number', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'phoneNumberId'], unique: true },
  ] },
  contactLinks: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'ownerAccountId'], unique: false },
    { name: 'by_scope_account_number', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'phoneNumberId'], unique: true },
    { name: 'by_scope_target_instance', keyPath: ['storyId', 'branchId', 'targetInstanceId'], unique: false },
  ] },
  phoneUiPreferences: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_player_instance', keyPath: ['storyId', 'branchId', 'playerInstanceId'], unique: true },
  ] },
  phoneGuideState: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_player_instance', keyPath: ['storyId', 'branchId', 'playerInstanceId'], unique: true },
  ] },
  phoneGalleryItems: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneFiles: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneNotes: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneSearchEntries: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneLocations: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneCalendarItems: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneWalletEntries: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneShopItems: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneShopOrders: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneWeatherEntries: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  phoneHealthEntries: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false }, { name: 'by_scope_device_reverse', keyPath: ['storyId', 'branchId', 'deviceId', 'reverseSequence'], unique: true }] },
  threads: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_thread', keyPath: ['storyId', 'branchId', 'threadId'], unique: true },
    { name: 'by_scope_kind', keyPath: ['storyId', 'branchId', 'kind'], unique: false },
  ] },
  threadMembershipSnapshots: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_snapshot', keyPath: ['storyId', 'branchId', 'snapshotId'], unique: true },
    { name: 'by_scope_thread_sequence', keyPath: ['storyId', 'branchId', 'threadId', 'sourceEventSequence'], unique: true },
  ] },
  threadParticipants: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'accountId'], unique: false },
    { name: 'by_scope_thread_account', keyPath: ['storyId', 'branchId', 'threadId', 'accountId'], unique: true },
  ] },
  messages: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_message', keyPath: ['storyId', 'branchId', 'messageId'], unique: true },
    { name: 'by_scope_thread_sequence', keyPath: ['storyId', 'branchId', 'threadId', 'sourceEventSequence'], unique: true },
    { name: 'by_scope_thread_reverse_sequence', keyPath: ['storyId', 'branchId', 'threadId', 'reverseSequence'], unique: true },
    { name: 'by_scope_thread_message', keyPath: ['storyId', 'branchId', 'threadId', 'messageId'], unique: true },
  ] },
  messageRecipients: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_thread_account_reverse_sequence', keyPath: ['storyId', 'branchId', 'threadId', 'recipientAccountId', 'reverseSequence'], unique: true },
    { name: 'by_scope_message_account', keyPath: ['storyId', 'branchId', 'messageId', 'recipientAccountId'], unique: true },
  ] },
  messageDrafts: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account_thread', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'threadId'], unique: true },
    { name: 'by_scope_device', keyPath: ['storyId', 'branchId', 'deviceId'], unique: false },
  ] },
  messageReactions: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_message', keyPath: ['storyId', 'branchId', 'messageId'], unique: false },
    { name: 'by_scope_message_account', keyPath: ['storyId', 'branchId', 'messageId', 'reactorAccountId'], unique: true },
  ] },
  stickerOwnerships: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'ownerAccountId'], unique: false },
    { name: 'by_scope_account_asset', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'stickerAssetId'], unique: true },
  ] },
  callSessions: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_session', keyPath: ['storyId', 'branchId', 'callSessionId'], unique: true },
    { name: 'by_scope_state', keyPath: ['storyId', 'branchId', 'state'], unique: false },
    { name: 'by_scope_reverse_sequence', keyPath: ['storyId', 'branchId', 'reverseSequence'], unique: true },
  ] },
  callParticipants: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'accountId'], unique: false },
    { name: 'by_scope_session_account', keyPath: ['storyId', 'branchId', 'callSessionId', 'accountId'], unique: true },
  ] },
  callTranscripts: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_transcript', keyPath: ['storyId', 'branchId', 'transcriptEntryId'], unique: true },
    { name: 'by_scope_session_sequence', keyPath: ['storyId', 'branchId', 'callSessionId', 'sourceEventSequence'], unique: true },
    { name: 'by_scope_session_reverse_sequence', keyPath: ['storyId', 'branchId', 'callSessionId', 'reverseSequence'], unique: true },
  ] },
  callTranscriptRecipients: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_session_account_reverse_sequence', keyPath: ['storyId', 'branchId', 'callSessionId', 'recipientAccountId', 'reverseSequence'], unique: true },
    { name: 'by_scope_transcript_account', keyPath: ['storyId', 'branchId', 'transcriptEntryId', 'recipientAccountId'], unique: true },
  ] },
  callVoicemails: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_voicemail', keyPath: ['storyId', 'branchId', 'voicemailId'], unique: true },
    { name: 'by_scope_session_sequence', keyPath: ['storyId', 'branchId', 'callSessionId', 'sourceEventSequence'], unique: true },
    { name: 'by_scope_recipient_reverse_sequence', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'reverseSequence'], unique: true },
    { name: 'by_scope_caller_reverse_sequence', keyPath: ['storyId', 'branchId', 'callerAccountId', 'reverseSequence'], unique: true },
  ] },
  voiceActorProfiles: { keyPath: 'id', indexes: [
    { name: 'by_actor', keyPath: 'actorId', unique: true },
    { name: 'by_language', keyPath: 'language', unique: false },
    { name: 'by_user_lock', keyPath: 'lockedByUser', unique: false },
  ] },
  voiceInstanceOverrides: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_instance', keyPath: ['storyId', 'branchId', 'instanceId'], unique: true },
    { name: 'by_scope_actor', keyPath: ['storyId', 'branchId', 'actorId'], unique: false },
  ] },
  voiceAudioArtifacts: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_call', keyPath: ['storyId', 'branchId', 'callSessionId'], unique: false },
    { name: 'by_scope_retention', keyPath: ['storyId', 'branchId', 'retention'], unique: false },
    { name: 'by_scope_instance', keyPath: ['storyId', 'branchId', 'instanceId'], unique: false },
  ] },
  handoffProposals: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_proposal', keyPath: ['storyId', 'branchId', 'proposalId'], unique: true },
    { name: 'by_scope_source_version', keyPath: ['storyId', 'branchId', 'sourceAuthority', 'sourceMessageId', 'sourceVersionId'], unique: false },
    { name: 'by_scope_source_message', keyPath: ['storyId', 'branchId', 'sourceAuthority', 'sourceMessageId'], unique: false },
    { name: 'by_scope_source_lineage', keyPath: ['storyId', 'branchId', 'sourceAuthority', 'sourceMessageId', 'actionKey'], unique: true },
    { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false },
  ] },
  handoffLinks: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_source_lineage', keyPath: ['storyId', 'branchId', 'sourceAuthority', 'sourceMessageId', 'actionKey'], unique: true },
    { name: 'by_scope_source_message', keyPath: ['storyId', 'branchId', 'sourceAuthority', 'sourceMessageId'], unique: false },
    { name: 'by_scope_event', keyPath: ['storyId', 'branchId', 'canonicalEventId'], unique: true },
  ] },
  handoffSourceCursors: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_source', keyPath: ['storyId', 'branchId', 'sourceAuthority'], unique: true },
  ] },
  pocketShadowCapabilities: { keyPath: 'id', indexes: [
    { name: 'by_source', keyPath: 'sourceAuthority', unique: true },
    { name: 'by_status', keyPath: 'status', unique: false },
  ] },
  pocketShadowMappings: { keyPath: 'id', indexes: [
    { name: 'by_source_identity', keyPath: ['sourceAuthority', 'sourceType', 'sourceId'], unique: true },
    { name: 'by_scope', keyPath: ['storyId', 'branchId'], unique: false },
    { name: 'by_status', keyPath: 'status', unique: false },
  ] },
  pocketShadowCursors: { keyPath: 'id', indexes: [
    { name: 'by_source', keyPath: 'sourceAuthority', unique: true },
  ] },
  pocketShadowObservations: { keyPath: 'id', indexes: [
    { name: 'by_source_observation', keyPath: ['sourceAuthority', 'observationId'], unique: true },
    { name: 'by_source', keyPath: 'sourceAuthority', unique: false },
    { name: 'by_source_type', keyPath: ['sourceAuthority', 'observationType'], unique: false },
    { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'matchState'], unique: false },
    { name: 'by_source_current', keyPath: ['sourceAuthority', 'current'], unique: false },
  ] },
  pocketShadowQuarantine: { keyPath: 'id', indexes: [
    { name: 'by_source_observation', keyPath: ['sourceAuthority', 'observationId'], unique: true },
    { name: 'by_source_reason', keyPath: ['sourceAuthority', 'reasonCode'], unique: false },
    { name: 'by_current', keyPath: 'current', unique: false },
  ] },
  pocketShadowParity: { keyPath: 'id', indexes: [
    { name: 'by_source_observation', keyPath: ['sourceAuthority', 'observationId'], unique: true },
    { name: 'by_source', keyPath: 'sourceAuthority', unique: false },
    { name: 'by_comparison', keyPath: 'comparison', unique: false },
  ] },
  pocketCallFingerprints: { keyPath: 'id', indexes: [
    { name: 'by_source_fingerprint', keyPath: ['sourceAuthority', 'fingerprint'], unique: true },
    { name: 'by_source', keyPath: 'sourceAuthority', unique: false },
    { name: 'by_route', keyPath: ['sourceAuthority', 'routeKey'], unique: false },
  ] },
  previewMigrationBatches: { keyPath: 'id', indexes: [
    { name: 'by_source_fingerprint', keyPath: ['sourceAuthority', 'migrationVersion', 'sourceFingerprint'], unique: true },
    { name: 'by_status', keyPath: 'status', unique: false },
  ] },
  previewMigrationItems: { keyPath: 'id', indexes: [
    { name: 'by_batch_status', keyPath: ['batchId', 'status'], unique: false },
    { name: 'by_source_record', keyPath: ['sourceAuthority', 'sourceRecordId', 'sourceFingerprint'], unique: false },
    { name: 'by_source_current', keyPath: ['sourceAuthority', 'sourceRecordId', 'current'], unique: false },
  ] },
  previewMigrationMappings: { keyPath: 'id', indexes: [
    { name: 'by_batch_source', keyPath: ['batchId', 'sourceType', 'sourceId'], unique: true },
    { name: 'by_batch_scope', keyPath: ['batchId', 'sourceScopeKey'], unique: false },
  ] },
  previewMigrationQuarantine: { keyPath: 'id', indexes: [
    { name: 'by_batch_state', keyPath: ['batchId', 'state'], unique: false },
    { name: 'by_batch_reason', keyPath: ['batchId', 'reasonCode'], unique: false },
  ] },
  previewMigrationImports: { keyPath: 'id', indexes: [
    { name: 'by_event', keyPath: 'canonicalEventId', unique: true },
    { name: 'by_batch_status', keyPath: ['batchId', 'status'], unique: false },
    { name: 'by_source_record', keyPath: ['sourceAuthority', 'sourceRecordId', 'operationKey'], unique: true },
  ] },
  previewMigrationActivation: { keyPath: 'id', indexes: [
    { name: 'by_source', keyPath: 'sourceAuthority', unique: true },
  ] },
  sourceMappings: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_source_record', keyPath: ['source', 'sourceRecordId'], unique: true }] },
  sourceCursors: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_source', keyPath: ['storyId', 'branchId', 'source'], unique: true }] },
  jobs: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false }, { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceEventId'], unique: false }, { name: 'by_scope_source_type_target', keyPath: ['storyId', 'branchId', 'sourceEventId', 'jobType', 'targetInstanceId'], unique: true }] },
  directorAudits: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_target', keyPath: ['storyId', 'branchId', 'targetEventId'], unique: false }, { name: 'by_scope_sequence', keyPath: ['storyId', 'branchId', 'sourceEventSequence'], unique: true }, { name: 'by_scope_action', keyPath: ['storyId', 'branchId', 'action'], unique: false }] },
  directorDependencyPreviews: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_target_revision', keyPath: ['storyId', 'branchId', 'targetEventId', 'targetRevision'], unique: true }, { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false }] },
  directorRetractionBatches: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_root', keyPath: ['storyId', 'branchId', 'rootEventId'], unique: false }, { name: 'by_scope_correction', keyPath: ['storyId', 'branchId', 'correctionEventId'], unique: true }] },
  directorUserLocks: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_target_field', keyPath: ['storyId', 'branchId', 'targetKind', 'targetId', 'field'], unique: true }, { name: 'by_scope_target', keyPath: ['storyId', 'branchId', 'targetKind', 'targetId'], unique: false }] },
  directorPromotionProposals: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_proposal', keyPath: ['storyId', 'branchId', 'proposalId'], unique: true }, { name: 'by_scope_status', keyPath: ['storyId', 'branchId', 'status'], unique: false }, { name: 'by_scope_override', keyPath: ['storyId', 'branchId', 'overrideId'], unique: false }] },
  directorScopeMoves: { keyPath: 'id', indexes: [{ name: 'by_source_event', keyPath: ['sourceStoryId', 'sourceBranchId', 'sourceEventId'], unique: true }, { name: 'by_destination_event', keyPath: ['destinationStoryId', 'destinationBranchId', 'destinationEventId'], unique: true }, { name: 'by_status', keyPath: 'status', unique: false }] },
  socialPersonas: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_persona_key', keyPath: ['storyId', 'branchId', 'personaKey'], unique: true }, { name: 'by_scope_actor', keyPath: ['storyId', 'branchId', 'actorId'], unique: false }, { name: 'by_scope_account', keyPath: ['storyId', 'branchId', 'accountId'], unique: false }] },
  socialGraphEdges: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_owner_relation', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'relation', 'activeState'], unique: false }, { name: 'by_scope_owner_target_relation', keyPath: ['storyId', 'branchId', 'ownerAccountId', 'targetAccountId', 'relation'], unique: true }, { name: 'by_scope_target_relation', keyPath: ['storyId', 'branchId', 'targetAccountId', 'relation', 'activeState'], unique: false }] },
  socialPosts: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_post', keyPath: ['storyId', 'branchId', 'postId'], unique: true }, { name: 'by_scope_current_reverse_sequence', keyPath: ['storyId', 'branchId', 'currentState', 'reverseSequence'], unique: true }, { name: 'by_scope_audience_reverse_sequence', keyPath: ['storyId', 'branchId', 'audienceKind', 'currentState', 'reverseSequence'], unique: false }, { name: 'by_scope_author_reverse_sequence', keyPath: ['storyId', 'branchId', 'authorAccountId', 'currentState', 'reverseSequence'], unique: true }] },
  socialPostRecipients: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_account_reverse_sequence', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'reverseSequence'], unique: true }, { name: 'by_scope_post_account', keyPath: ['storyId', 'branchId', 'postId', 'recipientAccountId'], unique: true }] },
  socialComments: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_comment', keyPath: ['storyId', 'branchId', 'commentId'], unique: true }, { name: 'by_scope_post_parent_sequence', keyPath: ['storyId', 'branchId', 'postId', 'parentKey', 'sourceEventSequence'], unique: true }, { name: 'by_scope_post_sequence', keyPath: ['storyId', 'branchId', 'postId', 'sourceEventSequence'], unique: true }] },
  socialEngagements: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_target_kind', keyPath: ['storyId', 'branchId', 'targetId', 'kind', 'activeState'], unique: false }, { name: 'by_scope_target_account_kind', keyPath: ['storyId', 'branchId', 'targetId', 'actorAccountId', 'kind'], unique: true }] },
  socialDecisions: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_trigger_actor', keyPath: ['storyId', 'branchId', 'triggerEventId', 'actorInstanceId'], unique: true }, { name: 'by_scope_outcome', keyPath: ['storyId', 'branchId', 'outcome'], unique: false }] },
  socialAssets: { keyPath: 'id', indexes: [{ name: 'by_provider_asset', keyPath: ['providerId', 'providerAssetId'], unique: true }, { name: 'by_cache_key', keyPath: 'cacheKey', unique: true }, { name: 'by_status', keyPath: 'status', unique: false }] },
  liveSessions: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_session', keyPath: ['storyId', 'branchId', 'sessionId'], unique: true }, { name: 'by_scope_status_reverse_sequence', keyPath: ['storyId', 'branchId', 'status', 'reverseSequence'], unique: true }, { name: 'by_scope_audience_reverse_sequence', keyPath: ['storyId', 'branchId', 'audienceKind', 'reverseSequence'], unique: false }, { name: 'by_scope_host_reverse_sequence', keyPath: ['storyId', 'branchId', 'hostAccountId', 'reverseSequence'], unique: true }] },
  liveSessionRecipients: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_account_reverse_sequence', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'reverseSequence'], unique: true }, { name: 'by_scope_session_account', keyPath: ['storyId', 'branchId', 'sessionId', 'recipientAccountId'], unique: true }] },
  liveViewers: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_session_active_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'activeState', 'sourceEventSequence'], unique: true }, { name: 'by_scope_session_account', keyPath: ['storyId', 'branchId', 'sessionId', 'viewerAccountId'], unique: true }] },
  liveViewerPersonas: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_session_account', keyPath: ['storyId', 'branchId', 'sessionId', 'viewerAccountId'], unique: true }, { name: 'by_scope_viewer_type', keyPath: ['storyId', 'branchId', 'viewerType'], unique: false }] },
  liveMessages: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_message', keyPath: ['storyId', 'branchId', 'messageId'], unique: true }, { name: 'by_scope_session_parent_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'parentKey', 'sourceEventSequence'], unique: true }, { name: 'by_scope_session_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'sourceEventSequence'], unique: true }, { name: 'by_scope_session_reverse_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'reverseSequence'], unique: true }] },
  liveReactions: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_session_kind_active_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'kind', 'activeState', 'sourceEventSequence'], unique: true }, { name: 'by_scope_session_account_kind', keyPath: ['storyId', 'branchId', 'sessionId', 'actorAccountId', 'kind'], unique: true }] },
  liveArchiveSegments: { keyPath: 'id', indexes: [...scopeIndexes, { name: 'by_scope_session_segment', keyPath: ['storyId', 'branchId', 'sessionId', 'segmentNumber'], unique: true }, { name: 'by_scope_session_sequence', keyPath: ['storyId', 'branchId', 'sessionId', 'startSequence'], unique: true }] },
  notificationProjections: { keyPath: 'id', indexes: [
    ...scopeIndexes,
    { name: 'by_scope_notification', keyPath: ['storyId', 'branchId', 'notificationId'], unique: true },
    { name: 'by_scope_source_account_device', keyPath: ['storyId', 'branchId', 'sourceEventId', 'recipientAccountId', 'recipientDeviceId'], unique: false },
    { name: 'by_scope_source_event', keyPath: ['storyId', 'branchId', 'sourceEventId'], unique: false },
    { name: 'by_scope_logical_group', keyPath: ['storyId', 'branchId', 'logicalGroup'], unique: false },
    { name: 'by_scope_account_visible_reverse', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'visibleState', 'reverseSequence', 'notificationId'], unique: true },
    { name: 'by_scope_device_visible_reverse', keyPath: ['storyId', 'branchId', 'recipientDeviceId', 'visibleState', 'reverseSequence', 'notificationId'], unique: true },
    { name: 'by_scope_account_read_reverse', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'readState', 'reverseSequence', 'notificationId'], unique: true },
    { name: 'by_scope_account_app_read', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'appId', 'readState'], unique: false },
    { name: 'by_scope_device_app_read', keyPath: ['storyId', 'branchId', 'recipientDeviceId', 'appId', 'readState'], unique: false },
    { name: 'by_scope_group_reverse', keyPath: ['storyId', 'branchId', 'recipientAccountId', 'groupingKey', 'reverseSequence'], unique: false },
  ] },
  quarantine: { keyPath: 'id', indexes: [{ name: 'by_source_status', keyPath: ['source', 'status'], unique: false }] },
});

export const V3_STORE_NAMES = Object.freeze(Object.keys(V3_STORE_DEFINITIONS));

export const SCOPED_V3_STORES = Object.freeze(new Set([
  'instances',
  'branches',
  'devices',
  'accounts',
  'events',
  'eventRevisions',
  'eventCausalEdges',
  'eventIdempotency',
  'eventSequences',
  'projections',
  'projectionCheckpoints',
  'clockCheckpoints',
  'pendingWorldEvents',
  'activitySessions',
  'knowledgeClaims',
  'audiencePolicies',
  'evidenceFragments',
  'knowledgeGrants',
  'phoneStates',
  'accountSessions',
  'phonePlayerAccessOverrides',
  'phoneNumbers',
  'contactPoints',
  'contactLinks',
  'phoneUiPreferences',
  'phoneGuideState',
  'phoneGalleryItems',
  'phoneFiles',
  'phoneNotes',
  'phoneSearchEntries',
  'phoneLocations',
  'phoneCalendarItems',
  'phoneWalletEntries',
  'phoneShopItems',
  'phoneShopOrders',
  'phoneWeatherEntries',
  'phoneHealthEntries',
  'threads',
  'threadMembershipSnapshots',
  'threadParticipants',
  'messages',
  'messageRecipients',
  'messageDrafts',
  'messageReactions',
  'stickerOwnerships',
  'callSessions',
  'callParticipants',
  'callTranscripts',
  'callTranscriptRecipients',
  'callVoicemails',
  'voiceInstanceOverrides',
  'voiceAudioArtifacts',
  'handoffProposals',
  'handoffLinks',
  'handoffSourceCursors',
  'sourceMappings',
  'sourceCursors',
  'jobs',
  'directorAudits',
  'directorDependencyPreviews',
  'directorRetractionBatches',
  'directorUserLocks',
  'directorPromotionProposals',
  'socialPersonas',
  'socialGraphEdges',
  'socialPosts',
  'socialPostRecipients',
  'socialComments',
  'socialEngagements',
  'socialDecisions',
  'liveSessions',
  'liveSessionRecipients',
  'liveViewers',
  'liveViewerPersonas',
  'liveMessages',
  'liveReactions',
  'liveArchiveSegments',
  'notificationProjections',
]));

export function schemaMetadata(now = new Date().toISOString()) {
  return Object.freeze({
    key: V3_SCHEMA_METADATA_KEY,
    schemaId: V3_SCHEMA_ID,
    schemaVersion: V3_SCHEMA_VERSION,
    databaseName: V3_DATABASE_NAME,
    createdAt: now,
    updatedAt: now,
    phase: 23,
    domainBehaviorEnabled: false,
    canonicalEventFoundationEnabled: true,
    storyClockFoundationEnabled: true,
    pendingWorldEventFoundationEnabled: true,
    knowledgeAudienceFoundationEnabled: true,
    safePromptAccessEnabled: true,
    phoneStateFoundationEnabled: true,
    phoneShellFoundationEnabled: true,
    contactsFoundationEnabled: true,
    messagingFoundationEnabled: true,
    textCallFoundationEnabled: true,
    narrativePhoneHandoffEnabled: true,
    pocketShadowEnabled: true,
    previewCopyMigrationEnabled: true,
    milestone1GateRemediationEnabled: true,
    directorModeFoundationEnabled: true,
    socialProjectionFoundationEnabled: true,
    autonomousSocialGenerationEnabled: false,
    liveProjectionFoundationEnabled: true,
    autonomousLiveGenerationEnabled: false,
    notificationProjectionFoundationEnabled: true,
    autonomousNotificationGenerationEnabled: false,
    phoneWorldUtilityProjectionFoundationEnabled: true,
    voiceProfileFoundationEnabled: true,
    voiceAudioArtifactFoundationEnabled: true,
    voiceRuntimeIntegrated: false,
    voiceModelAccessEnabled: false,
    legacyMigrationStatus: 'controlled-copy-only',
  });
}

export function assertExactV3DatabaseName(name) {
  if (name !== V3_DATABASE_NAME) {
    throw new Error(`Refusing storage operation for unexpected database: ${String(name)}`);
  }
}
