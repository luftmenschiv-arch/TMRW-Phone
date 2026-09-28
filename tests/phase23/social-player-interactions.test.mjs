import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase15, postFrom } from '../phase15/social-fixtures.mjs';
import { AdaptiveWorldPulseService } from '../../application/playable-bootstrap/adaptive-world-pulse.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { TmrwPhoneShell as ProductionPhoneShell } from '../../v3/ui/shell.mjs';

const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
async function waitFor(predicate,label){for(let index=0;index<180;index+=1){if(await predicate())return;await settle();}throw new Error(`${label} did not settle`);}
function find(node,predicate){if(predicate(node))return node;for(const child of node?.children||[]){const hit=find(child,predicate);if(hit)return hit;}return null;}
function allText(node,out=[]){if(node?.textContent)out.push(String(node.textContent));for(const child of node?.children||[])allText(child,out);return out.join(' ');}
function input(node,value){node.value=value;for(const listener of node.listeners?.get?.('input')||[])listener({currentTarget:node});}

test('My Phone posts, likes, comments and receives live replies while Their Phone remains read-only',async()=>{
  const c=await setupPhase15({castSize:1,manifestId:'social-player-interactions'});let replyCalls=0;let modelCalls=0;let modelDone=false;let modelError='';
  const context={name2:'เจเรน',scenario:'เมืองตลาดทาสครึ่งสัตว์',chat:[],generateQuietPrompt:async options=>{if(options.quietName==='TMRW World Social Bible')return JSON.stringify({worldSummary:'เมืองตลาดทาสครึ่งสัตว์',socialOrder:'นายหน้าและแรงงาน',economyAndLaw:'ตลาดกลางควบคุมทะเบียน',technologyAndMedia:'โทรศัพท์',languageStyle:'ภาษาไทย',publicNorms:['ตรวจทะเบียน'],institutions:['ตลาดกลาง'],tensions:['ค่าธรรมเนียม'],currentPublicEvents:['ตลาดขึ้นค่าธรรมเนียม']});if(options.quietName==='TMRW Living Feed')return JSON.stringify({posts:Array.from({length:9},(_,index)=>({author:`ชาวตลาด ${index+1}`,text:`ข่าวตลาดหมายเลข ${index+1}`,likes:2,comments:[{author:'เสมียนตลาด',text:'รับทราบข่าวแล้ว'}]}))});if(options.quietName==='TMRW Social Replies'){replyCalls+=1;await replyGate;return JSON.stringify({replies:[{author:'เสมียนตลาด',text:'ฉันมาตอบให้แล้วทันที'}]});}return '{}';}};
  const pulse=new AdaptiveWorldPulseService({database:c.database,socialService:c.social,settingsService:c.settings,getContext:()=>context});await pulse.prime({scope:c.scope,minimum:1,playerInstanceId:c.user.instanceId});const targetPostId=(await c.social.listFeed({scope:c.scope,viewerAccountId:c.user.accountId,limit:5})).items[0].postId;const seeded=(await c.social.listComments({scope:c.scope,viewerAccountId:c.user.accountId,postId:targetPostId,limit:5})).items[0];const npc=await c.database.transaction(['accounts','instances'],'readonly',async transaction=>{const account=await transaction.store('accounts').get(seeded.authorAccountId);const instance=await transaction.store('instances').get(account.ownerInstanceId);return {account,instance};});
  const worldPulse={refresh:input=>pulse.refresh(input),respondToPlayerAction:async input=>{modelCalls+=1;replyCalls+=1;await new Promise(resolve=>setTimeout(resolve,80));try{const result=await c.social.createComment({scope:c.scope,postId:input.postId,parentCommentId:input.parentCommentId,authorAccountId:npc.account.id,actualAuthorActorId:npc.instance.actorId,actualAuthorInstanceId:npc.instance.id,deviceId:npc.account.deviceIds[0],text:'ฉันมาตอบให้แล้วทันที',source:{authority:'social-ui-test',kind:'test',recordId:`reply-${modelCalls}`,version:'1'},idempotencyKey:`reply-${modelCalls}`});input.onProgress?.({comment:result.comment,index:0,total:1});return {generated:1,comments:[result.comment]};}catch(error){modelError=error.message;throw error;}finally{modelDone=true;}}};const models=new PhoneShellViewModels({database:c.database,phoneStateService:c.phones,contactService:c.contacts,settingsService:c.settings,messageService:c.messages,callService:c.calls,socialService:c.social,adaptiveWorldPulseService:worldPulse});
  const shell=new TmrwPhoneShell({document:c.document,viewModels:models,controller:c.controller,messageService:c.messages,callService:c.calls,socialService:c.social,scope:c.scope,playerActorId:c.user.actorId,playerInstanceId:c.user.instanceId,selectedDeviceId:c.user.deviceId});await shell.mount(c.target);
  find(shell.root,node=>node.dataset?.action==='unlock').click();await waitFor(()=>find(shell.root,node=>node.dataset?.app==='insungram'),'home');find(shell.root,node=>node.dataset?.app==='insungram').click();await waitFor(()=>find(shell.root,node=>node.attributes?.get('aria-label')==='ฟีด'),'social');find(shell.root,node=>node.attributes?.get('aria-label')==='ฟีด').click();await waitFor(()=>shell.metrics.router==='feed'&&find(shell.root,node=>node.dataset?.action==='create-feed-post'),'feed');
  const like=find(shell.root,node=>node.dataset?.action==='toggle-feed-like');like.click();await waitFor(()=>find(shell.root,node=>node.dataset?.action==='toggle-feed-like')?.attributes?.get('aria-pressed')==='true','like');
  find(shell.root,node=>node.dataset?.action==='open-feed-comment').click();await waitFor(()=>find(shell.root,node=>node.dataset?.action==='submit-feed-comment'),'comment composer');const commentInput=find(shell.root,node=>node.attributes?.get('aria-label')==='ข้อความความคิดเห็น');input(commentInput,'ฉันขอถามเรื่องค่าธรรมเนียม');find(shell.root,node=>node.dataset?.action==='submit-feed-comment').click();
  await waitFor(()=>/ฉันขอถามเรื่องค่าธรรมเนียม/.test(allText(shell.root))&&/กำลังมีคนมาตอบ/.test(allText(shell.root)),'immediate comment');await waitFor(()=>modelDone,'reply model completion');assert.equal(modelError,'');await shell.renderActive();assert.match(allText(shell.root),/ฉันมาตอบให้แล้วทันที/);assert.equal(modelCalls,1);assert.equal(replyCalls,1);
  const replyButton=find(shell.root,node=>node.dataset?.action==='reply-feed-comment');replyButton.click();await waitFor(()=>find(shell.root,node=>node.attributes?.get('aria-label')==='ข้อความตอบกลับ'),'reply composer');const replyInput=find(shell.root,node=>node.attributes?.get('aria-label')==='ข้อความตอบกลับ');input(replyInput,'ตอบเจาะจงความคิดเห็นนี้');const replySubmit=find(shell.root,node=>node.dataset?.action==='submit-feed-comment');assert.equal(replySubmit.disabled,false);replySubmit.click();await waitFor(()=>/ตอบเจาะจงความคิดเห็นนี้/.test(allText(shell.root)),'nested reply commit');const nested=await c.social.listComments({scope:c.scope,viewerAccountId:c.user.accountId,postId:targetPostId,parentCommentId:seeded.commentId,limit:10});assert.equal(nested.items.some(row=>row.text==='ตอบเจาะจงความคิดเห็นนี้'),true);
  const main=find(shell.root,node=>String(node.className||'').includes('tmrw-phone-social-content'));main.scrollTop=500;find(shell.root,node=>node.dataset?.action==='refresh-feed').click();await waitFor(()=>/เพิ่ม 3 โพสต์ใหม่แล้ว/.test(allText(shell.root))&&find(shell.root,node=>String(node.className||'').includes('tmrw-phone-social-content'))?.scrollTop===0,'new feed notice');assert.ok(find(shell.root,node=>String(node.className||'').includes('tmrw-phone-post')&&String(node.className||'').includes('is-new')));
  await c.overrides.grant({scope:c.scope,deviceId:c.alice.deviceId,action:'inspect',playerActorId:c.user.actorId,playerInstanceId:c.user.instanceId});await shell.selectDevice(c.alice.deviceId);assert.equal(find(shell.root,node=>node.dataset?.action==='create-feed-post'),null);assert.equal(find(shell.root,node=>node.dataset?.action==='toggle-feed-like')?.disabled,true);
});

for (const [label, Shell] of [['source', TmrwPhoneShell], ['production', ProductionPhoneShell]]) {
  test(`${label} feed keeps post and comment drafts across redraws and failed sends`, async () => {
    const c = await setupPhase15({ castSize: 1, manifestId: `social-drafts-${label}` });
    const seeded = await postFrom(c, c.alice, { key: `draft-seed-${label}`, text: 'โพสต์สำหรับทดสอบร่าง' });
    let postAttempts = 0;
    let commentAttempts = 0;
    const social = {
      createPost: async request => { if (++postAttempts === 1) throw new Error('post unavailable'); return c.social.createPost(request); },
      createComment: async request => { if (++commentAttempts === 1) throw new Error('comment unavailable'); return c.social.createComment(request); },
      setEngagement: request => c.social.setEngagement(request),
    };
    const shell = new Shell({ document:c.document, viewModels:c.viewModels, controller:c.controller, messageService:c.messages, callService:c.calls, socialService:social, scope:c.scope, playerActorId:c.user.actorId, playerInstanceId:c.user.instanceId, selectedDeviceId:c.user.deviceId });
    await shell.mount(c.target);
    find(shell.root, node => node.dataset?.action === 'unlock').click();
    await waitFor(() => find(shell.root, node => node.dataset?.app === 'insungram'), 'draft home');
    find(shell.root, node => node.dataset?.app === 'insungram').click();
    await waitFor(() => find(shell.root, node => node.attributes?.get('aria-label') === 'ฟีด'), 'draft social');
    find(shell.root, node => node.attributes?.get('aria-label') === 'ฟีด').click();
    await waitFor(() => shell.metrics.router === 'feed' && find(shell.root, node => node.dataset?.action === 'create-feed-post'), 'draft feed');

    input(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความโพสต์'), 'ร่างโพสต์ยังอยู่');
    await shell.renderActive();
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความโพสต์').value, 'ร่างโพสต์ยังอยู่');
    assert.equal(find(shell.root, node => node.dataset?.action === 'create-feed-post').disabled, false);
    const article = find(shell.root, node => node.dataset?.postId === seeded.post.postId);
    find(article, node => node.dataset?.action === 'toggle-feed-like').click();
    await waitFor(() => find(shell.root, node => node.dataset?.postId === seeded.post.postId && find(node, child => child.dataset?.action === 'toggle-feed-like')?.attributes?.get('aria-pressed') === 'true'), 'draft like');
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความโพสต์').value, 'ร่างโพสต์ยังอยู่');

    find(shell.root, node => node.dataset?.action === 'create-feed-post').click();
    await waitFor(() => /post unavailable/.test(allText(shell.root)), 'failed post');
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความโพสต์').value, 'ร่างโพสต์ยังอยู่');
    assert.equal(find(shell.root, node => node.dataset?.action === 'create-feed-post').disabled, false);
    find(shell.root, node => node.dataset?.action === 'create-feed-post').click();
    await waitFor(() => postAttempts === 2 && find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความโพสต์')?.value === '', 'successful post retry');
    assert.equal((await c.social.listFeed({ scope:c.scope, viewerAccountId:c.user.accountId, limit:20 })).items.some(row => row.text === 'ร่างโพสต์ยังอยู่'), true);

    find(find(shell.root, node => node.dataset?.postId === seeded.post.postId), node => node.dataset?.action === 'open-feed-comment').click();
    await waitFor(() => find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น'), 'draft comment composer');
    input(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น'), 'ร่างคอมเมนต์ยังอยู่');
    await shell.renderActive();
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น').value, 'ร่างคอมเมนต์ยังอยู่');
    find(shell.root, node => node.dataset?.action === 'submit-feed-comment').click();
    await waitFor(() => /comment unavailable/.test(allText(shell.root)), 'failed comment');
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น').value, 'ร่างคอมเมนต์ยังอยู่');
    assert.equal(find(shell.root, node => node.dataset?.action === 'submit-feed-comment').disabled, false);
    find(shell.root, node => node.dataset?.action === 'submit-feed-comment').click();
    await waitFor(() => commentAttempts === 2 && !find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น'), 'successful comment retry');
    assert.equal((await c.social.listComments({ scope:c.scope, viewerAccountId:c.user.accountId, postId:seeded.post.postId, limit:20 })).items.some(row => row.text === 'ร่างคอมเมนต์ยังอยู่'), true);
    find(find(shell.root, node => node.dataset?.postId === seeded.post.postId), node => node.dataset?.action === 'open-feed-comment').click();
    await waitFor(() => find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น'), 'reopened comment composer');
    assert.equal(find(shell.root, node => node.attributes?.get('aria-label') === 'ข้อความความคิดเห็น').value, '');
  });
}
