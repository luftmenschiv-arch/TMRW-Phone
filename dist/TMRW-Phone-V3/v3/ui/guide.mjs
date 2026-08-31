import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';

export const GUIDE_TOPICS = Object.freeze(['Start Here', 'My Phone vs Their Phones', 'Canon vs player-only access', 'Calls & Contacts', 'Phone Number Discovery', 'Phone Access modes', 'Privacy & Character Knowledge', 'Messages / Groups', 'Stickers', 'Notes & Clues', 'Director Mode / Promote to Canon / Undo', 'Voice & Calls', 'Troubleshooting']);
export const GUIDE_TOPIC_CONTENT = Object.freeze({
  'Start Here': 'Use My Phone for the player device. Their Phones remain separate perspectives and require the access granted by the current Story/Branch.',
  'My Phone vs Their Phones': 'My Phone is the player-controlled canonical device. Each Their Phone belongs to its own Character Instance and never inherits player access automatically.',
  'Canon vs player-only access': 'Opening or inspecting a phone does not by itself create story canon or Character Knowledge. Canon changes only through supported canonical actions.',
  'Calls & Contacts': 'Contacts and Calls use the selected phone Account and Device. Call actions remain bounded by the current phone access and call state.',
  'Phone Number Discovery': 'Phone number discovery follows the current Settings preference. The Guide does not manufacture numbers or contact evidence.',
  'Phone Access modes': 'Phone access follows the configured experience preset and canonical access state. A visible device is not proof that its private apps are readable.',
  'Privacy & Character Knowledge': 'Player-visible private phone state does not automatically become Character Knowledge. Knowledge grants require their own canonical evidence.',
  'Messages / Groups': 'Messages and Groups read and write through canonical messaging services for the selected Account. Private conversations stay outside public Feed state.',
  'Stickers': 'Sticker behavior is available only where the current messaging surface supports it. This Guide does not imply unsupported sticker actions.',
  'Notes & Clues': 'Notes are private phone state. Creating or editing a Note does not grant that content to Characters as Knowledge.',
  'Director Mode / Promote to Canon / Undo': 'Director operations use their dedicated canonical correction tools. Normal phone navigation never performs Director writes.',
  'Voice & Calls': 'Voice controls reflect the current Voice capability. When the runtime is unavailable, text Calls remain available and Voice stays unavailable.',
  'Troubleshooting': 'Use app error states and Diagnostics when enabled. Retry only the affected app; normal navigation does not start background Social or Live generation.',
});
const guideId = (scope, playerInstanceId) => `phone-guide:${scope.storyId}:${scope.branchId}:${playerInstanceId}`;
export class GuideStateService {
  #unitOfWork; constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async get({ scope: inputScope, playerInstanceId }) { const scope = requireEventScope(inputScope); const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readonly({ stores: ['phoneGuideState'], scope }, async repositories => (await repositories.phoneGuideState.get(id)) || Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips: [], tutorialReplayCount: 0, guideStateIsCanon: false, phase: 7 })); }
  async resetTips({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: false }); }
  async replayTutorial({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: true }); }
  async #write({ scope, playerInstanceId, dismissedTips, replay }) { const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readwrite({ stores: ['phoneGuideState'], scope }, async repositories => { const old = await repositories.phoneGuideState.get(id); const row = Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips, tutorialReplayCount: (old?.tutorialReplayCount || 0) + (replay ? 1 : 0), guideStateIsCanon: false, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), phase: 7 }); await repositories.phoneGuideState.put(row); return row; }); }
}
