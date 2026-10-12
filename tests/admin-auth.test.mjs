import test from 'node:test';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:8792';
async function req(path,body,cookie='') { const r=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}; }
await test('Admin email authentication: one-time code, replay and logout',async()=>{
 const demo=await req('/dev/login',{email:'owner@example.test'});
 const challenge=await req('/auth/request',{email:'viewer@example.test'});
 assert.equal(challenge.status,200);
 const out=await req('/admin/outbox',undefined,demo.cookie);
 const message=out.body.find(m=>m.recipient==='viewer@example.test' && m.subject.includes('ログイン'));
 const code=message.body.match(/確認コード：(\d{8})/)[1];
 assert.equal((await req('/auth/verify',{challenge:challenge.body.challenge,code:code==='00000000'?'11111111':'00000000'})).status,401);
 const verified=await req('/auth/verify',{challenge:challenge.body.challenge,code});
 assert.equal(verified.status,200);
 assert.equal((await req('/admin/me',undefined,verified.cookie)).body.role,'viewer');
 assert.equal((await req('/auth/verify',{challenge:challenge.body.challenge,code})).status,401);
 await req('/admin/logout',{},verified.cookie);
 assert.equal((await req('/admin/me',undefined,verified.cookie)).status,403);
 const unknown=await req('/auth/request',{email:'unregistered@example.test'});
 assert.equal(unknown.status,200);
 assert.equal((await req('/auth/verify',{challenge:unknown.body.challenge,code:'12345678'})).status,401);
});
