import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';

export const GUIDE_TOPICS = Object.freeze(['Start Here', 'My Phone vs Their Phones', 'Canon vs player-only access', 'Calls & Contacts', 'Phone Number Discovery', 'Phone Access modes', 'Privacy & Character Knowledge', 'Messages / Groups', 'Stickers', 'Notes & Clues', 'Director Mode / Promote to Canon / Undo', 'Voice & Calls', 'Troubleshooting']);
const guideId = (scope, playerInstanceId) => `phone-guide:${scope.storyId}:${scope.branchId}:${playerInstanceId}`;
export class GuideStateService {
  #unitOfWork; constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async get({ scope: inputScope, playerInstanceId }) { const scope = requireEventScope(inputScope); const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readonly({ stores: ['phoneGuideState'], scope }, async repositories => (await repositories.phoneGuideState.get(id)) || Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips: [], tutorialReplayCount: 0, guideStateIsCanon: false, phase: 7 })); }
  async resetTips({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: false }); }
  async replayTutorial({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: true }); }
  async #write({ scope, playerInstanceId, dismissedTips, replay }) { const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readwrite({ stores: ['phoneGuideState'], scope }, async repositories => { const old = await repositories.phoneGuideState.get(id); const row = Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips, tutorialReplayCount: (old?.tutorialReplayCount || 0) + (replay ? 1 : 0), guideStateIsCanon: false, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), phase: 7 }); await repositories.phoneGuideState.put(row); return row; }); }
}
