import { setupPhase10, phase10Projectors } from '../phase10/handoff-fixtures.mjs';
import { createPhase14EventTypeRegistry } from '../../director/event-types.mjs';
import { createDirectorProjector } from '../../director/projector.mjs';
import { DirectorEventInspector } from '../../director/event-inspector.mjs';
import { DirectorCorrectionService } from '../../director/correction-service.mjs';
import { UndoCanonService } from '../../director/undo-canon.mjs';
import { DirectorUserLockService } from '../../director/user-locks.mjs';
import { DirectorAccessOverrideManager } from '../../director/access-override-manager.mjs';
import { PromoteToCanonService } from '../../director/promote-to-canon.mjs';
import { DirectorKnowledgeCorrection } from '../../director/knowledge-correction.mjs';
import { DirectorMappingEditor } from '../../director/mapping-editor.mjs';
import { DirectorConsole } from '../../director/console.mjs';
import { EventScopedAiJobService } from '../../application/ai-jobs/event-scoped-ai-job-service.mjs';

export function phase14Projectors() { return [...phase10Projectors(), createDirectorProjector()]; }
export async function setupPhase14(options = {}) {
  const context = await setupPhase10({ ...options, eventTypes: options.eventTypes || createPhase14EventTypeRegistry(), projectors: options.projectors || phase14Projectors() });
  const undo = new UndoCanonService({ database: context.database, eventEngine: context.engine });
  return {
    ...context,
    inspector: new DirectorEventInspector({ database: context.database }),
    corrections: new DirectorCorrectionService({ database: context.database, eventEngine: context.engine }),
    undo,
    locks: new DirectorUserLockService({ database: context.database, eventEngine: context.engine }),
    access: new DirectorAccessOverrideManager({ database: context.database }),
    promotions: new PromoteToCanonService({ database: context.database, eventEngine: context.engine }),
    knowledgeCorrections: new DirectorKnowledgeCorrection({ eventEngine: context.engine, undoCanon: undo }),
    mappings: new DirectorMappingEditor({ database: context.database, eventEngine: context.engine }),
    console: new DirectorConsole({ database: context.database, eventEngine: context.engine }),
    jobs: new EventScopedAiJobService({ database: context.database, eventEngine: context.engine, knowledgeService: context.knowledge }),
  };
}

export const directorAccess = actorId => ({ kind: 'director-tool', authorized: true, actorId });
