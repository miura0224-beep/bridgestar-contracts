import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalMailHtml} from '../src/store.ts';
const base='http://127.0.0.1:8792';
function client(){let cookie='';return {async req(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};}}}
await test('Approval email: atomic request, scan safe, notification to creator only, replay safe',async()=>{
const office=client(),teacher=client(),guest=client();await office.req('/dev/login',{email:'editor@example.test'});await teacher.req('/dev/login',{email:'approver@example.test'});
const input={kind:'student',title:'【架空】メール承認検証',partyName:'テスト保護者',partyEmail:'parent-mail@example.test',templateId:'demo-student',assignedTo:'editor@example.test',startDate:'2026-11-01',endDate:'2027-03-31',studentName:'テスト生徒',school:'テスト中学校',grade:'中1',address:'東京都テスト1',phone:'09000000000',planId:'starter',reading:false};
const made=await office.req('/admin/contracts',input);assert.equal(made.status,201);let c=made.data;const action='/admin/contracts/'+c.id+'/action';
const outcomes=await Promise.all([office.req(action,{action:'review',version:c.version}),office.req(action,{action:'review',version:c.version})]);assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
let detail=(await office.req('/admin/contracts/'+c.id)).data;c=detail.contract;assert.equal(detail.mail.length,1);assert.equal(detail.mail[0].recipient,'approver@example.test');assert.match(detail.mail[0].subject,/承認依頼/);
await fetch(base+'/?view=approvals&id='+c.id);await fetch(base+'/?view=approvals&id='+c.id,{method:'HEAD'});assert.equal((await office.req('/admin/contracts/'+c.id)).data.contract.status,'review');assert.equal((await guest.req(action,{action:'approve',version:c.version})).status,403);
const results=await Promise.all([teacher.req(action,{action:'approve',version:c.version}),teacher.req(action,{action:'approve',version:c.version})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);detail=(await office.req('/admin/contracts/'+c.id)).data;assert.equal(detail.contract.status,'approved');assert.equal(detail.mail.length,2);const done=detail.mail.find(x=>x.subject.includes('完了'));assert.equal(done.recipient,'editor@example.test');assert.equal(detail.mail.some(x=>x.recipient===input.partyEmail),false);
assert.equal((await teacher.req(action,{action:'approve',version:detail.contract.version})).status,409);assert.equal((await office.req('/admin/contracts/'+c.id)).data.mail.length,2);
});
await test('Approval HTML escapes text and only links configured origin',()=>{
const subject='【ブリッジスター】入塾契約の承認依頼';const html=approvalMailHtml(base,subject,'<script>alert(1)</script>\n'+base+'/?view=approvals&id=abc');assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('href="'+base+'/?view=approvals&amp;id=abc"'));assert.equal(approvalMailHtml(base,subject,'https://evil.example/?contract=a'),undefined);assert.equal(approvalMailHtml(base,'normal email',base+'/?contract=a'),undefined);
});
