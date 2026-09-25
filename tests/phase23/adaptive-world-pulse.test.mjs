import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase15, postFrom, commentFrom, socialSource } from '../phase15/social-fixtures.mjs';
import { AdaptiveWorldPulseService } from '../../application/playable-bootstrap/adaptive-world-pulse.mjs';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createLiveProjector } from '../../domain/live/live-projector.mjs';
import { LiveService } from '../../domain/live/live-service.mjs';
import { createMessagingProjector } from '../../domain/messaging/messaging-projector.mjs';
import { MessageService } from '../../domain/messaging/message-service.mjs';

const feedBatch = () => ({ posts:Array.from({length:9},(_,index)=>({ author:`คนงานเขตเหนือ ${index+1}`, text:`ประกาศตลาดแรงงานครึ่งสัตว์ฉบับที่ ${index+1} กำลังถูกวิจารณ์เรื่องค่าธรรมเนียม`, likes:3, comments:[{author:'เสมียนตลาดกลาง',text:'กฎใหม่นี้กระทบทั้งนายหน้าและครอบครัวผู้ซื้อโดยตรง'},{author:'คนส่งข่าวประจำตรอก',text:'ฝั่งประตูเหนือเริ่มตรวจเอกสารเข้มขึ้นแล้ว'}] })) });

test('device roster uses the saved profile avatar and display name before card fallbacks', async () => {
  const c=await setupPhase15({castSize:1,manifestId:'device-roster-profile-avatar'});
  await c.social.setPersona({scope:c.scope,actorId:c.alice.actorId,instanceId:c.alice.instanceId,accountId:c.alice.accountId,persona:{displayName:'ชื่อในโปรไฟล์',avatarUrl:'data:image/png;base64,profile'},source:socialSource('roster-profile'),idempotencyKey:'roster-profile'});
  const row=(await c.viewModels.deviceRoster(c.scope)).find(item=>item.actorId===c.alice.actorId);
  assert.equal(row.label,'ชื่อในโปรไฟล์');assert.equal(row.avatarUrl,'data:image/png;base64,profile');
});

test('adaptive pulse grounds the feed in the current RP world, persists its bible, and replies live to the player', async () => {
  const c = await setupPhase15({ castSize:1, manifestId:'adaptive-world-pulse' });
  const calls=[];const context={name2:'เจเรน',scenario:'นครแห่งนี้อนุญาตให้ซื้อขายทาสครึ่งสัตว์อย่างถูกกฎหมาย',chat:[{is_user:false,name:'เจเรน',mes:'ตลาดกำลังขึ้นค่าธรรมเนียมทะเบียนทาสครึ่งสัตว์'}],generateQuietPrompt:async options=>{calls.push(options);if(options.quietName==='TMRW World Social Bible')return JSON.stringify({worldSummary:'นครชนชั้นที่การซื้อขายทาสครึ่งสัตว์ถูกกฎหมาย',socialOrder:'ชนชั้นนายทุน นายหน้า และทาสครึ่งสัตว์',economyAndLaw:'การซื้อขายต้องมีทะเบียนจากตลาดกลาง',technologyAndMedia:'ผู้คนใช้เครือข่ายข่าวสารบนโทรศัพท์',languageStyle:'ภาษาไทยตามฐานะและอาชีพ',publicNorms:['การตรวจทะเบียนเป็นเรื่องปกติ'],institutions:['ตลาดกลาง'],tensions:['ค่าธรรมเนียมกำลังสูงขึ้น'],currentPublicEvents:['ประตูเหนือเพิ่มการตรวจเอกสาร']});if(options.quietName==='TMRW Living Feed')return JSON.stringify(feedBatch());if(options.quietName==='TMRW Social Replies')return JSON.stringify({replies:[{author:'เสมียนตลาดกลาง',text:'ถ้าจะค้านเรื่องนี้ควรยื่นเอกสารก่อนตลาดปิดวันนี้'}]});throw new Error('unexpected prompt');}};
  const pulse=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,settingsService:c.settings,getContext:()=>context,now:()=> '2026-09-17T08:00:00.000Z'});
  const rosterBefore=await c.viewModels.deviceRoster(c.scope);const prime=await pulse.prime({scope:c.scope,minimum:6,playerInstanceId:c.user.instanceId});assert.equal(prime.ready,true);assert.equal(prime.created.length,6);
  const feed=await c.social.listFeed({scope:c.scope,viewerAccountId:c.user.accountId,limit:20});assert.equal(feed.items.length,6);assert.ok(feed.items.every(row=>/ทาสครึ่งสัตว์|ตลาด/u.test(row.text)));
  assert.match(calls.find(row=>row.quietName==='TMRW Living Feed').quietPrompt,/ซื้อขายทาสครึ่งสัตว์/u);assert.match((await c.settings.get({scope:c.scope,playerInstanceId:c.user.instanceId})).worldSocialBible.worldSummary,/ทาสครึ่งสัตว์/u);
  const playerPost=await postFrom(c,c.user,{key:'player-world-post',text:'ฉันไม่เห็นด้วยกับค่าธรรมเนียมใหม่นี้'});const playerComment=await commentFrom(c,playerPost.post.postId,c.user,{key:'player-world-comment',text:'มีใครรู้วิธียื่นคัดค้านไหม'});const progress=[];
  const reaction=await pulse.respondToPlayerAction({scope:c.scope,playerInstanceId:c.user.instanceId,postId:playerPost.post.postId,parentCommentId:playerComment.comment.commentId,actionText:playerComment.comment.text,actionKind:'comment',onProgress:event=>progress.push(event)});
  assert.equal(reaction.generated,1);assert.equal(reaction.comments[0].parentCommentId,playerComment.comment.commentId);assert.match(reaction.comments[0].text,/ยื่นเอกสาร/u);assert.equal(progress.length,1);
  const npcQuestion=await commentFrom(c,feed.items[0].postId,c.user,{key:'player-question-on-npc',text:'ถามในโพสต์ชาวเมือง'});const npcReaction=await pulse.respondToPlayerAction({scope:c.scope,playerInstanceId:c.user.instanceId,postId:feed.items[0].postId,parentCommentId:npcQuestion.comment.commentId,actionText:npcQuestion.comment.text,actionKind:'comment'});assert.equal(npcReaction.generated,1);
  assert.equal((await c.viewModels.deviceRoster(c.scope)).length,rosterBefore.length,'ambient identities must not become Their Phone devices');
});

test('refeed survives a stale numerical slot without reusing an older canonical event key', async () => {
  const c = await setupPhase15({ castSize:1, manifestId:'adaptive-world-pulse-stale-slot' });
  let batch = 1;
  const context={name2:'เจเรน',scenario:'นครการค้าทาสครึ่งสัตว์',chat:[],generateQuietPrompt:async options=>{
    if(options.quietName==='TMRW World Social Bible')return JSON.stringify({worldSummary:'นครการค้าทาสครึ่งสัตว์',socialOrder:'นายหน้าและแรงงาน',economyAndLaw:'ตลาดกลางออกใบทะเบียน',technologyAndMedia:'ใช้เครือข่ายข่าว',languageStyle:'ภาษาไทย',publicNorms:['ตรวจทะเบียน'],institutions:['ตลาดกลาง'],tensions:['ค่าธรรมเนียม'],currentPublicEvents:['ด่านตรวจเข้มขึ้น']});
    if(options.quietName==='TMRW Living Feed')return JSON.stringify({posts:Array.from({length:9},(_,index)=>({author:`ผู้สื่อข่าว ${batch}-${index}`,text:`ข่าวชุด ${batch} ลำดับ ${index}`,likes:0,comments:[]}))});
    throw new Error('unexpected prompt');
  }};
  const first=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,settingsService:c.settings,getContext:()=>context,now:()=> '2026-09-17T08:00:00.000Z'});
  const seeded=await first.refresh({scope:c.scope,count:1,playerInstanceId:c.user.instanceId});
  assert.equal(seeded.created.length,1);

  // Model an interrupted/legacy projection where the canonical Event exists
  // but the feed counter no longer sees its projected row.
  await c.database.transaction(['socialPosts'],'readwrite',tx=>tx.store('socialPosts').delete(seeded.created[0].postId));
  batch=2;
  const afterReload=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,settingsService:c.settings,getContext:()=>context,now:()=> '2026-09-17T08:01:00.000Z'});
  const refreshed=await afterReload.refresh({scope:c.scope,count:1,playerInstanceId:c.user.instanceId});
  assert.equal(refreshed.created.length,1);
  assert.match(refreshed.created[0].text,/ข่าวชุด 2/u);
});

test('phone activity gives each bot a contextual DM and creates a populated public live room', async () => {
  const c=await setupPhase15({castSize:1,manifestId:'adaptive-phone-activity'});
  const liveEngine=new CanonicalEventEngine({database:c.database,eventTypes:createPhase23EventTypeRegistry(),projectors:[createMessagingProjector(),createLiveProjector()],now:()=> '2026-09-17T08:00:00.000Z'});await liveEngine.rebuild(c.scope);const live=new LiveService({database:c.database,eventEngine:liveEngine});const messages=new MessageService({database:c.database,eventEngine:liveEngine});
  const context={name1:'เฮคเตอร์',name2:'เจเรน',scenario:'นครการค้าทาสครึ่งสัตว์',chat:[{is_user:false,name:'เจเรน',mes:'คืนนี้ตลาดกลางจะตรวจตราเข้มกว่าปกติ'}],generateQuietPrompt:async options=>{
    if(options.quietName==='TMRW World Social Bible')return JSON.stringify({worldSummary:'นครการค้าทาสครึ่งสัตว์',socialOrder:'นายหน้าและแรงงาน',economyAndLaw:'ตลาดกลางออกใบทะเบียน',technologyAndMedia:'ใช้เครือข่ายข่าว',languageStyle:'ภาษาไทย',publicNorms:['ตรวจทะเบียน'],institutions:['ตลาดกลาง'],tensions:['ค่าธรรมเนียม'],currentPublicEvents:['คืนนี้ด่านตรวจเข้มขึ้น']});
    if(options.quietName==='TMRW Phone Activity')return JSON.stringify({conversations:[{ownerKey:'owner-1',contact:'เฮคเตอร์ โลเคชันเดอร์',messages:[{sender:'contact',text:'ข้อความจากตัวตนผู้เล่นซ้ำที่ต้องถูกทิ้ง'},{sender:'owner',text:'ไม่ควรเห็น'}]},{ownerKey:'owner-1',contact:'เสมียนเวรดึก',messages:[{sender:'contact',text:'คืนนี้ประตูเหนือเพิ่มเวรตรวจนะ'},{sender:'owner',text:'รับทราบ เดี๋ยวฉันหลีกทางนั้น'}]},{ownerKey:'owner-1',contact:'หัวหน้าเวร',messages:[{sender:'contact',text:'เปลี่ยนกะตอนเที่ยงคืน'},{sender:'owner',text:'ฉันจะไปให้ตรงเวลา'}]},{ownerKey:'owner-1',contact:'เจ้าของร้านชา',messages:[{sender:'contact',text:'ของที่ฝากไว้มาถึงแล้ว'},{sender:'owner',text:'เก็บไว้หลังร้านก่อน'}]}],lives:[{host:'นักข่าวตลาดกลาง',title:'เกาะติดด่านตรวจคืนนี้',topic:'ข่าวในเมือง',description:'รายงานบรรยากาศหน้าประตูเหนือ',comments:[{author:'คนส่งของเวรดึก',text:'แถวเริ่มยาวแล้ว'},{author:'แม่ค้าร้านชา',text:'ฝั่งตะวันออกยังผ่านได้'}]}]});
    throw new Error(`unexpected prompt ${options.quietName}`);
  }};
  const pulse=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,messageService:messages,liveService:live,settingsService:c.settings,getContext:()=>context,now:()=> '2026-09-17T08:00:00.000Z'});
  const result=await pulse.primePhoneActivity({scope:c.scope,playerInstanceId:c.user.instanceId,deviceIds:[c.user.deviceId,c.alice.deviceId],fingerprint:'phone-head-a'});
  assert.equal(result.conversations,3);assert.equal(result.lives,1);
  const threads=await messages.listThreads({scope:c.scope,viewerAccountId:c.alice.accountId});assert.equal(threads.length,3);
  const messageSets=await Promise.all(threads.map(thread=>messages.listMessages({scope:c.scope,viewerAccountId:c.alice.accountId,threadId:thread.threadId})));
  assert.equal(messageSets.flat().some(row=>row.text==='ข้อความจากตัวตนผู้เล่นซ้ำที่ต้องถูกทิ้ง'),false);
  assert.equal(messageSets.some(rows=>rows.map(row=>row.text).join('|')==='คืนนี้ประตูเหนือเพิ่มเวรตรวจนะ|รับทราบ เดี๋ยวฉันหลีกทางนั้น'),true);
  const sessions=await live.listSessions({scope:c.scope,viewerAccountId:c.user.accountId});assert.equal(sessions.items.length,1);
  const comments=await live.listMessages({scope:c.scope,viewerAccountId:c.user.accountId,sessionId:sessions.items[0].sessionId});assert.equal(comments.items.length,2);
  const replay=await pulse.primePhoneActivity({scope:c.scope,playerInstanceId:c.user.instanceId,deviceIds:[c.alice.deviceId],fingerprint:'phone-head-a'});assert.equal(replay.replayed,true);
});

test('phone activity failure produces three distinct readable conversations instead of permanent duplicate placeholders', async () => {
  const c=await setupPhase15({castSize:1,manifestId:'adaptive-phone-activity-fallback'});
  const context={name1:'ผู้เล่น',name2:'Character 1',scenario:'เมืองกำลังรับมือเหตุการณ์สำคัญ',chat:[],generateQuietPrompt:async options=>{
    if(options.quietName==='TMRW World Social Bible')return JSON.stringify({worldSummary:'เมืองที่ผู้คนติดตามข่าวจากหน้างาน',socialOrder:'ผู้ประสานงานและคนทำงาน',economyAndLaw:'ใช้กฎของเมือง',technologyAndMedia:'ใช้โทรศัพท์',languageStyle:'ภาษาไทย',publicNorms:['ตรวจสอบข่าวก่อนส่งต่อ'],institutions:['ศูนย์ประสานงาน'],tensions:['ข้อมูลจากแต่ละฝ่ายยังไม่ตรงกัน'],currentPublicEvents:['ศูนย์ประสานงานกำลังรวบรวมข้อมูลล่าสุด']});
    if(options.quietName==='TMRW Phone Activity')throw new Error('503 Service Unavailable');
    throw new Error(`unexpected prompt ${options.quietName}`);
  }};
  const pulse=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,messageService:c.messages,settingsService:c.settings,getContext:()=>context,now:()=> '2026-09-17T08:00:00.000Z'});
  const result=await pulse.primePhoneActivity({scope:c.scope,playerInstanceId:c.user.instanceId,deviceIds:[c.alice.deviceId],fingerprint:'phone-head-fallback'});
  assert.equal(result.conversations,3);
  const threads=await c.messages.listThreads({scope:c.scope,viewerAccountId:c.alice.accountId});assert.equal(threads.length,3);
  const sets=await Promise.all(threads.map(thread=>c.messages.listMessages({scope:c.scope,viewerAccountId:c.alice.accountId,threadId:thread.threadId})));
  assert.equal(new Set(sets.map(rows=>rows.map(row=>row.text).join('|'))).size,3);
  assert.equal(sets.every(rows=>rows.length===4),true);
  assert.equal(sets.flat().some(row=>row.text==='ไว้ฉันจะลองดูสถานการณ์อีกที'),false);
});

test('manual phone refresh excludes the player and existing contacts without inventing fallback chats', async () => {
  const c = await setupPhase15({ castSize: 1, manifestId: 'phone-activity-manual-refresh' });
  const context = { name1: 'เฮคเตอร์', name2: 'Dr. Kaelan Vance', scenario: 'โรงพยาบาลกำลังจัดเวรใหม่', chat: [], generateQuietPrompt: async options => {
    if (options.quietName === 'TMRW World Social Bible') return JSON.stringify({ worldSummary: 'โรงพยาบาลกำลังจัดเวรใหม่', socialOrder: 'ทีมแพทย์และพยาบาล', economyAndLaw: 'ยึดกฎโรงพยาบาล', technologyAndMedia: 'โทรศัพท์', languageStyle: 'ภาษาไทย', publicNorms: ['คุยเรื่องงาน'], institutions: ['โรงพยาบาล'], tensions: ['เวรไม่พอ'], currentPublicEvents: ['ปรับตารางเวร'] });
    if (options.quietName === 'TMRW Phone Activity') return JSON.stringify({ conversations: [
      { ownerKey: 'owner-1', contact: 'เฮคเตอร์ โลคาซันเดอร์', messages: [{ sender: 'contact', text: 'ไม่ควรเป็นอีกคน' }, { sender: 'owner', text: 'ไม่ควรเห็น' }] },
      { ownerKey: 'owner-1', contact: 'คนในทีม', messages: [{ sender: 'contact', text: 'แชทเก่าที่มีแล้ว' }, { sender: 'owner', text: 'ไม่ควรซ้ำ' }] },
      { ownerKey: 'owner-1', contact: 'พยาบาลเวรบ่าย', messages: [{ sender: 'contact', text: 'ตารางเวรใหม่ออกแล้วค่ะ' }, { sender: 'owner', text: 'ส่งมาให้ฉันดูหน่อย' }] },
    ], lives: [] });
    throw new Error('unexpected prompt');
  } };
  const pulse = new AdaptiveWorldPulseService({ database: c.database, socialService: c.social, messageService: c.messages, settingsService: c.settings, getContext: () => context });
  const result = await pulse.refreshPhoneActivity({ scope: c.scope, playerInstanceId: c.user.instanceId, deviceId: c.alice.deviceId, excludedContacts: ['คนในทีม'] });
  assert.equal(result.conversations, 1);
  const threads = await c.messages.listThreads({ scope: c.scope, viewerAccountId: c.alice.accountId });
  assert.equal(threads.length, 1);
  const messages = await c.messages.listMessages({ scope: c.scope, viewerAccountId: c.alice.accountId, threadId: threads[0].threadId });
  assert.equal(messages[0].text, 'ตารางเวรใหม่ออกแล้วค่ะ');
});

test('manual phone refresh reports an unavailable API without creating placeholder conversations', async () => {
  const c = await setupPhase15({ castSize: 1, manifestId: 'phone-activity-manual-503' });
  const context = { name1: 'เฮคเตอร์', name2: 'Dr. Kaelan Vance', scenario: 'โรงพยาบาล', chat: [], generateQuietPrompt: async options => {
    if (options.quietName === 'TMRW World Social Bible') return JSON.stringify({ worldSummary: 'โรงพยาบาล', socialOrder: 'ทีมแพทย์', economyAndLaw: 'กฎโรงพยาบาล', technologyAndMedia: 'โทรศัพท์', languageStyle: 'ภาษาไทย', publicNorms: ['คุยเรื่องงาน'], institutions: ['โรงพยาบาล'], tensions: [], currentPublicEvents: [] });
    throw new Error('503 Service Unavailable');
  } };
  const pulse = new AdaptiveWorldPulseService({ database: c.database, socialService: c.social, messageService: c.messages, settingsService: c.settings, getContext: () => context });
  await assert.rejects(pulse.refreshPhoneActivity({ scope: c.scope, playerInstanceId: c.user.instanceId, deviceId: c.alice.deviceId }), /503/);
  assert.equal((await c.messages.listThreads({ scope: c.scope, viewerAccountId: c.alice.accountId })).length, 0);
});

test('bot chooses and persists a distinct saved name for the player on its own phone', async () => {
  const c = await setupPhase15({ castSize: 1, manifestId: 'bot-saved-player-name' });
  const prompts = [];
  const context = { name1: 'เฮคเตอร์', name2: 'Dr. Kaelan Vance', scenario: 'ทำงานในโรงพยาบาลเดียวกัน', chat: [], generateQuietPrompt: async options => { prompts.push(options); return JSON.stringify({ savedName: 'เจ้าตัวปัญหา' }); } };
  const pulse = new AdaptiveWorldPulseService({ database: c.database, socialService: c.social, settingsService: c.settings, getContext: () => context });
  const chosen = await pulse.generateBotSavedName({ scope: c.scope, playerInstanceId: c.user.instanceId, deviceId: c.alice.deviceId });
  assert.equal(chosen.savedName, 'เจ้าตัวปัญหา');
  assert.match(prompts[0].quietPrompt, /Choose the private contact name/);
  const persisted = await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId });
  assert.equal(persisted.botSavedNames[c.alice.instanceId], 'เจ้าตัวปัญหา');
  const dm = await c.messages.createThread({ scope: c.scope, kind: 'dm', participantAccountIds: [c.user.accountId, c.alice.accountId], source: { authority: 'bot-saved-name-test', kind: 'test', recordId: 'player-dm', version: '1' }, idempotencyKey: 'bot-saved-name-player-dm' });
  await c.messages.sendMessage({ scope: c.scope, threadId: dm.thread.threadId, senderAccountId: c.user.accountId, actualAuthorActorId: c.user.actorId, actualAuthorInstanceId: c.user.instanceId, deviceId: c.user.deviceId, text: 'อาจารย์แวนซ์ครับ', source: { authority: 'bot-saved-name-test', kind: 'test', recordId: 'hello', version: '1' }, idempotencyKey: 'bot-saved-name-hello' });
  await c.overrides.grant({ scope: c.scope, deviceId: c.alice.deviceId, action: 'inspect', playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId });
  const view = await c.viewModels.selected({ scope: c.scope, deviceId: c.alice.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, playerDisplayName: 'เฮคเตอร์', route: 'messages', controller: c.controller });
  assert.equal(view.botSavedName, 'เจ้าตัวปัญหา');
  assert.equal(view.threadRows.find(row => row.threadId === dm.thread.threadId)?.label, 'เจ้าตัวปัญหา');
  assert.equal(Object.values(view.accountPresentations).some(row => row.actorId === c.user.actorId && row.label === 'เจ้าตัวปัญหา'), true);
  assert.equal(Object.values(view.accountPresentations).some(row => row.actorId === c.user.actorId && row.label === 'เฮคเตอร์'), false);
});

test('Their Phone hides old ambient chats that duplicate the current player name', async () => {
  const c = await setupPhase15({ castSize: 1, manifestId: 'phone-player-alias-visibility' });
  const context = { name1: 'คุณ', name2: 'Dr. Kaelan Vance', scenario: 'โรงพยาบาล', chat: [], generateQuietPrompt: async options => {
    if (options.quietName === 'TMRW World Social Bible') return JSON.stringify({ worldSummary: 'โรงพยาบาล', socialOrder: 'ทีมแพทย์', economyAndLaw: 'กฎโรงพยาบาล', technologyAndMedia: 'โทรศัพท์', languageStyle: 'ภาษาไทย', publicNorms: ['คุยเรื่องงาน'], institutions: ['โรงพยาบาล'], tensions: [], currentPublicEvents: [] });
    if (options.quietName === 'TMRW Phone Activity') return JSON.stringify({ conversations: [
      { ownerKey: 'owner-1', contact: 'เฮคเตอร์ โลคาซันเดอร์', messages: [{ sender: 'contact', text: 'นี่คือตัวผู้เล่น' }, { sender: 'owner', text: 'ไม่ควรเป็น NPC' }] },
      { ownerKey: 'owner-1', contact: 'พยาบาลเวรบ่าย', messages: [{ sender: 'contact', text: 'มีรายงานใหม่' }, { sender: 'owner', text: 'ส่งมา' }] },
    ], lives: [] });
    throw new Error('unexpected prompt');
  } };
  const pulse = new AdaptiveWorldPulseService({ database: c.database, socialService: c.social, messageService: c.messages, settingsService: c.settings, getContext: () => context });
  await pulse.primePhoneActivity({ scope: c.scope, playerInstanceId: c.user.instanceId, deviceIds: [c.alice.deviceId], fingerprint: 'old-generic-player-name' });
  await c.overrides.grant({ scope: c.scope, deviceId: c.alice.deviceId, action: 'inspect', playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId });
  const view = await c.viewModels.selected({ scope: c.scope, deviceId: c.alice.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, playerDisplayName: 'เฮคเตอร์', route: 'messages', controller: c.controller });
  assert.equal(view.threadRows.some(row => row.label.includes('เฮคเตอร์')), false);
  assert.equal(view.threadRows.some(row => row.label.includes('พยาบาลเวรบ่าย')), true);
});
