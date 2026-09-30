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
          id: "party", q: "At a house party, you’re…",
          options: [
            { t: "Telling a story to a group", s: { vaclav: 2, petra: 1 } },
            { t: "Deep in a one-on-one conversation", s: { eva: 2, tomas: 1 } },
            { t: "Wandering off to explore the house", s: { milan: 2, vera: 2 } }
          ]
        },
        {
          id: "editor", q: "Your editor tells you that a few lines in your article are too sensitive to publish. You…",
          options: [
            { t: "Rewrite them cleverly, keeping the meaning intact for readers who know how to read between the lines.", s: { eva: 2, vaclav: 1 } },
            { t: "Persuade your editor that removing those lines would compromise the integrity of the article.", s: { vera: 2, milan: 1, petra: 1 } },
            { t: "Remove them from the published version, then quietly circulate the uncensored version to people you trust.", s: { tomas: 2, petra: 1 } }
          ]
        },
        {
          id: "sunday", q: "One thing that a relaxing Sunday would include:",
          options: [
            { t: "A new exhibition", s: { eva: 2 } },
            { t: "A gathering of like-minded friends", s: { petra: 2 } },
            { t: "A long walk through a quiet park", s: { milan: 2 } },
            { t: "A loud, smoky cellar club", s: { vera: 2, milan: 2 } },
            { t: "A park bench and a notebook", s: { vaclav: 2, tomas: 2 } }
          ]
        },
        {
          id: "brainstorm", q: "When a group is in a brainstorming session, you’re most likely to…",
          options: [
            { t: "Come up with the initial idea and shape the direction.", s: { petra: 2, vera: 1 } },
            { t: "Think through how the idea would actually work in practice.", s: { tomas: 2, vaclav: 1 } },
            { t: "Challenge the group’s assumptions and point out what might go wrong.", s: { milan: 2, eva: 1 } }
          ]
        },
        {
          id: "uncertain", q: "When the outcome is uncertain, you’re more likely to…",
          options: [
            { t: "Act first and adapt.", s: { vera: 2, petra: 2, vaclav: 2 } },
            { t: "Weigh the risks carefully.", s: { tomas: 2 } },
            { t: "Wait until you know more.", s: { eva: 2 } }
          ]
        }
      ]
    }
  }
};
