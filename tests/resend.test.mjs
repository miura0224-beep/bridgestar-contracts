import test from 'node:test';
import assert from 'node:assert/strict';
const { flushMail }=await import('../src/store.ts');
const { encrypt }=await import('../src/security.ts');
await test('Resend outbox: local suppression, idempotency and failures',async()=>{
 const changes=[];let requests=[];const original=globalThis.fetch;
 const env={TOKEN_SECRET:'test'.repeat(16),ENVIRONMENT:'production',LIVE_SEND_ENABLED:'true',MAIL_FROM:'Test <test@example.test>',RESEND_API_KEY:'test-only'};
 const row={id:'outbox-fixture',recipient:'recipient@example.test',subject:'test',encrypted_body:await encrypt(env,'test body')};
 env.DB={prepare(sql){return {bind(...args){this.args=args;return this},async all(){return {results:[row]}},async run(){changes.push({sql,args:this.args});return {meta:{changes:1}}}}}};
 try {
  globalThis.fetch=async(url,opts)=>{requests.push({url,opts});return new Response(JSON.stringify({id:'provider-fixture'}),{status:200})};
  await flushMail({...env,ENVIRONMENT:'local'});assert.equal(requests.length,0);
  await flushMail(env);await flushMail(env);
  assert.equal(requests.length,2);assert.equal(requests[0].url,'https://api.resend.com/emails');
  assert.equal(requests[0].opts.headers['Idempotency-Key'],requests[1].opts.headers['Idempotency-Key']);
  assert.equal(JSON.parse(requests[0].opts.body).text,'test body');
  assert.ok(changes.some(x=>x.sql.includes("state='sent'")&&x.args.includes('provider-fixture')));
  globalThis.fetch=async()=>new Response('{}',{status:429});await flushMail(env);
  assert.ok(changes.some(x=>x.sql.includes("attempts>=5")));
 } finally {globalThis.fetch=original}
});
