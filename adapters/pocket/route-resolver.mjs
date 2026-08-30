import { POCKET_MATCH_STATE } from './constants.mjs';
export class PocketRouteResolver {
  #mapper;
  constructor({ identityMapper }) { this.#mapper = identityMapper; }
  async resolve(routeKey) { const mapping = await this.#mapper.resolve({ sourceType: 'pocket-route', sourceId: String(routeKey) }); return mapping.state === POCKET_MATCH_STATE.EXACT ? Object.freeze({ ...mapping, routeKey: String(routeKey) }) : Object.freeze({ ...mapping, routeKey: String(routeKey) }); }
}
