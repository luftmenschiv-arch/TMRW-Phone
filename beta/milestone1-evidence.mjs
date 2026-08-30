export function phase13Evidence({ browser = {}, remediation = {} } = {}) {
  const verified = (key, source) => ({ status: remediation[key] ? 'pass' : 'unverified', source: remediation[key] ? source : 'not verified in this run' });
  return Object.freeze({
    'migration-rollback': { status: 'pass', source: 'phase12 integration and rollback tests' },
    'exact-context-privacy': { status: 'pass', source: 'Phase 5/8/9/10/12 exact prompt and projection matrix' },
    'send-regenerate-swipe-edit-delete': verified('runtimeOperations', 'real installed SillyTavern eventSource integration test'),
    'dynamic-cast': { status: 'pass', source: '1/2/12 integrated fixtures' },
    'story-branch-isolation': { status: 'pass', source: 'integrated scope fixtures' },
    'text-calls': { status: 'pass', source: 'Phase 9 canonical Call tests' },
    'pocket-shadow': { status: 'pass', source: 'Phase 11 read-only shadow tests' },
    'preview-active-guard': { status: 'pass', source: 'isolated lifecycle and migration tests' },
    'single-pocket-injector': verified('pocketInjectorParity', 'installed Story Bridge injector execution plus v3 ownership guard'),
    'canonical-drafts-unsend-reactions-stickers': verified('messageExtras', 'Phase 13 canonical remediation suite'),
    'text-voicemail': verified('textVoicemail', 'Phase 13 canonical remediation suite'),
    'event-scoped-ai-jobs': verified('aiJobs', 'Phase 13 event-scoped job suite'),
    'real-sillytavern-authoring-integration': verified('runtimeIntegration', 'installed SillyTavern eventSource and extension API integration test'),
    'real-indexeddb': { status: browser.realIndexedDb && browser.executed ? 'pass' : 'unverified', source: browser.realIndexedDb && browser.executed ? 'Phase 13 browser harness' : 'not run' },
    'warm-open-under-budget': { status: browser.warmOpenPassed ? 'pass' : 'unverified', source: browser.warmOpenPassed ? 'Phase 13 browser harness' : 'not run or over budget' },
    'steady-interaction-under-50ms': { status: browser.steadyUnder50ms ? 'pass' : 'unverified', source: browser.steadyUnder50ms ? 'Phase 13 browser harness' : 'not run or over budget' },
    'repeated-session-heap-stability': { status: browser.heapStable ? 'pass' : 'unverified', source: browser.heapStable ? 'Phase 13 browser retained-heap run' : 'reliable retained-heap evidence unavailable' },
    'closed-idle-zero-work': { status: 'pass', source: 'lifecycle resource and static timer/poller tests' },
    'clean-and-migrated-fixtures': { status: 'pass', source: 'Phase 12 plus Phase 13 integrated fixture' },
  });
}
