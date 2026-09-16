import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlayableCastManifest } from '../../application/playable-bootstrap/cast-manifest.mjs';
import { readPlayableHistory, recentHistoryWindow } from '../../application/playable-bootstrap/history-reader.mjs';

test('single Character Card can yield multiple approved narrative Actors without Preview data', async () => {
  const context = {
    characterId: 0,
    name2: 'Kuroko no Basket',
    characters: [{ name: 'Kuroko no Basket', avatar: 'kuroko-card.png', data: { extensions: { tmrw_phone: { cast: ['Kuroko Tetsuya', 'Kagami Taiga', 'Aomine Daiki'] } } }, description: 'Kise Ryota: รุ่นปาฏิหาริย์\nMidorima Shintaro: รุ่นปาฏิหาริย์' }],
    chat: [{ is_user: false, name: 'Kise Ryota', mes: 'Kise Ryota: หิวแล้ว' }, { is_user: false, name: 'Kise Ryota', mes: 'Kise Ryota: ไปกินข้าวกัน' }],
  };
  const manifest = await extractPlayableCastManifest(context);
  assert.deepEqual(manifest.approvedCast.slice(0, 3).map(row => row.displayName).sort(), ['Aomine Daiki', 'Kagami Taiga', 'Kuroko Tetsuya']);
  assert.ok(manifest.cast.some(row => row.displayName === 'Kise Ryota'));
  assert.ok(manifest.cast.every(row => row.sourceActorId.startsWith('cast:')));
  assert.equal(JSON.stringify(manifest).includes('preview37'), false);
});

test('history reader chunks hundreds of messages with stable ordinals and fingerprints', async () => {
  const context = { chatId: 'long-story', chat: Array.from({ length: 205 }, (_, index) => ({ is_user: index % 2 === 0, name: index % 2 ? 'Kaelan' : 'User', mes: `message ${index} ${'x'.repeat(90)}`, swipe_id: index % 3 })) };
  const window = recentHistoryWindow(context.chat.length, 48); assert.deepEqual(window, { startOrdinal: 157, endOrdinal: 205 });
  const result = await readPlayableHistory(context, { chunkMessages: 20, chunkCharacters: 3000 });
  assert.equal(result.scannedMessages, 205); assert.ok(result.chunks.length > 10); assert.equal(result.chunks[0].startOrdinal, 0); assert.equal(result.chunks.at(-1).endOrdinal, 205);
  const repeat = await readPlayableHistory(context, { chunkMessages: 20, chunkCharacters: 3000 }); assert.equal(repeat.headFingerprint, result.headFingerprint);
  context.chat[204].mes = 'revised'; const revised = await readPlayableHistory(context, { startOrdinal: 204 }); assert.notEqual(revised.headFingerprint, result.chunks.at(-1).fingerprint);
});
