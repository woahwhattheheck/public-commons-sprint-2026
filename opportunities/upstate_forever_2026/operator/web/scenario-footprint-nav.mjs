const add=()=>{
 if(document.querySelector('[data-scenario-footprint-link],a[href*="scenario-footprint.html"]'))return;
 const nav=document.querySelector('nav');if(!nav)return;
 const button=document.createElement('button');button.type='button';button.textContent='Scenario footprint';
 button.dataset.scenarioFootprintLink='1';button.addEventListener('click',()=>location.assign('/web/scenario-footprint.html'));
 const footer=nav.querySelector('.sidebar-footer');if(footer)nav.insertBefore(button,footer);else nav.append(button);
};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();
