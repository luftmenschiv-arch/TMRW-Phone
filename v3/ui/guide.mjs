import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';

export const GUIDE_TOPICS = Object.freeze(['Start Here', 'My Phone & Their Phones', 'Calls & Contacts', 'Phone Numbers', 'Phone Access', 'Privacy', 'Messages & Groups', 'Stickers', 'Notes', 'Director Tools', 'Voice & Calls', 'Help']);
export const GUIDE_TOPIC_CONTENT = Object.freeze({
  'Start Here': 'เลือก My Phone สำหรับโทรศัพท์ของคุณ หรือ Their Phones เพื่อดูโทรศัพท์ของตัวละครที่คุณเข้าถึงได้',
  'My Phone & Their Phones': 'โทรศัพท์แต่ละเครื่องแยกจากกัน เลือกเจ้าของเครื่องจากหน้าหลักได้ตลอดเวลา',
  'Calls & Contacts': 'โหมด Instant ทำให้ตัวละครในเรื่องพร้อมแชทและโทรได้ทันทีโดยไม่สร้างเบอร์ปลอม ส่วน Story mode จะรอการค้นพบเบอร์จากเนื้อเรื่อง',
  'Phone Numbers': 'Instant ใช้ตัวตนและบัญชีโทรศัพท์ที่มีอยู่จริงโดยไม่ต้องมีตัวเลขเบอร์ ส่วน Story mode จะบันทึก Saved Name เมื่อพบเบอร์ที่ตัวละครให้ไว้อย่างชัดเจน',
  'Phone Access': 'บางเครื่องหรือบางแอปอาจยังล็อกอยู่ จนกว่าจะเข้าถึงได้ตามเนื้อเรื่อง',
  'Privacy': 'สิ่งที่คุณเห็นในโทรศัพท์ของตัวละครไม่ได้แปลว่าตัวละครนั้นรู้สิ่งเดียวกันโดยอัตโนมัติ',
  'Messages & Groups': 'ใน Instant mode เลือกตัวละครเพื่อเริ่ม DM ใหม่ได้ทันที แชทหลักจะไม่ถูกคัดลอกเข้ามาทั้งหมดโดยอัตโนมัติ',
  'Stickers': 'สติกเกอร์จะแสดงเฉพาะในหน้าข้อความที่รองรับ',
  'Notes': 'Notes เป็นบันทึกส่วนตัวของโทรศัพท์เครื่องนั้น',
  'Director Tools': 'ใช้เครื่องมือ Director เมื่อคุณต้องการยืนยันหรือย้อนการเปลี่ยนแปลงในเนื้อเรื่อง',
  'Voice & Calls': 'สายข้อความยังใช้งานได้แม้ Voice จะยังไม่พร้อม',
  'Help': 'หากแอปเปิดไม่สำเร็จ ให้ลอง Retry หรือกลับหน้าหลักแล้วเปิดใหม่อีกครั้ง',
});
const guideId = (scope, playerInstanceId) => `phone-guide:${scope.storyId}:${scope.branchId}:${playerInstanceId}`;
export class GuideStateService {
  #unitOfWork; constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async get({ scope: inputScope, playerInstanceId }) { const scope = requireEventScope(inputScope); const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readonly({ stores: ['phoneGuideState'], scope }, async repositories => (await repositories.phoneGuideState.get(id)) || Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips: [], tutorialReplayCount: 0, guideStateIsCanon: false, phase: 7 })); }
  async resetTips({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: false }); }
  async replayTutorial({ scope: inputScope, playerInstanceId }) { return this.#write({ scope: requireEventScope(inputScope), playerInstanceId, dismissedTips: [], replay: true }); }
  async #write({ scope, playerInstanceId, dismissedTips, replay }) { const id = guideId(scope, requireText(playerInstanceId, 'playerInstanceId')); return this.#unitOfWork.readwrite({ stores: ['phoneGuideState'], scope }, async repositories => { const old = await repositories.phoneGuideState.get(id); const row = Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId, dismissedTips, tutorialReplayCount: (old?.tutorialReplayCount || 0) + (replay ? 1 : 0), guideStateIsCanon: false, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), phase: 7 }); await repositories.phoneGuideState.put(row); return row; }); }
}
