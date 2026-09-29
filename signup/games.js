/* =========================================================
   Odeum signup — game configuration
   Everything specific to a game (cast, quiz, preview dates) lives here.
   The flow in signup.js is generic; ?game=<id> picks one (default: prague).
   ========================================================= */
window.ODEUM = {
  // Supabase project (see supabase/SETUP.md). The publishable key is public by design: it can only
  // call the database functions in supabase/schema.sql, never read tables directly.
  SUPABASE_URL: "https://xzeflephpasmmgaanomq.supabase.co",
  SUPABASE_KEY: "sb_publishable_n0g4us9InEgzPfOONxvGCQ_C9nTT8Ji",

  // Testing period: booking is free and confirms seats immediately; anyone can start a table on an
  // open night (you control which nights are open in the sheet's Dates tab).

  GAMES: {
    prague: {
      id: "prague",
      title: "Summertime in Prague",
      era: "Czechoslovakia, 1968",
      seats: 6,
      time: "6:00–11:00 PM", // default; a date in the sheet can override it
      place: "Upper West Side",

      // Game nights (sessions), the cast and seat counts live in the database; the cast below is
      // only a fallback while it loads. The quiz stays here for now.
      characters: [
        { id: "eva",    name: "Eva",    gender: "female", art: "../images/prague/cast/eva.jpg",    line: "Art & culture critic. Speaks three languages." },
        { id: "vaclav", name: "Vaclav", gender: "male",   art: "../images/prague/cast/vaclav.jpg", line: "Poet. Full of charm; the world is dreamier in his eyes." },
        { id: "milan",  name: "Milan",  gender: "male",   art: "../images/prague/cast/milan.jpg",  line: "Absurdist storyteller who wanders the city’s cemeteries." },
        { id: "vera",   name: "Vera",   gender: "female", art: "../images/prague/cast/vera.jpg",   line: "Rock-scene writer and drummer. Hard to approach at first." },
        { id: "tomas",  name: "Tomas",  gender: "male",   art: "../images/prague/cast/tomas.jpg",  line: "Literature teacher who sneaks banned books to students." },
        { id: "petra",  name: "Petra",  gender: "female", art: "../images/prague/cast/petra.jpg",  line: "Theatre director. “Small but mighty.”" }
      ],

      // In-game romantic pairings (used for pairing-comfort checks).
      couples: [["eva", "vaclav"], ["milan", "vera"], ["tomas", "petra"]],

      // PLACEHOLDER quiz — each option scores characters (2 = strong fit, 1 = some fit).
      quiz: [
        {
          id: "party", q: "At a party, you’re most likely to be…",
          options: [
            { t: "Holding court with a story", s: { vaclav: 2, petra: 1 } },
            { t: "Deep in a one-on-one debate", s: { eva: 2, tomas: 1 } },
            { t: "By the record player, choosing the music", s: { vera: 2 } },
            { t: "Wandering off to explore the house", s: { milan: 2 } }
          ]
        },
        {
          id: "censor", q: "A censor strikes your article. You…",
          options: [
            { t: "Rewrite it so cleverly it slips through", s: { eva: 2, milan: 1 } },
            { t: "Publish it anyway, consequences be damned", s: { vera: 2, petra: 1 } },
            { t: "Quietly pass copies to the people who need it", s: { tomas: 2 } },
            { t: "Turn the whole affair into a poem", s: { vaclav: 2, milan: 1 } }
          ]
        },
        {
          id: "sunday", q: "Your ideal Sunday in Prague:",
          options: [
            { t: "A new exhibition, then reviewing it over coffee", s: { eva: 2 } },
            { t: "Rehearsing with a small theatre troupe", s: { petra: 2 } },
            { t: "A long walk through Olšany Cemetery", s: { milan: 2 } },
            { t: "A loud, smoky cellar club", s: { vera: 2 } },
            { t: "A park bench and a notebook", s: { vaclav: 2 } },
            { t: "Tutoring a student who’s falling behind", s: { tomas: 2 } }
          ]
        },
        {
          id: "friends", q: "Your friends would describe you as…",
          options: [
            { t: "Sharp", s: { eva: 2, vera: 1 } },
            { t: "Charming", s: { vaclav: 2, petra: 1 } },
            { t: "Curious and a little strange", s: { milan: 2 } },
            { t: "Fiercely loyal", s: { vera: 2, tomas: 1 } },
            { t: "Steady and wise", s: { tomas: 2, eva: 1 } },
            { t: "Unstoppable", s: { petra: 2 } }
          ]
        },
        {
          id: "group", q: "When a group has to decide something, you…",
          options: [
            { t: "Take charge", s: { petra: 2, eva: 1 } },
            { t: "Find the compromise", s: { tomas: 2, vaclav: 1 } },
            { t: "Play devil’s advocate", s: { milan: 2, vera: 1 } }
          ]
        }
      ]
    }
  }
};
