export function identitySeed({
  castSize = 1,
  manifestId = `fixture-cast-${castSize}`,
  cardSourceId = `card-cast-${castSize}`,
  storySourceId = 'story-alpha',
  routeSourceId = 'route-main',
  userName = '{{user}}',
  cast = null,
  userAccounts = null,
} = {}) {
  const members = cast || Array.from({ length: castSize }, (_, index) => ({
    sourceActorId: `actor-${String(index + 1).padStart(2, '0')}`,
    displayName: `Character ${index + 1}`,
    aliases: [`C${index + 1}`],
  }));
  return {
    manifestId,
    sourceAuthority: 'phase2-fixture',
    card: { sourceCardId: cardSourceId, displayName: `Synthetic ${members.length}-cast card` },
    story: { sourceStoryId: storySourceId, title: `Story ${storySourceId}` },
    branch: { sourceRouteId: routeSourceId, label: `Branch ${routeSourceId}` },
    user: { displayName: userName, aliases: ['Player'], ...(userAccounts ? { accounts: userAccounts } : {}) },
    cast: members,
  };
}
