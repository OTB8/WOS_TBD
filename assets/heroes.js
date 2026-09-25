/* =====================================================================
   HERO CATALOG — every hero currently in Whiteout Survival.
   ---------------------------------------------------------------------
   gen 0  = Rare / Epic heroes (always available, shown only in the
            avatar picker, not in the Edit Heroes roster)
   gen 1+ = Generation (Mythic/SSR) heroes

   Your state does not have every generation yet. The site-wide
   "Active hero gen" setting (Admin / Master) decides which gens are
   unlocked; anything above it is shown greyed out and cannot be edited.

   WHEN A NEW GEN IS ANNOUNCED
   1. Add three lines below (id must be lowercase, no spaces).
   2. Drop a square portrait into images/heroes/<id>.webp
      (192x192 WebP, ~6 KB — see PERFORMANCE_PLAN.md).
   3. Bump CACHE_VERSION in sw.js so every browser picks it up.
   4. When your state actually unlocks it, raise the active gen on the site.
   ===================================================================== */
window.HERO_CATALOG = [
  // ---- Gen 0: Rare ----
  {id:'smith',      name:"Smith",       faction:'Infantry', gen:0, rarity:'Rare'},
  {id:'eugene',     name:"Eugene",      faction:'Infantry', gen:0, rarity:'Rare'},
  {id:'charlie',    name:"Charlie",     faction:'Lancer',   gen:0, rarity:'Rare'},
  {id:'cloris',     name:"Cloris",      faction:'Marksman', gen:0, rarity:'Rare'},
  // ---- Gen 0: Epic ----
  {id:'sergey',     name:"Sergey",      faction:'Infantry', gen:0, rarity:'Epic'},
  {id:'jessie',     name:"Jessie",      faction:'Lancer',   gen:0, rarity:'Epic'},
  {id:'patrick',    name:"Patrick",     faction:'Lancer',   gen:0, rarity:'Epic'},
  {id:'lumak_bokan',name:"Lumak Bokan", faction:'Lancer',   gen:0, rarity:'Epic'},
  {id:'ling_xue',   name:"Ling Xue",    faction:'Lancer',   gen:0, rarity:'Epic'},
  {id:'gina',       name:"Gina",        faction:'Marksman', gen:0, rarity:'Epic'},
  {id:'bahiti',     name:"Bahiti",      faction:'Marksman', gen:0, rarity:'Epic'},
  {id:'jasser',     name:"Jasser",      faction:'Marksman', gen:0, rarity:'Epic'},
  {id:'seo_yoon',   name:"Seo-yoon",    faction:'Marksman', gen:0, rarity:'Epic'},

  // ---- Generation heroes ----
  {id:'jeronimo',name:"Jeronimo",faction:'Infantry',gen:1},
  {id:'natalia', name:"Natalia", faction:'Infantry',gen:1},
  {id:'molly',   name:"Molly",   faction:'Lancer',  gen:1},
  {id:'zinman',  name:"Zinman",  faction:'Marksman',gen:1},
  {id:'flint',   name:"Flint",   faction:'Infantry',gen:2},
  {id:'philly',  name:"Philly",  faction:'Lancer',  gen:2},
  {id:'alonso',  name:"Alonso",  faction:'Marksman',gen:2},
  {id:'logan',   name:"Logan",   faction:'Infantry',gen:3},
  {id:'mia',     name:"Mia",     faction:'Lancer',  gen:3},
  {id:'greg',    name:"Greg",    faction:'Marksman',gen:3},
  {id:'ahmose',  name:"Ahmose",  faction:'Infantry',gen:4},
  {id:'reina',   name:"Reina",   faction:'Lancer',  gen:4},
  {id:'lynn',    name:"Lynn",    faction:'Marksman',gen:4},
  {id:'hector',  name:"Hector",  faction:'Infantry',gen:5},
  {id:'norah',   name:"Norah",   faction:'Lancer',  gen:5},
  {id:'gwen',    name:"Gwen",    faction:'Marksman',gen:5},
  {id:'wu_ming', name:"Wu Ming", faction:'Infantry',gen:6},
  {id:'renee',   name:"Renee",   faction:'Lancer',  gen:6},
  {id:'wayne',   name:"Wayne",   faction:'Marksman',gen:6},
  {id:'edith',   name:"Edith",   faction:'Infantry',gen:7},
  {id:'gordon',  name:"Gordon",  faction:'Lancer',  gen:7},
  {id:'bradley', name:"Bradley", faction:'Marksman',gen:7},
  {id:'gatot',   name:"Gatot",   faction:'Infantry',gen:8},
  {id:'sonya',   name:"Sonya",   faction:'Lancer',  gen:8},
  {id:'hendrik', name:"Hendrik", faction:'Marksman',gen:8},
  {id:'magnus',  name:"Magnus",  faction:'Infantry',gen:9},
  {id:'fred',    name:"Fred",    faction:'Lancer',  gen:9},
  {id:'xura',    name:"Xura",    faction:'Marksman',gen:9},
  {id:'gregory', name:"Gregory", faction:'Infantry',gen:10},
  {id:'freya',   name:"Freya",   faction:'Lancer',  gen:10},
  {id:'blanchette',name:"Blanchette",faction:'Marksman',gen:10},
  {id:'eleonora',name:"Eleonora",faction:'Infantry',gen:11},
  {id:'lloyd',   name:"Lloyd",   faction:'Lancer',  gen:11},
  {id:'rufus',   name:"Rufus",   faction:'Marksman',gen:11},
  {id:'hervor',  name:"Hervor",  faction:'Infantry',gen:12},
  {id:'karol',   name:"Karol",   faction:'Lancer',  gen:12},
  {id:'ligeia',  name:"Ligeia",  faction:'Marksman',gen:12},
  {id:'gisela',  name:"Gisela",  faction:'Infantry',gen:13},
  {id:'flora',   name:"Flora",   faction:'Lancer',  gen:13},
  {id:'vulcanus',name:"Vulcanus",faction:'Marksman',gen:13},
  {id:'elif',    name:"Elif",    faction:'Infantry',gen:14},
  {id:'dominic', name:"Dominic", faction:'Lancer',  gen:14},
  {id:'cara',    name:"Cara",    faction:'Marksman',gen:14},
  {id:'hank',    name:"Hank",    faction:'Infantry',gen:15},
  {id:'estrella',name:"Estrella",faction:'Lancer',  gen:15},
  {id:'viveca',  name:"Viveca",  faction:'Marksman',gen:15},
  {id:'seigel',  name:"Seigel",  faction:'Infantry',gen:16},
  {id:'ursar',   name:"Ursar",   faction:'Lancer',  gen:16},
  {id:'aisling', name:"Aisling", faction:'Marksman',gen:16},
  {id:'aiden',   name:"Aiden",   faction:'Infantry',gen:17},
  {id:'bertha',  name:"Bertha",  faction:'Lancer',  gen:17},
  {id:'eleanor', name:"Eleanor", faction:'Marksman',gen:17}
].map(h => Object.assign({ icon: h.id + '.webp', rarity: 'Mythic' }, h));

// Highest generation that exists in the game right now (from the list above).
window.HERO_MAX_GEN = Math.max.apply(null, window.HERO_CATALOG.map(h => h.gen));

// Default active gen until an Admin saves one to the Settings sheet.
window.HERO_DEFAULT_ACTIVE_GEN = 14;
