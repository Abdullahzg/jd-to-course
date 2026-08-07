import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const S=process.argv[2];
const jd=readFileSync('/tmp/jd.txt','utf8');
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});
await p.waitForTimeout(1500);
await p.screenshot({path:`${S}/shots/70-landing.png`});
await p.getByRole('link',{name:/^Start/}).click();
await p.waitForURL('**/start'); await p.waitForTimeout(1200);
for (let i=0;i<4;i++){ await p.getByRole('button',{name:'Next',exact:true}).click(); await p.waitForTimeout(400); }
await p.getByPlaceholder(/Paste the whole posting/i).fill(jd);
await p.waitForTimeout(300);
await p.getByRole('button',{name:/Build my plan/i}).click();
await p.waitForURL('**/plan',{timeout:300000});
await p.waitForTimeout(11000);
await p.screenshot({path:`${S}/shots/71-plan.png`,fullPage:true});
// open both proofs
const pr=p.getByRole('group').first();
const s1=p.locator('summary',{hasText:/Proof it teaches/}).first();
if(await s1.count()){ await s1.scrollIntoViewIfNeeded(); await s1.click(); await p.waitForTimeout(400); }
const s2=p.locator('summary',{hasText:/Proof this counts/}).first();
if(await s2.count()){ await s2.click(); await p.waitForTimeout(400); }
await p.screenshot({path:`${S}/shots/72-proof.png`,fullPage:true});
console.log(errs.length?errs.join('\n'):'no errors');
await b.close();
