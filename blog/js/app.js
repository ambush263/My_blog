/* ==========================================================================
   app.js: routing and rendering

   The whole site is ONE html page. When the URL hash changes
   (#/, #/post/ID, #/new, #/edit/ID) we pick a render function and replace
   the contents of <main id="app">. Hash routing works on GitHub Pages because
   everything after "#" is handled by the browser and never sent to a server.

   Depends on: BlogMarkdown (markdown.js) and BlogStorage (storage.js).
   ========================================================================== */

(function () {
  'use strict';

  const app = document.getElementById('app');
  const escapeHtml = BlogMarkdown.escapeHtml;

  /* ----------------------------------------------------------------------
     State for the home page filters. Kept outside the render function so the
     search text and selected tag survive when you open a post and come back.
     ---------------------------------------------------------------------- */
  const filters = { query: '', tag: '' };

  /* ======================================================================
     SECTION 1: small utilities
     ====================================================================== */

  // formatDate("2026-10-02T...") -> "Oct 2, 2026" (in the reader's locale)
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // showToast(message, type): a small message at the bottom of the screen.
  // type is 'info' or 'error'. It hides itself after a few seconds.
  let toastTimer = null;
  function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast toast-' + (type || 'info');
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, type === 'error' ? 6000 : 3000);
  }

  // hydrateImages(root): fills in the real image data.
  // Images in the page are written as <img data-image-key="KEY"> with no src.
  // Their pixels live in IndexedDB, which can only be read asynchronously,
  // so after the HTML is on the page we look each one up and set `src`.
  function hydrateImages(root) {
    root.querySelectorAll('img[data-image-key]').forEach(async function (img) {
      try {
        const dataUrl = await BlogStorage.getImage(img.getAttribute('data-image-key'));
        if (dataUrl) {
          img.src = dataUrl;
        } else {
          img.alt = img.alt || 'Image not found';
          img.classList.add('img-missing');
        }
      } catch (err) {
        console.error(err);
        img.classList.add('img-missing');
      }
    });
  }

  // tagChipsHtml(tags): <span class="tag">..</span> for each tag (escaped!).
  function tagChipsHtml(tags) {
    return (tags || []).map(function (tag) {
      return '<span class="tag">' + escapeHtml(tag) + '</span>';
    }).join('');
  }

  /* ======================================================================
     SECTION 2: HOME PAGE (list of cards, search, tag filter)
     ====================================================================== */

  // renderHome(): builds the page frame once, then fills the tag bar and the
  // grid. Typing in the search box only re-renders the grid, so the input
  // keeps its focus while you type.
  function renderHome() {
    document.title = 'Engineering Notes';

    app.innerHTML =
      '<section class="intro">' +
        '<h1>Engineering notes</h1>' +
        '<p>Projects, experiments, and things I am learning.</p>' +
      '</section>' +
      '<div class="toolbar">' +
        '<input type="search" id="search" placeholder="Search posts" aria-label="Search posts" autocomplete="off">' +
      '</div>' +
      '<div class="tag-bar" id="tag-bar"></div>' +
      '<div class="grid" id="post-grid"></div>';

    const search = document.getElementById('search');
    search.value = filters.query;
    search.addEventListener('input', function () {
      filters.query = search.value;
      renderGrid();
    });

    renderTagBar();
    renderGrid();
  }

  // renderTagBar(): one button per tag used anywhere, plus "All".
  function renderTagBar() {
    const bar = document.getElementById('tag-bar');
    const tags = [];
    BlogStorage.getPosts().forEach(function (post) {
      post.tags.forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    });
    tags.sort();

    if (tags.length === 0) { bar.hidden = true; return; }
    bar.hidden = false;

    bar.innerHTML =
      '<button type="button" class="chip' + (filters.tag === '' ? ' is-active' : '') + '" data-tag="">All</button>' +
      tags.map(function (tag) {
        return '<button type="button" class="chip' + (filters.tag === tag ? ' is-active' : '') +
               '" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</button>';
      }).join('');

    // Event delegation: one listener on the container handles every chip.
    bar.onclick = function (event) {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      filters.tag = chip.getAttribute('data-tag');
      renderTagBar();
      renderGrid();
    };
  }

  // postMatchesFilters(post): true if the post passes the search text AND tag.
  function postMatchesFilters(post) {
    if (filters.tag && post.tags.indexOf(filters.tag) === -1) return false;

    const query = filters.query.trim().toLowerCase();
    if (!query) return true;

    const haystack = (post.title + ' ' + post.tags.join(' ') + ' ' + post.body).toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  // renderGrid(): draws the cards for posts that pass the filters.
  function renderGrid() {
    const grid = document.getElementById('post-grid');
    const allPosts = BlogStorage.getPosts();
    const posts = allPosts.filter(postMatchesFilters);

    if (allPosts.length === 0) {
      grid.innerHTML =
        '<div class="empty"><p>No posts yet.</p><a class="btn btn-primary" href="#/new">Write your first post</a></div>';
      return;
    }
    if (posts.length === 0) {
      grid.innerHTML = '<div class="empty"><p>No posts match your search or tag.</p></div>';
      return;
    }

    grid.innerHTML = posts.map(function (post) {
      const cover = post.coverImage
        ? '<div class="card-cover"><img data-image-key="' + escapeHtml(post.coverImage) + '" alt=""></div>'
        : '<div class="card-cover card-cover-empty" aria-hidden="true"></div>';

      return (
        '<a class="card" href="#/post/' + encodeURIComponent(post.id) + '">' +
          cover +
          '<div class="card-body">' +
            '<h2>' + escapeHtml(post.title) + '</h2>' +
            '<time class="meta" datetime="' + escapeHtml(post.createdAt) + '">' + formatDate(post.createdAt) + '</time>' +
            '<p class="excerpt">' + escapeHtml(BlogMarkdown.makeExcerpt(post.body)) + '</p>' +
            '<div class="tags">' + tagChipsHtml(post.tags) + '</div>' +
          '</div>' +
        '</a>'
      );
    }).join('');

    hydrateImages(grid);
  }

  /* ======================================================================
     SECTION 3: POST PAGE (read, edit button, delete button)
     ====================================================================== */

  function renderPost(id) {
    const post = BlogStorage.getPost(id);
    if (!post) return renderNotFound();

    document.title = post.title + ' | Engineering Notes';

    const updated = post.updatedAt !== post.createdAt && formatDate(post.updatedAt) !== formatDate(post.createdAt)
      ? '<span class="meta">Updated ' + formatDate(post.updatedAt) + '</span>' : '';

    app.innerHTML =
      '<article class="post">' +
        '<a class="back" href="#/">Back to all posts</a>' +
        '<header class="post-header">' +
          '<h1>' + escapeHtml(post.title) + '</h1>' +
          '<div class="post-meta">' +
            '<time class="meta" datetime="' + escapeHtml(post.createdAt) + '">' + formatDate(post.createdAt) + '</time>' +
            updated +
          '</div>' +
          '<div class="tags" id="post-tags"></div>' +
        '</header>' +
        (post.coverImage ? '<img class="post-cover" data-image-key="' + escapeHtml(post.coverImage) + '" alt="">' : '') +
        // Safe: BlogMarkdown.render() sanitizes its output.
        '<div class="prose">' + BlogMarkdown.render(post.body) + '</div>' +
        '<div class="post-actions">' +
          '<a class="btn" href="#/edit/' + encodeURIComponent(post.id) + '">Edit</a>' +
          '<button class="btn btn-danger" type="button" id="btn-delete">Delete</button>' +
        '</div>' +
      '</article>';

    // Tags on the post page are links that jump to the home page filtered by that tag.
    const tagBox = document.getElementById('post-tags');
    tagBox.innerHTML = post.tags.map(function (tag) {
      return '<a class="tag tag-link" href="#/" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</a>';
    }).join('');
    tagBox.onclick = function (event) {
      const link = event.target.closest('[data-tag]');
      if (link) { filters.tag = link.getAttribute('data-tag'); filters.query = ''; }
      // We don't call preventDefault: the link then navigates to "#/" as usual.
    };

    document.getElementById('btn-delete').addEventListener('click', function () {
      handleDelete(post);
    });

    hydrateImages(app);
  }

  // handleDelete(post): asks first, then deletes and cleans up images.
  async function handleDelete(post) {
    // window.confirm() is the simplest built-in confirmation dialog.
    if (!window.confirm('Delete "' + post.title + '"? This cannot be undone.')) return;

    try {
      BlogStorage.deletePost(post.id);
      await BlogStorage.pruneUnusedImages(); // remove the post's now-unused images
      showToast('Post deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
    location.hash = '#/';
  }

  /* ======================================================================
     SECTION 4: EDITOR (new post and edit post share one form)
     ====================================================================== */

  // renderEditor(id): if `id` is given, the form is pre-filled with that post.
  function renderEditor(id) {
    const editing = id ? BlogStorage.getPost(id) : null;
    if (id && !editing) return renderNotFound();

    document.title = (editing ? 'Edit post' : 'New post') + ' | Engineering Notes';

    // The form's own state. coverKey is the IndexedDB key of the cover (or null).
    let coverKey = editing ? editing.coverImage : null;

    // Only static text goes into the template. User text is filled in with
    // `.value = ...` below, which needs no escaping.
    app.innerHTML =
      '<form class="editor" id="post-form" novalidate>' +
        '<h1>' + (editing ? 'Edit post' : 'New post') + '</h1>' +

        '<label class="field"><span class="label">Title</span>' +
          '<input type="text" id="f-title" maxlength="150" required></label>' +

        '<label class="field"><span class="label">Tags <small>separate with commas</small></span>' +
          '<input type="text" id="f-tags" placeholder="fpga, verilog, notes"></label>' +

        '<div class="field">' +
          '<span class="label">Cover image <small>optional</small></span>' +
          '<div class="cover-box" id="cover-box"></div>' +
          '<div class="row">' +
            '<label class="btn" for="f-cover">Choose image</label>' +
            '<input type="file" id="f-cover" accept="image/*" hidden>' +
            '<button type="button" class="btn" id="btn-cover-remove">Remove cover</button>' +
          '</div>' +
        '</div>' +

        '<div class="field">' +
          '<div class="editor-bar">' +
            '<span class="label">Body <small>Markdown</small></span>' +
            '<div class="row">' +
              '<button type="button" class="btn btn-small" id="btn-inline-image">Insert image</button>' +
              '<button type="button" class="btn btn-small" id="btn-preview">Preview</button>' +
            '</div>' +
          '</div>' +
          '<textarea id="f-body" rows="18" spellcheck="true"></textarea>' +
          '<div class="prose preview" id="preview" hidden></div>' +
          '<input type="file" id="f-inline" accept="image/*" hidden>' +
        '</div>' +

        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary">' + (editing ? 'Save changes' : 'Publish post') + '</button>' +
          '<a class="btn" href="' + (editing ? '#/post/' + encodeURIComponent(editing.id) : '#/') + '">Cancel</a>' +
        '</div>' +
      '</form>';

    const titleInput = document.getElementById('f-title');
    const tagsInput = document.getElementById('f-tags');
    const bodyInput = document.getElementById('f-body');
    const coverBox = document.getElementById('cover-box');
    const removeCoverBtn = document.getElementById('btn-cover-remove');
    const preview = document.getElementById('preview');
    const previewBtn = document.getElementById('btn-preview');

    if (editing) {
      titleInput.value = editing.title;
      tagsInput.value = editing.tags.join(', ');
      bodyInput.value = editing.body;
    }

    // updateCoverBox(): shows the current cover, or a hint if there is none.
    function updateCoverBox() {
      if (coverKey) {
        coverBox.innerHTML = '<img data-image-key="' + escapeHtml(coverKey) + '" alt="Cover preview">';
        hydrateImages(coverBox);
      } else {
        coverBox.textContent = 'No cover image';
      }
      removeCoverBtn.hidden = !coverKey;
    }
    updateCoverBox();

    // --- Cover image: compress + store immediately, remember its key. ---
    document.getElementById('f-cover').addEventListener('change', async function (event) {
      const input = event.target;
      const file = input.files[0];
      if (!file) return;
      try {
        coverKey = await BlogStorage.saveImageFile(file);
        updateCoverBox();
      } catch (err) {
        showToast(err.message, 'error');
      }
      input.value = ''; // allow choosing the same file again later
    });

    removeCoverBtn.addEventListener('click', function () {
      coverKey = null; // the file itself is deleted when the post is saved (pruneUnusedImages)
      updateCoverBox();
    });

    // --- Inline image: upload, then insert Markdown at the cursor. ---
    const inlineInput = document.getElementById('f-inline');
    document.getElementById('btn-inline-image').addEventListener('click', function () {
      inlineInput.click();
    });
    inlineInput.addEventListener('change', async function () {
      const file = inlineInput.files[0];
      if (!file) return;
      try {
        const key = await BlogStorage.saveImageFile(file);
        const altText = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, ''); // file name without extension
        const markdown = '\n![' + altText + '](' + BlogMarkdown.IMAGE_PREFIX + key + ')\n';

        // setRangeText replaces the current selection (or inserts at the cursor).
        // The final argument "end" puts the cursor after the inserted text.
        bodyInput.setRangeText(markdown, bodyInput.selectionStart, bodyInput.selectionEnd, 'end');
        bodyInput.focus();
      } catch (err) {
        showToast(err.message, 'error');
      }
      inlineInput.value = '';
    });

    // --- Preview toggle: swap the textarea for the rendered result. ---
    previewBtn.addEventListener('click', function () {
      const showing = !preview.hidden;
      if (showing) {
        preview.hidden = true;
        bodyInput.hidden = false;
        previewBtn.textContent = 'Preview';
      } else {
        preview.innerHTML = BlogMarkdown.render(bodyInput.value);
        hydrateImages(preview);
        preview.hidden = false;
        bodyInput.hidden = true;
        previewBtn.textContent = 'Back to editing';
      }
    });

    // --- Save ---
    document.getElementById('post-form').addEventListener('submit', async function (event) {
      event.preventDefault(); // stop the browser from reloading the page

      const title = titleInput.value.trim();
      if (!title) {
        showToast('Please give your post a title.', 'error');
        titleInput.focus();
        return;
      }

      try {
        const saved = BlogStorage.savePost({
          id: editing ? editing.id : null,
          title: title,
          tags: tagsInput.value,
          body: bodyInput.value,
          coverImage: coverKey
        });
        await BlogStorage.pruneUnusedImages();
        showToast(editing ? 'Changes saved.' : 'Post published.');
        location.hash = '#/post/' + encodeURIComponent(saved.id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    titleInput.focus();
  }

  /* ======================================================================
     SECTION 5: NOT FOUND
     ====================================================================== */

  function renderNotFound() {
    document.title = 'Not found | Engineering Notes';
    app.innerHTML =
      '<div class="empty"><h1>Page not found</h1><p>That post or page does not exist.</p>' +
      '<a class="btn btn-primary" href="#/">Go to all posts</a></div>';
  }

  /* ======================================================================
     SECTION 6: THE ROUTER
     ====================================================================== */

  // route(): reads location.hash, picks the matching page, renders it.
  //   ""  or "#/"        -> home
  //   "#/post/ID"        -> one post
  //   "#/new"            -> empty editor
  //   "#/edit/ID"        -> editor pre-filled
  function route() {
    const path = location.hash.replace(/^#/, '') || '/';
    const parts = path.split('/').filter(Boolean);       // "/post/abc" -> ["post", "abc"]
    const id = parts[1] ? decodeURIComponent(parts[1]) : null;

    try {
      if (parts.length === 0)               renderHome();
      else if (parts[0] === 'post' && id)   renderPost(id);
      else if (parts[0] === 'new')          renderEditor(null);
      else if (parts[0] === 'edit' && id)   renderEditor(id);
      else                                  renderNotFound();
    } catch (err) {
      console.error(err);
      app.innerHTML = '<div class="empty"><p>Something went wrong while showing this page.</p></div>';
    }
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     SECTION 7: THEME TOGGLE (remembers the choice)
     ====================================================================== */

  function initTheme() {
    const button = document.getElementById('btn-theme');

    // The label names the theme you will switch TO.
    function paintButton() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      button.textContent = dark ? 'Light' : 'Dark';
    }

    button.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('blog.theme', next); } catch (e) { /* ignore */ }
      paintButton();
    });
    paintButton();
  }

  /* ======================================================================
     SECTION 8: EXPORT / IMPORT
     ====================================================================== */

  // Export: build one JSON file in memory and make the browser download it.
  async function handleExport() {
    try {
      const data = await BlogStorage.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // The standard trick: a temporary <a download> that we click with code.
      const link = document.createElement('a');
      link.href = url;
      link.download = 'blog-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

      showToast('Backup downloaded (' + data.posts.length + ' posts, ' + data.images.length + ' images).');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    }
  }

  // Import: read the chosen file, parse it, confirm, then merge it in.
  async function handleImport(file) {
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      showToast('That file is not valid JSON, so it could not be imported.', 'error');
      return;
    }

    if (!window.confirm('Import this backup? Posts with the same ID will be overwritten; your other posts stay.')) return;

    try {
      const result = await BlogStorage.importAll(data);
      showToast('Imported ' + result.posts + ' posts and ' + result.images + ' images.');
      route(); // redraw the current page with the new data
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /* ======================================================================
     SECTION 9: START UP
     ====================================================================== */

  function init() {
    BlogStorage.seedIfFirstRun();   // sample posts on the very first visit
    initTheme();

    document.getElementById('btn-export').addEventListener('click', handleExport);

    const importInput = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', async function () {
      await handleImport(importInput.files[0]);
      importInput.value = ''; // so importing the same file twice still triggers "change"
    });

    window.addEventListener('hashchange', route); // re-render when the URL hash changes
    route();                                      // render the page for the current URL

    // Housekeeping in the background: remove images no post uses.
    BlogStorage.pruneUnusedImages().catch(function (err) { console.warn(err); });
  }

  init();
})();
