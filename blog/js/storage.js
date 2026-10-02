/* ==========================================================================
   storage.js: everything that saves or loads data

   Two storage areas are used, each for what it's good at:

   - localStorage  -> the posts (small text). Synchronous and simple, but
                      limited to roughly 5 MB total.
   - IndexedDB     -> the images (big). Asynchronous, and holds much more.
                      A post only stores an image's KEY; the image data itself
                      lives here.

   Exposes one global object: BlogStorage.
   (It's not called "Storage" because the browser already has a built-in
   object with that name.)
   ========================================================================== */

const BlogStorage = (function () {

  const POSTS_KEY  = 'blog.posts';    // localStorage key holding the posts array
  const SEEDED_KEY = 'blog.seeded';   // remembers that sample posts were already added
  const DB_NAME    = 'blog-images-db';
  const STORE_NAME = 'images';

  // Image compression settings (from the project brief).
  const MAX_IMAGE_WIDTH = 1200;
  const JPEG_QUALITY    = 0.8;

  /* ======================================================================
     SECTION 1: small helpers
     ====================================================================== */

  // makeId(prefix): a unique-enough string like "img_lq3x9k_a8f2zq".
  // Time (base 36) + random characters. Fine for a personal blog.
  function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // parseTags("Verilog, FPGA ,fpga") -> ["verilog", "fpga"]
  // Splits on commas, trims spaces, lowercases (so "FPGA" and "fpga" match
  // when filtering) and removes duplicates and empties.
  function parseTags(input) {
    const list = Array.isArray(input) ? input : String(input || '').split(',');
    const seen = [];
    list.forEach(function (tag) {
      const clean = String(tag).trim().toLowerCase();
      if (clean && seen.indexOf(clean) === -1) seen.push(clean);
    });
    return seen;
  }

  // Finds every image key a post uses: its cover plus any inline images
  // written in the body as ![alt](local-image/KEY).
  function extractImageKeys(post) {
    const keys = [];
    if (post.coverImage) keys.push(post.coverImage);

    const pattern = /local-image\/([A-Za-z0-9_-]+)/g;
    let match;
    while ((match = pattern.exec(post.body || '')) !== null) {
      keys.push(match[1]);
    }
    return keys;
  }

  /* ======================================================================
     SECTION 2: posts in localStorage
     ====================================================================== */

  // readPosts(): load the raw posts array. If nothing is saved, or the saved
  // text is corrupted, return an empty list instead of crashing the whole app.
  function readPosts() {
    try {
      const raw = localStorage.getItem(POSTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('Could not read posts:', err);
      return [];
    }
  }

  // writePosts(posts): save the array. setItem throws when the browser's
  // storage is full (or blocked, e.g. private mode), so we catch that and
  // throw a friendlier message that app.js shows in a toast.
  function writePosts(posts) {
    try {
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    } catch (err) {
      console.error('Could not save posts:', err);
      throw new Error('Your browser storage is full or unavailable, so the post could not be saved. ' +
                      'Try exporting a backup and deleting old posts.');
    }
  }

  // getPosts(): all posts, newest first.
  function getPosts() {
    return readPosts().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  // getPost(id): one post, or undefined if the id doesn't exist.
  function getPost(id) {
    return readPosts().find(function (post) { return post.id === id; });
  }

  // savePost(data): creates a post (no data.id) or updates one (with data.id).
  // Returns the saved post.
  function savePost(data) {
    const posts = readPosts();
    const now = new Date().toISOString();
    let saved;

    if (data.id) {
      // UPDATE: replace the fields that can change, keep id and createdAt.
      const index = posts.findIndex(function (p) { return p.id === data.id; });
      if (index === -1) throw new Error('That post no longer exists.');

      saved = Object.assign({}, posts[index], {
        title: data.title,
        tags: parseTags(data.tags),
        body: data.body,
        coverImage: data.coverImage || null,
        updatedAt: now
      });
      posts[index] = saved;
    } else {
      // CREATE: brand-new post with a fresh id.
      saved = {
        id: makeId('post'),
        title: data.title,
        tags: parseTags(data.tags),
        body: data.body,
        coverImage: data.coverImage || null,
        createdAt: now,
        updatedAt: now
      };
      posts.push(saved);
    }

    writePosts(posts);
    return saved;
  }

  // deletePost(id): remove a post. Its images are cleaned up afterwards by
  // pruneUnusedImages(), which app.js calls.
  function deletePost(id) {
    const posts = readPosts().filter(function (p) { return p.id !== id; });
    writePosts(posts);
  }

  /* ======================================================================
     SECTION 3: images in IndexedDB
     IndexedDB uses callbacks ("events"). We wrap each operation in a
     Promise so the rest of the code can use async/await instead.
     ====================================================================== */

  let dbPromise = null;   // opened once, then reused
  const imageCache = {};  // key -> data URL, so we don't re-read the DB on every render

  // openDb(): opens (and on first run creates) the database.
  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('This browser does not support IndexedDB, so images cannot be stored.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);

      // Runs only the first time (or when the version number goes up).
      // This is where we create the "table" (object store). keyPath: 'key'
      // means each record is found by its `key` property.
      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        dbPromise = null; // allow a retry next time
        reject(new Error('Could not open the image database.'));
      };
    });
    return dbPromise;
  }

  // putImage(key, dataUrl): save or overwrite one image.
  async function putImage(key, dataUrl) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key: key, dataUrl: dataUrl });
      tx.oncomplete = function () { imageCache[key] = dataUrl; resolve(key); };
      // An abort usually means the disk quota was exceeded.
      tx.onabort = tx.onerror = function () {
        reject(new Error('The image could not be stored. Browser storage may be full.'));
      };
    });
  }

  // getImage(key): returns the data URL string, or null if it's missing.
  async function getImage(key) {
    if (imageCache[key]) return imageCache[key];
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = function () {
        const record = request.result;
        if (record) imageCache[key] = record.dataUrl;
        resolve(record ? record.dataUrl : null);
      };
      request.onerror = function () { reject(new Error('Could not read an image.')); };
    });
  }

  // deleteImage(key): remove one image.
  async function deleteImage(key) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = function () { delete imageCache[key]; resolve(); };
      tx.onerror = tx.onabort = function () { reject(new Error('Could not delete an image.')); };
    });
  }

  // getAllImages(): every stored image as [{ key, dataUrl }, ...] (used by export).
  async function getAllImages() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(new Error('Could not read images.')); };
    });
  }

  // compressImage(file): shrinks a picture before storing it.
  //   1. Load the file into an <img>.
  //   2. Draw it onto a <canvas> at no more than 1200px wide.
  //   3. Export the canvas as a JPEG at quality 0.8 (a data URL string).
  // Caveat: JPEG has no transparency and no animation, so transparent areas
  // become white and GIFs become still pictures.
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || file.type.indexOf('image/') !== 0) {
        reject(new Error('Please choose an image file (JPG, PNG, WebP...).'));
        return;
      }

      const url = URL.createObjectURL(file); // a temporary link to the file
      const img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url); // free the temporary link

        const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width); // never enlarge
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // background for transparent PNGs
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };
      img.src = url;
    });
  }

  // saveImageFile(file): compress, store, and return the new image key.
  // This is what the cover and inline-image buttons call.
  async function saveImageFile(file) {
    const dataUrl = await compressImage(file);
    const key = makeId('img');
    await putImage(key, dataUrl);
    return key;
  }

  // pruneUnusedImages(): deletes images that no post references any more.
  // Why: when you replace a cover, delete a post, or upload an image and then
  // cancel, the old image would stay in IndexedDB forever. Instead of tracking
  // each case separately, we simply compare "images stored" with "images used".
  async function pruneUnusedImages() {
    const used = {};
    readPosts().forEach(function (post) {
      extractImageKeys(post).forEach(function (key) { used[key] = true; });
    });

    const stored = await getAllImages();
    for (const record of stored) {
      if (!used[record.key]) await deleteImage(record.key);
    }
  }

  /* ======================================================================
     SECTION 4: export and import
     ====================================================================== */

  // exportAll(): bundles posts + images into one plain object.
  // app.js turns it into a downloadable .json file.
  async function exportAll() {
    return {
      app: 'engineering-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      posts: readPosts(),
      images: await getAllImages()
    };
  }

  // cleanImportedPost(raw): checks one imported post and rebuilds it with
  // only the fields we expect. Never trust file contents blindly.
  function cleanImportedPost(raw) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
    const now = new Date().toISOString();
    return {
      id: raw.id,
      title: raw.title,
      tags: parseTags(raw.tags),
      body: typeof raw.body === 'string' ? raw.body : '',
      coverImage: typeof raw.coverImage === 'string' ? raw.coverImage : null,
      createdAt: isNaN(Date.parse(raw.createdAt)) ? now : raw.createdAt,
      updatedAt: isNaN(Date.parse(raw.updatedAt)) ? now : raw.updatedAt
    };
  }

  // importAll(data): merges a backup into the current data.
  // Posts with the same id are overwritten; all other existing posts are kept.
  // Throws a friendly Error if the file isn't a valid backup.
  async function importAll(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.posts)) {
      throw new Error("This file doesn't look like a backup exported from this blog.");
    }

    const incoming = data.posts.map(cleanImportedPost).filter(Boolean);
    if (incoming.length !== data.posts.length) {
      throw new Error('The backup contains posts that are damaged, so nothing was imported.');
    }

    // Only accept images that are real data URLs of images.
    const images = (Array.isArray(data.images) ? data.images : []).filter(function (img) {
      return img && typeof img.key === 'string' && /^data:image\//.test(img.dataUrl || '');
    });

    // Images first (the part most likely to hit the storage limit),
    // posts second, so a failure doesn't leave posts pointing at missing images.
    for (const img of images) await putImage(img.key, img.dataUrl);

    const merged = readPosts();
    incoming.forEach(function (post) {
      const index = merged.findIndex(function (p) { return p.id === post.id; });
      if (index === -1) merged.push(post); else merged[index] = post;
    });
    writePosts(merged);

    return { posts: incoming.length, images: images.length };
  }

  /* ======================================================================
     SECTION 5: sample posts for the very first visit
     ====================================================================== */

  // seedIfFirstRun(): adds two example posts once. We store a "seeded" flag,
  // so if you later delete every post, the samples don't come back.
  function seedIfFirstRun() {
    let alreadySeeded = false;
    try { alreadySeeded = localStorage.getItem(SEEDED_KEY) === 'yes'; } catch (e) { return; }
    if (alreadySeeded || readPosts().length > 0) return;

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const welcome = [
      '# Hello, world',
      '',
      'This is my **engineering notebook**. I will write down what I build and what I learn, mostly so future me can find it again.',
      '',
      '## How this site works',
      '',
      '- Posts are written in *Markdown* and saved in this browser.',
      '- Images are shrunk to 1200px and stored in IndexedDB.',
      '- Use **Export** in the header to back everything up as a single file.',
      '',
      '> Writing something down is the cheapest way to find out whether you understood it.',
      '',
      'Click **Edit** on this post to see its Markdown, or [read the Markdown guide](https://www.markdownguide.org/basic-syntax/).'
    ].join('\n');

    const debounce = [
      '## The problem',
      '',
      'A mechanical push button does not switch cleanly. For a few milliseconds the contact *bounces*, so a digital input sees many edges for a single press.',
      '',
      '## The fix',
      '',
      'Sample the input slowly and only accept a new value once it has been stable for a while:',
      '',
      '```verilog',
      'module debounce #(parameter WAIT = 500_000) (',
      '  input  wire clk,',
      '  input  wire noisy,',
      '  output reg  clean = 0',
      ');',
      '  reg [19:0] count = 0;',
      '  always @(posedge clk) begin',
      '    if (noisy == clean) count <= 0;',
      '    else if (count == WAIT) begin clean <= noisy; count <= 0; end',
      '    else count <= count + 1;',
      '  end',
      'endmodule',
      '```',
      '',
      '## Things to remember',
      '',
      '1. Pick `WAIT` from the clock frequency: 10 ms is about 500,000 cycles at 50 MHz.',
      '2. The counter resets whenever the input agrees with the output, so a glitch never gets through.',
      '3. If the button feeds several clock domains, add a synchronizer before this module.'
    ].join('\n');

    writePosts([
      {
        id: makeId('post'), title: 'Debouncing a push button', tags: ['hardware', 'verilog', 'notes'],
        body: debounce, coverImage: null,
        createdAt: new Date(now - 2 * day).toISOString(), updatedAt: new Date(now - 2 * day).toISOString()
      },
      {
        id: makeId('post'), title: 'Welcome to my engineering notes', tags: ['meta', 'markdown'],
        body: welcome, coverImage: null,
        createdAt: new Date(now - 5 * day).toISOString(), updatedAt: new Date(now - 5 * day).toISOString()
      }
    ]);

    try { localStorage.setItem(SEEDED_KEY, 'yes'); } catch (e) { /* not critical */ }
  }

  // Public API
  return {
    parseTags: parseTags,
    getPosts: getPosts,
    getPost: getPost,
    savePost: savePost,
    deletePost: deletePost,
    saveImageFile: saveImageFile,
    getImage: getImage,
    pruneUnusedImages: pruneUnusedImages,
    exportAll: exportAll,
    importAll: importAll,
    seedIfFirstRun: seedIfFirstRun
  };
})();
