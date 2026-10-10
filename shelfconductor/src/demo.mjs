// SPDX-License-Identifier: MIT
// All entries are invented fixture data, NEVER presented as Qloo entities.
export const inventory=[
  {sku:'DEMO-001',title:'River of Glass',author:'Demo Writer One',category:'Literary',price_cents:1699,stock:5,qloo_id:'synthetic:demo:book1',shelf_note:'Staff pick: vivid prose'},
  {sku:'DEMO-002',title:'The Clockwork Orchard',author:'Demo Writer Two',category:'Fantasy',price_cents:2299,stock:2,qloo_id:'synthetic:demo:book2',shelf_note:'A playful quest'},
  {sku:'DEMO-003',title:'Atlas of Small Gardens',author:'Demo Writer Three',category:'Nature',price_cents:1899,stock:3,qloo_id:'synthetic:demo:book3',shelf_note:'Illustrated how-to'},
  {sku:'DEMO-004',title:'Tomorrow at the Harbor',author:'Demo Writer Four',category:'Literary',price_cents:1299,stock:1,qloo_id:'synthetic:demo:book4',shelf_note:'Short contemporary fiction'},
  {sku:'DEMO-005',title:'The Invisible Observatory',author:'Demo Writer Five',category:'Science',price_cents:2499,stock:0,qloo_id:'synthetic:demo:book5',shelf_note:'Out of stock'},
  {sku:'DEMO-006',title:'Letters from a Trail',author:'Demo Writer Six',category:'Travel',price_cents:1399,stock:1,qloo_id:'synthetic:demo:book6',shelf_note:'Quiet journeys'}
];
export const insights={success:true,results:{entities:[1,2,3,4,5,6].map(n=>({entity_id:`synthetic:demo:book${n}`,name:inventory[n-1].title}))}};
