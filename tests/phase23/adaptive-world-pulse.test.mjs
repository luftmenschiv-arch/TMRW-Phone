import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase15, postFrom, commentFrom } from '../phase15/social-fixtures.mjs';
import { AdaptiveWorldPulseService } from '../../application/playable-bootstrap/adaptive-world-pulse.mjs';

const feedBatch = () => ({ posts:Array.from({length:9},(_,index)=>({ author:`คนงานเขตเหนือ ${index+1}`, text:`ประกาศตลาดแรงงานครึ่งสัตว์ฉบับที่ ${index+1} กำลังถูกวิจารณ์เรื่องค่าธรรมเนียม`, likes:3, comments:[{author:'เสมียนตลาดกลาง',text:'กฎใหม่นี้กระทบทั้งนายหน้าและครอบครัวผู้ซื้อโดยตรง'},{author:'คนส่งข่าวประจำตรอก',text:'ฝั่งประตูเหนือเริ่มตรวจเอกสารเข้มขึ้นแล้ว'}] })) });

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
