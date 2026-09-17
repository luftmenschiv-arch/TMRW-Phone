const legacyPulse = text => /เรื่อง “|สรุปเรื่อง |ประเด็น .*ยังทำให้|จับตา .*ต่อ|บรรยากาศ .*แบบหมดรูป|จุดชมวิวเรื่อง|ไม่ได้อยากยุ่งนะ แต่แถว|วงน้ำชาขอเปิดประเด็น|นอนไม่หลับเลยมาเช็กข่าว|ยังไม่ฟันธง แต่ไทม์ไลน์|วันนี้ทำคนใจบาง|ขอพิกัดวงมุง/u.test(String(text || ''));
const fingerprint = value => String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

export function feedViewModel(page) {
  const seenPosts = new Set(); const rows = [];
  for (const post of page?.items || []) {
    if (legacyPulse(post.text)) continue;
    const postKey = `${post.authorAccountId || ''}:${fingerprint(post.text)}`;
    if (!fingerprint(post.text) || seenPosts.has(postKey)) continue;
    seenPosts.add(postKey);
    const seenComments = new Set(); const comments = [];
    for (const comment of post.commentPreview || []) {
      const commentKey = `${comment.authorAccountId || ''}:${fingerprint(comment.text)}`;
      if (!fingerprint(comment.text) || seenComments.has(commentKey)) continue;
      seenComments.add(commentKey); comments.push(comment);
    }
    rows.push(Object.freeze({ key: post.postId, postId: post.postId, authorAccountId: post.authorAccountId, text: post.text, audience: post.audience.kind, storyTimeRef: post.storyTimeRef, assetRefs: post.assetRefs, likeCount: Number(post.likeCount || 0), likedByViewer: Boolean(post.likedByViewer), commentCount: Math.max(Number(post.commentCount || 0), comments.length), commentPreview: Object.freeze(comments) }));
  }
  return Object.freeze(rows);
}
