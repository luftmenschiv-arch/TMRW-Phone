const HUMAN_TERMS = new Set([
  'person', 'people', 'human', 'portrait', 'selfie', 'model', 'man', 'men', 'male', 'woman', 'women', 'female',
  'girl', 'girls', 'boy', 'boys', 'child', 'children', 'kid', 'kids', 'couple', 'family', 'bride', 'groom', 'face', 'faces',
  'lady', 'gentleman', 'teen', 'teenager', 'baby', 'babies', 'crowd', 'worker', 'workers', 'student', 'students',
]);
const STOP_TERMS = new Set(['a', 'an', 'the', 'of', 'to', 'from', 'in', 'on', 'at', 'with', 'and', 'or', 'photo', 'image', 'picture', 'view', 'today']);

function tokens(value) {
  return [...String(value || '').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(match => match[0]);
}

function semanticTokens(value) {
  return [...new Set(tokens(value).filter(token => token.length > 1 && !STOP_TERMS.has(token)))];
}

function humanEvidence(candidate) {
  if (candidate?.contentSignals?.people === 'present') return true;
  if (candidate?.contentSignals?.people === 'absent') return false;
  return candidate.tags.some(tag => tokens(tag).some(token => HUMAN_TERMS.has(token)));
}

function semanticOverlap(queryTerms, candidate) {
  if (!queryTerms.length) return 0;
  const candidateTerms = new Set(candidate.tags.flatMap(semanticTokens));
  let overlap = 0;
  for (const token of queryTerms) if (candidateTerms.has(token)) overlap += 1;
  return overlap;
}

function popularity(candidate) {
  const { likes = 0, views = 0, downloads = 0 } = candidate.rankSignals || {};
  return Math.log1p(likes) * 3 + Math.log1p(downloads) + Math.log1p(views) * 0.25;
}

export function rankImageCandidates(request, candidates = []) {
  const queryTerms = semanticTokens(request?.query);
  const scored = [];
  for (const candidate of candidates) {
    if (!candidate || candidate.mediaType !== 'image' || !candidate.urls?.display || !candidate.urls?.sourcePage) continue;
    const hasHumanEvidence = humanEvidence(candidate);
    if (request.peoplePolicy === 'avoid' && hasHumanEvidence) continue;
    if (request.peoplePolicy === 'require' && !hasHumanEvidence) continue;
    const overlap = semanticOverlap(queryTerms, candidate);
    if (request.peoplePolicy === 'avoid' && overlap < 1) continue;
    scored.push({ candidate, score: overlap * 100 + popularity(candidate), overlap, hasHumanEvidence });
  }
  scored.sort((a, b) => b.score - a.score || String(a.candidate.providerAssetId).localeCompare(String(b.candidate.providerAssetId)));
  return Object.freeze(scored.map(row => Object.freeze({
    candidate: row.candidate,
    score: Number(row.score.toFixed(6)),
    semanticOverlap: row.overlap,
    peopleEvidence: row.hasHumanEvidence ? 'present' : (row.candidate.contentSignals?.people || 'unknown'),
  })));
}

export function selectBestImageCandidate(request, candidates = []) {
  return rankImageCandidates(request, candidates)[0]?.candidate || null;
}
