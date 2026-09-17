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

test('card schema labels never become phone owners and inferred names require confirmation', async () => {
  const context = {
    characterId: 0,
    name2: 'Jeren',
    characters: [{ name: 'Jeren', avatar: 'jeren.png', description: 'Age: 28\nHair: black\nHeight: 190\nSkin: pale\nStatus: active\nKaelan Vance: ผู้ร่วมเหตุการณ์' }],
    chat: [
      { is_user: false, name: 'Jeren', mes: 'Note: เขาเดินเข้ามา\nOoc: ดำเนินเรื่องต่อ' },
      { is_user: false, name: 'Jeren', mes: 'Note: บันทึกอีกครั้ง\nOoc: ดำเนินเรื่องต่อ' },
    ],
  };
  const manifest = await extractPlayableCastManifest(context);
  assert.deepEqual(manifest.approvedCast.map(row => row.displayName), ['Jeren']);
  assert.equal(manifest.cast.some(row => ['Age', 'Hair', 'Height', 'Skin', 'Status', 'Note', 'Ooc'].includes(row.displayName)), false);
  assert.equal(manifest.cast.some(row => row.displayName === 'Kaelan Vance'), false);
});

test('recurring Thai narrative roles become reviewable cast candidates', async () => {
  const context = {
    characterId: 0,
    name2: 'Jeren',
    characters: [{ name: 'Jeren', avatar: 'jeren.png' }],
    chat: [
      { is_user: false, name: 'Jeren', mes: 'ชายเจ้าของบ้านยืนรออยู่ตรงประตู “กลับมาแล้วเหรอ”' },
      { is_user: false, name: 'Jeren', mes: 'ชายเจ้าของบ้านวางแก้วลง “มานั่งก่อนสิ”' },
      { is_user: false, name: 'Jeren', mes: 'ชายเจ้าของบ้านหันมามองและตอบกลับทันที' },
      { is_user: false, name: 'Jeren', mes: 'ชายเจ้าของบ้านถอนหายใจ ก่อนจะเดินออกไป' },
      { is_user: true, name: 'Hector', mes: 'เจ้าของบ้านคนนั้นเป็นใคร' },
    ],
  };
  const manifest = await extractPlayableCastManifest(context);
  const landlord = manifest.cast.find(row => row.displayName === 'ชายเจ้าของบ้าน');
  assert.ok(landlord);
  assert.equal(landlord.approved, false);
  assert.equal(landlord.confidence, 'candidate');
  assert.ok(landlord.evidence.includes('recurring-role'));
  assert.equal(manifest.cast.some(row => row.displayName === 'เจ้าของบ้าน'), false);
  assert.equal(manifest.cast.some(row => row.displayName === 'Hector'), false);
});

test('current scene roster finds Thai NPCs while stale branch history stays out of cast review', async () => {
  const stale = Array.from({ length: 8 }, (_, index) => ({ is_user: false, name: 'Jeren', mes: `ชายเจ้าของบ้านพูดถึงเรื่องเก่า ${index}` }));
  const bridge = Array.from({ length: 160 }, (_, index) => ({ is_user: index % 2 === 0, name: index % 2 === 0 ? 'Hector' : 'Jeren', mes: `เหตุการณ์ในเส้นเรื่องปัจจุบัน ${index}` }));
  const current = Array.from({ length: 12 }, (_, index) => ({
    is_user: index % 2 === 0,
    name: index % 2 === 0 ? 'Hector' : 'Jeren',
    mes: `<scene| เวลา | สถานที่ | ${index % 2 === 0 ? 'Jeren' : 'คุณ'}, คีรัน | ของใช้>\nคีรันยังอยู่ในฉากปัจจุบัน`,
  }));
  const manifest = await extractPlayableCastManifest({
    characterId: 0,
    name1: 'Hector',
    name2: 'Jeren',
    characters: [{ name: 'Jeren', avatar: 'jeren.png', description: 'เจ้าของบ้าน: ตัวละครจากเส้นเรื่องเก่า' }],
    chat: [...stale, ...bridge, ...current],
  });
  const currentNpc = manifest.cast.find(row => row.displayName === 'คีรัน');
  assert.ok(currentNpc);
  assert.equal(currentNpc.approved, false);
  assert.ok(currentNpc.evidence.includes('scene-roster'));
  assert.equal(manifest.cast.some(row => row.displayName === 'เจ้าของบ้าน'), false);
});
