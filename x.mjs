import { chromium } from 'playwright';
const S=process.argv[2];
const b=await chromium.launch();
for (const [w,h,tag] of [[1440,900,'desktop'],[1440,720,'short']]) {
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
  await p.goto('http://localhost:3000/',{waitUntil:'networkidle'});
  await p.waitForTimeout(1600);
  const s1=await p.evaluate(()=>({doc:document.documentElement.scrollHeight,win:window.innerHeight}));
  await p.screenshot({path:`${S}/shots/60-landing-${tag}.png`});
  console.log(`${tag} landing: doc=${s1.doc} win=${s1.win} scrolls=${s1.doc>s1.win+1}`);
  await p.goto('http://localhost:3000/start',{waitUntil:'networkidle'});
  await p.waitForTimeout(1200);
  for (let i=0;i<5;i++){
    const st=await p.evaluate(()=>({doc:document.documentElement.scrollHeight,win:window.innerHeight}));
    console.log(`  ${tag} step ${i+1}: scrolls=${st.doc>st.win+1} (${st.doc} vs ${st.win})`);
    await p.screenshot({path:`${S}/shots/61-${tag}-step${i+1}.png`});
    if(i<4){ await p.getByRole('button',{name:'Next',exact:true}).click(); await p.waitForTimeout(450); }
  }
  await p.close();
}
await b.close();
