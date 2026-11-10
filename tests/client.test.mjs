import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStarpostServer } from 'cortico-world-starpost/server/server.mjs';
const packageRoot = process.env.STARPOST_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
const plugin = await import(pathToFileURL(join(packageRoot,'src/index.mjs')));

// DSH_TEST_MODULES points at node_modules containing the official matching loop and testkit.
const modules = process.env.DSH_TEST_MODULES || fileURLToPath(new URL('../node_modules/', import.meta.url));
const dependency = async name => {
  const require = createRequire(join(resolve(modules),'../package.json'));
  return import(pathToFileURL(require.resolve('@deepseek-ai/'+name)));
};
test('two isolated accounts, a real DSH agent, message boundaries, replies and session isolation', {timeout:45000}, async () => {
  assert(modules,'set DSH_TEST_MODULES to the test runtime node_modules');
  const [{Context},{mountAgentLoopTestDependencies},{default:Loop},{LlmAdapter}] = await Promise.all([
    dependency('cordis'),dependency('dsh-agent-loop-testkit'),dependency('dsh-agent-loop'),dependency('dsh-llm')]);
  const dir = mkdtempSync(join(tmpdir(),'dsh-starpost-'));
  const ctx = new Context(), requests = [];
  const sessionId=randomUUID(), peerToken='p'.repeat(32);
  const mail=[];
  const relay=createStarpostServer({file:join(dir,'relay.json'),keys:{10001:peerToken},port:0,sendMail:async msg=>mail.push(msg),clock:()=>Date.parse('2026-11-07T18:00:00+08:00')});
  const oldHome=process.env.STARPOST_DSH_HOME;
  process.env.STARPOST_DSH_HOME=join(dir,'agent');
  let fork;
  try {
    await relay.listen();
    const server='http://127.0.0.1:'+relay.server.address().port;
    const cli=(args,home=process.env.STARPOST_DSH_HOME)=>promisify(execFile)(process.execPath,[join(packageRoot,'src/account.mjs'),...args],{env:{...process.env,STARPOST_DSH_HOME:home}});
    const who=JSON.parse((await cli(['register','--session',sessionId,'--server',server])).stdout);
    assert.equal(who.registered,true);
    const restored=JSON.parse((await cli(['login','--file',who.credentialFile,'--session',randomUUID(),'--server',server],join(dir,'restore'))).stdout);
    assert.equal(restored.botId,who.botId);
    const secret=JSON.parse(readFileSync(who.credentialFile)).token;
    assert(!JSON.stringify(who).includes(secret));
    relay.store.befriend(who.botId,'10001');
    await mountAgentLoopTestDependencies(ctx);
    const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=','base64');
    let imageSaved=false;
    ctx.provide('attachments',{async saveImage(input) {
      assert.deepEqual(Buffer.from(input.data),pixel); imageSaved=true;
      return {attachmentId:'test-image',mediaType:'image/png',bytes:pixel.length,width:1,height:1};
    }});
    class OfflineModel extends LlmAdapter {
      async *stream(request) { requests.push(request.messages); yield {type:'finish',reason:'stop'}; }
    }
    ctx.llm.registerAdapter(['test'],new OfflineModel());
    await ctx.plugin(Loop,{agents:[]});
    fork=ctx.plugin(plugin); await fork;
    const agent=await ctx.agentLoop.create(sessionId,{provider:'test',model:'offline'});
    const other=await ctx.agentLoop.create(randomUUID(),{provider:'test',model:'offline'});
    const call=async(actor,family,action,payload={})=>{
      const input={agent:actor,callId:randomUUID(),signal:AbortSignal.timeout(10000),name:'starpost_use',arguments:{family,action,argsJson:JSON.stringify(payload)}};
      const result=await ctx.tools.execute({...input,calls:[{type:'tool-call',id:input.callId,name:input.name,arguments:JSON.stringify(input.arguments)}]});
      return result.results?.[0].result ?? result;
    };
    const ok=async x=>{const v=await x;assert.equal(v.isError,false,JSON.stringify(v.content));return v;};
    const rule=await ok(call(agent,'werewolf','rules'));
    assert.equal(JSON.parse(rule.value).dailyLimit,5);
    const versions=JSON.parse((await ok(call(agent,'client','status'))).value);
    assert.equal(versions.pluginVersion,who.pluginVersion);
    assert.equal(versions.coreVersion,createRequire(import.meta.url)('cortico-world-starpost/package.json').version);
    assert.equal((await call(other,'mobile','send',{text:'wrong session'})).isError,true);
    await ok(call(agent,'send','send',{kind:'private',target:'10001',text:'来自 Harness 的私聊'}));
    const peer=async(action,args={})=>{const r=await fetch(server+'/rpc',{method:'POST',headers:{'content-type':'application/json','x-starpost-id':'10001',authorization:'Bearer '+peerToken},body:JSON.stringify({action,args})});const v=await r.json();assert(v.ok,v.error);return v.result;};
    assert((await peer('snapshot')).messages.some(m=>m.text==='来自 Harness 的私聊'));
    const group=JSON.parse((await ok(call(agent,'group','create',{name:'隔离测试群',members:['10001']}))).value);
    await ok(call(agent,'send','send',{kind:'group',target:group.id,text:'来自 Harness 的群聊'}));
    assert((await peer('chat.history',{kind:'group',target:group.id})).messages.some(m=>m.text==='来自 Harness 的群聊'));
    await peer('message.send',{kind:'private',target:who.botId,text:'这条外来消息只属于指定会话'});
    const history=await ok(call(agent,'history','read',{kind:'private',target:'10001'}));
    assert(JSON.stringify(history).includes('这条外来消息只属于指定会话'));
    const profile=await ok(call(agent,'profile','read',{botId:'10001',section:'basic'}));
    assert(profile.additionalContexts.some(m=>m.source.kind===plugin.name && m.source.form==='relay'));
    await ok(call(agent,'mobile','send',{text:'主人专属回复'}));
    assert.equal(relay.store.list('ownerMessages','owner=?',[who.botId])[0].text,'主人专属回复');
    // The owner channel interrupts the normal batching window, using native DSH delivery.
    const mobile=async(path,body,token)=>{
      const r=await fetch(server+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
      const v=await r.json();assert(v.ok,v.error);return v.result;
    };
    const email='harness-test@example.com';
    const challenge=await mobile('/mobile/auth',{action:'code',purpose:'register',email});
    const human=await mobile('/mobile/auth',{action:'register',email,password:'isolated-test-only-123',nickname:'测试主人',challengeId:challenge.challengeId,code:mail.at(-1).code});
    await mobile('/mobile/rpc',{action:'account.bind',args:{botId:who.botId,credential:secret}},human.accessToken);
    await mobile('/mobile/rpc',{action:'owner.address',args:{address:'主人'}},human.accessToken);
    const humanRpc=(action,args)=>mobile('/mobile/rpc',{action,args},human.accessToken);
    const baseline=await humanRpc('owner.notifications',{includeChats:true});
    relay.store.saveGroup({...group,members:[...group.members,human.humanId]});
    await humanRpc('chat.preferences',{kind:'group',target:group.id,muted:true});
    await ok(call(agent,'send','send',{kind:'group',target:group.id,text:'群内普通消息'}));
    await ok(call(agent,'send','send',{kind:'group',target:group.id,text:'给你的提醒',mentions:[human.humanId]}));
    await ok(call(agent,'mobile','send',{text:'来自 DSH 的专属消息提醒'}));
    const notices=await humanRpc('owner.notifications',{includeChats:true,chatCursor:baseline.cursor});
    assert.deepEqual(notices.items.map(n=>[n.kind,n.target,n.mentioned]),[['group',group.id,true],['owner',who.botId,false]]);
    await mobile('/mobile/rpc',{action:'owner.send',args:{text:'通知边界验证',image:{mime:'image/png',base64:pixel.toString('base64')}}},human.accessToken);
    const until=Date.now()+12000;
    while (!JSON.stringify(requests).includes('通知边界验证') && Date.now()<until) await new Promise(r=>setTimeout(r,80));
    assert(JSON.stringify(requests).includes('通知边界验证'),'bound DSH agent did not receive the owner message');
    assert(requests.flat().some(m=>m.source?.kind===plugin.name&&m.source?.form==='relay'&&JSON.stringify(m.content).includes('通知边界验证')));
    assert(imageSaved && requests.flat().some(m=>m.content.some(b=>b.type==='image'&&b.attachment.attachmentId==='test-image')));
    assert(!JSON.stringify(requests).includes(secret));
  } finally {
    try { await fork?.dispose(); } finally {
      try { await ctx.fiber.dispose(); } finally { await relay.close(); }
      if(oldHome===undefined)delete process.env.STARPOST_DSH_HOME;else process.env.STARPOST_DSH_HOME=oldHome;
      rmSync(dir,{recursive:true,force:true});
    }
  }
});
