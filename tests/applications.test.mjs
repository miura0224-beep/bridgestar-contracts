import test from 'node:test';import assert from 'node:assert/strict';
const base='http://127.0.0.1:8792';
function client(){let cookie='';return {async req(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()}}}}
await test('Parent application intake and atomic office conversion',async()=>{
 const owner=client(),parent=client(),outsider=client();await owner.req('/dev/login',{email:'owner@example.test'});
 const created=await owner.req('/admin/applications',{name:'申込 テスト保護者',email:'intake@example.test'});assert.equal(created.status,201);
 assert.equal((await outsider.req('/admin/applications')).status,403);
 assert.equal((await parent.req('/apply/form')).status,401);
 await parent.req('/apply/exchange',{token:created.data.link.split('#')[1]});
 assert.equal((await parent.req('/apply/form')).status,401);
 const challenge=await parent.req('/apply/code',{});const mail=(await owner.req('/admin/outbox')).data.find(m=>m.recipient==='intake@example.test'&&m.subject.includes('確認コード'));
 const code=mail.body.match(/確認コード：(\d{6})/)[1];
 assert.equal((await parent.req('/apply/verify',{challengeId:challenge.data.challengeId,code})).status,200);
 const input={kind:'student',partyName:'申込 保護者',partyEmail:'hacker@example.test',studentName:'申込 生徒',school:'サンプル中学',grade:'中1',address:'東京都テスト1',phone:'09000000000',startDate:'2026-10-20',planId:'b',reading:true,privacy:true,notContract:true,studentEmail:'student@example.test',studentKana:'モウシコミ セイト',guardianKana:'モウシコミ ホゴシャ',studentAddress:'東京都テスト1'};
 assert.equal((await parent.req('/apply/submit',{...input,privacy:false})).status,400);
 assert.equal((await parent.req('/apply/submit',input)).status,200);
 assert.equal((await parent.req('/apply/submit',input)).status,200);
 assert.equal((await parent.req('/apply/submit',{...input,planId:'c'})).status,409);
 const list=(await owner.req('/admin/applications')).data;const a=list.find(a=>a.id===created.data.id);const p=JSON.parse(a.payload);assert.equal(p.partyEmail,'intake@example.test');assert.equal(a.status,'submitted');
 const contract={...p,title:'【架空】申込から契約作成',templateId:'demo-student',assignedTo:'owner@example.test',endDate:'2027-03-31',applicationId:a.id};
 const results=await Promise.all([owner.req('/admin/contracts',contract),owner.req('/admin/contracts',contract)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const made=results.find(r=>r.status===201).data;assert.equal(made.status,'draft');assert.ok(made.body.includes('PLAN B'));assert.ok(made.body.includes('2026-10-20'));
 assert.equal((await parent.req('/apply/form')).data.status,'converted');
 const another=await owner.req('/admin/applications',{name:'取消 テスト',email:'revoke-intake@example.test'});await owner.req('/admin/applications/'+another.data.id+'/revoke',{});
 assert.equal((await outsider.req('/apply/exchange',{token:another.data.link.split('#')[1]})).status,410);
});
