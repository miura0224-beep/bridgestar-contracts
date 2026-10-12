import test from 'node:test';import assert from 'node:assert/strict';import { contractInput, amounts, renderTerms } from '../src/domain.ts';
const base={kind:'student',title:'test',partyName:'保護者',partyEmail:'parent@example.test',templateId:'demo-student',assignedTo:'owner@example.test',startDate:'2026-10-01',endDate:'2027-03-31',studentName:'生徒',address:'東京都テスト1',phone:'09000000000',planId:'starter'};
await test('Billing: four-session monthly basis; no date-based initial invoice',()=>{
 for(const day of ['01','15','16','31']){const p=contractInput.parse({...base,startDate:'2026-10-'+day});assert.equal(amounts(p).monthly,32780);assert.equal(amounts(p).firstMonth,null);const body=renderTerms(p,'確認用規約');assert.match(body,/月4回/);assert.match(body,/請求書を別途送付/);assert.doesNotMatch(body,/半額|初月：/)}
 assert.equal(amounts(contractInput.parse({...base,planId:'reading-only',reading:true})).monthly,16280);
 assert.equal(amounts(contractInput.parse({...base,reading:true})).monthly,43780);
});
