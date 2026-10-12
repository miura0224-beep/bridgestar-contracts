import {chromium} from '@playwright/test';
import fs from 'node:fs';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();let role='owner',self=false,status='review',version=1,calls=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
const p={studentName:'サンプル花子',school:'サンプル中学校',grade:'中1',partyName:'サンプル保護者',partyEmail:'parent@example.test',startDate:'2026-11-01',endDate:'2027-03-31',planId:'starter',reading:false,notes:'開始日は保護者と確認済み'};
const contract=()=>({id:'sample',kind:'student',title:'入塾契約',party_name:p.partyName,party_email:p.partyEmail,payload:JSON.stringify(p),body:'【テスト用契約】\n第1条 サービス内容\n通常月はコーチング月4回。\n初月は実施可能回数に応じ別途請求します。',status,version,created_by:self?'owner@example.test':'editor@example.test',application_id:'app1'});
await page.route('http://approval.test/**',async route=>{let u=new URL(route.request().url()),data;const path=u.pathname;
if(path==='/api/config')data={local:true,plans:[{id:'starter',name:'スタータープラン',net:29800}]};
else if(path==='/api/admin/me')data={role,email:'owner@example.test',name:'ユウキ先生'};
else if(path==='/api/admin/contracts')data=[contract()];
else if(path==='/api/admin/templates')data=[];
else if(path==='/api/admin/members')data=[{email:'editor@example.test',name:'事務局'}];
else if(path==='/api/admin/applications')data=[{id:'app1',payload:JSON.stringify(p)}];
else if(path==='/api/admin/contracts/sample')data={contract:contract()};
else if(path==='/api/admin/contracts/sample/action'){const body=route.request().postDataJSON();calls.push(body);assert.equal(body.version,version);status=body.action==='approve'?'approved':'draft';version++;data=contract();}
else if(path.startsWith('/api'))throw Error('Unexpected API '+path);
else {const file=path==='/'?'public/index.html':'public/'+path.slice(1);return route.fulfill({body:fs.readFileSync(file),contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'application/javascript':'text/html'});}
return route.fulfill({json:data});});
await page.goto('http://approval.test/?view=approvals');await page.getByRole('button',{name:'内容を確認する'}).click();await page.getByText('契約条件',{exact:true}).waitFor();
assert(await page.locator('#approval-submit').isDisabled());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:'qa/approval-mobile.png',fullPage:true});
await page.locator('#approval-confirm').check();await page.locator('#approval-submit').click();await page.getByText('承認済みです。事務局で署名依頼を送信してください。').waitFor();assert.deepEqual(calls.map(c=>c.action),['approve']);
status='review';await page.reload();await page.locator('#approval-return').click();assert.equal(calls.length,1);await page.locator('#approval-reason').fill('開始日の確認をお願いします');await page.locator('#approval-return').click();await page.getByText('現在の状態では承認操作はできません。').waitFor();assert.equal(calls[1].reason,'開始日の確認をお願いします');
status='review';self=true;await page.reload();await page.getByText('承認には、作成者とは別の管理責任者または承認担当のログインが必要です。').waitFor();assert.equal(await page.locator('#approval-submit').count(),0);
self=false;role='viewer';await page.reload();await page.getByText('承認には、作成者とは別の管理責任者または承認担当のログインが必要です。').waitFor();assert.equal(await page.locator('#approval-submit').count(),0);
await page.goto('http://approval.test/enrollment-admin.html');await page.getByRole('heading',{name:'契約内容を承認する'}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'qa/enrollment-admin-mobile.png',fullPage:true});assert.deepEqual(errors,[]);await browser.close();console.log('PASS: 390px overflow, direct link, confirmation gate, approve without send, return reason, creator/viewer restrictions, manual, no JS errors');
