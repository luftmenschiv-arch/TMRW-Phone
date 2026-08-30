import { MILESTONE1_HEALTH_KEY } from './health-check.mjs';
import { V3UnitOfWork } from '../storage/unit-of-work.mjs';

export const BETA_MODE = Object.freeze({ PREVIEW37: 'preview37', V3_READONLY: 'v3-readonly', V3_AUTHORING: 'v3-authoring' });

export class BetaModeSelector {
  #flag; #unitOfWork;
  constructor({ featureFlag, database }) { if (!featureFlag || !database) throw new TypeError('Beta mode selector requires feature flag and isolated v3 storage'); this.#flag = featureFlag; this.#unitOfWork = new V3UnitOfWork(database); }
  async current() { const health = await this.#unitOfWork.readonly({ stores: ['metadata'], privileged: true }, repositories => repositories.metadata.get(MILESTONE1_HEALTH_KEY)); return Object.freeze({ mode: this.#flag.read().requested ? (health?.status === 'pass' ? BETA_MODE.V3_AUTHORING : BETA_MODE.V3_READONLY) : BETA_MODE.PREVIEW37, gateF: health?.status || 'unverified', authoringEnabled: Boolean(this.#flag.read().requested && health?.status === 'pass') }); }
  async selectPreview37() { this.#flag.requestDisable(); return this.current(); }
  async selectReadonlyBeta() { this.#flag.requestEnable(); return this.current(); }
  async selectAuthoringBeta() { const health = await this.#unitOfWork.readonly({ stores: ['metadata'], privileged: true }, repositories => repositories.metadata.get(MILESTONE1_HEALTH_KEY)); if (health?.status !== 'pass') throw new Error(`STOP GATE F blocks v3 authoring: ${(health?.blockers || ['health-unverified']).join(', ')}`); this.#flag.requestEnable(); return this.current(); }
}
