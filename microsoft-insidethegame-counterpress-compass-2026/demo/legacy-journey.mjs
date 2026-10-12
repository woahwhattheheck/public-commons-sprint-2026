/** Original seeded-match player demonstration. */
export function legacyJourney(){return {duration:110,async run(runtime){
  const {page,scene,trace,wait}=runtime;
  await scene(0,'Counterpress Compass: turn possession losses into clear match moments.',async()=>{});
  await scene(6,'Choose a match situation and seed. Every viewer has an independent session.',async()=>{
    await page.locator('#scenario').selectOption('high-press');
    await page.locator('#seed').fill('2026');await page.locator('#kickoff').click();
    await page.locator('#speed').selectOption('4');
  });
  await scene(13,'Follow the synthetic match live: pressure, ball recovery, and the evolving story.',async()=>{await page.locator('#play').click();});
  await scene(28,'Pause and filter the key moments to the recoveries you want to understand.',async()=>{
    await page.locator('#play').click();
    await page.locator('#reviewFilter').selectOption('success');
    await page.locator('.moment-select').first().click();
  });
  await scene(40,'Inspect the recorded loss, pressure actions, and regain in their original event order.',async()=>{
    await page.locator('#review').scrollIntoViewIfNeeded();
    trace.push({selectedReview:await page.locator('#review').innerText(),buttonWidth:await page.locator('.moment-select').first().evaluate(e=>e.getBoundingClientRect().width)});
  });
  await scene(54,'Replay that outcome at its exact event. The explanation and pitch stay connected.',async()=>{
    const before=Number(await page.locator('#scrub').inputValue());
    await page.locator('.review-jump').click();
    await page.waitForFunction(previous=>Number(document.querySelector('#scrub').value)!==previous,before);
    await page.mouse.wheel(0,-1800);await wait(500);
  });
  await scene(66,'Switch from fan summary to analyst view while preserving the selected moment.',async()=>{await page.locator('#audience').selectOption('analyst');await wait(350);});
  await scene(77,'The same match facts and controls are available in English and Spanish.',async()=>{
    await page.locator('#locale').selectOption('es');await page.waitForFunction(()=>document.documentElement.lang==='es');
  });
  let saved;
  await scene(88,'Copy a match link containing the exact event, club, language, and audience view.',async()=>{
    await page.locator('#locale').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await wait(350);
    await page.locator('#share').click();
    await page.waitForFunction(()=>document.querySelector('#shareStatus').textContent.length>0);
    saved={clock:await page.locator('#clock').innerText(),progress:await page.locator('#progress').innerText(),url:page.url()};
  });
  await scene(98,'Reopen the link: the same moment returns, paused and ready to explore.',async()=>{
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#state').textContent==='PAUSED');
    const restored={clock:await page.locator('#clock').innerText(),progress:await page.locator('#progress').innerText(),url:page.url()};
    if(JSON.stringify(saved)!==JSON.stringify(restored))throw new Error('The real application did not restore the captured match');
    trace.push({saved,restored});
  });

}};}
