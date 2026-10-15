(() => {
  const $ = id => document.getElementById(id);
  const state = { examples: [], published: [], working: [], admin: false, configured: null, editing: null, deleting: null, filename: 'FIBO.CPP' };
  const api = async (method = 'GET', body, query = '') => {
    const response = await fetch('/api/library' + query, {
      method, cache: 'no-store', credentials: 'same-origin',
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('Cloud library is not connected yet. See the setup guide.'); }
    if (!response.ok) {
      if (response.status === 401) { state.admin = false; render(); }
      throw Object.assign(new Error(result.error || 'The request failed.'), { configured: result.configured });
    }
    return result;
  };
  const allPrograms = () => [...state.examples, ...state.published, ...state.working];
  const showError = (id, error) => { $(id).textContent = error.message; };
  const sourceOf = async program => program.code !== undefined ? program : (await api('GET', undefined, '?id=' + encodeURIComponent(program.id))).program;
  const openProgram = async (program, button) => {
    button.disabled = true;
    try {
      const source = await sourceOf(program);
      await window.TurboWorkspace.openFile(source);
      $('library-status').textContent = `Opened ${program.filename}. Press F2 to save your working copy.`;
    } catch (error) { showError('library-status', error); }
    finally { button.disabled = false; }
  };
  const button = (label, action, className = 'library-small-btn') => {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = label; element.className = className;
    element.addEventListener('click', action);
    return element;
  };
  function renderList(container, programs, managed = false) {
    const search = $('program-search').value.toLowerCase().trim();
    const rows = programs.filter(program => (program.title + ' ' + program.filename).toLowerCase().includes(search)).map(program => {
      const row = document.createElement('div'); row.className = 'program-row' + (program.filename === state.filename ? ' active' : '');
      const open = button('', () => openProgram(program, open), 'program-open');
      open.dataset.programId = program.id;
      if (program.filename === state.filename) open.setAttribute('aria-current', 'true');
      const filename = document.createElement('span'); filename.className = 'program-filename'; filename.textContent = program.filename;
      const title = document.createElement('span'); title.textContent = program.title;
      open.append(filename, title); row.append(open);
      if (managed && state.admin) {
        const actions = document.createElement('div'); actions.className = 'program-row-actions';
        const edit = button('Edit', () => editProgram(program)); edit.setAttribute('aria-label', 'Edit ' + program.title);
        const remove = button('Delete', () => {
          state.deleting = program;
          $('delete-program-description').textContent = `Delete “${program.title}” (${program.filename}) from the public library?`;
          $('delete-program-message').textContent = '';
          $('delete-program-dialog').showModal();
        });
        remove.setAttribute('aria-label', 'Delete ' + program.title);
        actions.append(edit, remove); row.append(actions);
      }
      return row;
    });
    $(container).replaceChildren(...rows);
  }
  function render() {
    renderList('example-programs', state.examples);
    renderList('saved-programs', state.published, true);
    renderList('working-programs', state.working);
    $('example-count').textContent = state.examples.length;
    $('working-programs-section').hidden = !state.working.length;
    $('btn-owner-login').hidden = state.admin;
    $('btn-save-program').hidden = !state.admin;
    $('btn-owner-logout').hidden = !state.admin;
  }
  async function refresh() {
    try {
      const result = await api();
      state.published = result.programs;
      state.admin = result.admin;
      state.configured = true;
      $('library-status').textContent = result.programs.length ? `${result.programs.length} published program${result.programs.length === 1 ? '' : 's'}.` : 'No published programs yet.';
    } catch (error) {
      if (error.configured === false) { state.configured = false; $('library-status').textContent = 'Built-in examples are ready to open.'; }
      else $('library-status').textContent = 'Saved programs are unavailable. Built-in examples still work.';
    }
    render();
  }
  async function editProgram(program = null) {
    try {
      const source = program ? await sourceOf(program) : null;
      state.editing = source;
      $('program-dialog-title').textContent = source ? 'Edit published program' : 'Publish program';
      $('program-submit').textContent = source ? 'Save changes' : 'Publish program';
      $('program-title').value = source?.title || '';
      $('program-filename').value = source?.filename || 'PROGRAM.CPP';
      $('program-code').value = source?.code || '';
      $('program-message').textContent = '';
      const readFilename = source?.filename || window.TurboWorkspace.filename;
      $('btn-read-dos-file').dataset.filename = readFilename;
      $('btn-read-dos-file').textContent = 'Read saved ' + readFilename;
      $('program-dialog').showModal();
    } catch (error) { showError('library-status', error); }
  }
  document.querySelectorAll('[data-close-dialog]').forEach(element => element.addEventListener('click', () => element.closest('dialog').close()));
  $('program-search').addEventListener('input', render);
  window.addEventListener('turbo-file-opened', event => { state.filename = event.detail.filename; render(); });
  $('btn-owner-login').addEventListener('click', () => {
    $('owner-message').textContent = state.configured === false ? 'Cloud publishing needs to be connected by the owner first. Follow the setup guide below.' : '';
    $('owner-password').value = '';
    $('owner-dialog').showModal();
    $('owner-password').focus();
  });
  $('owner-form').addEventListener('submit', async event => {
    event.preventDefault(); $('owner-submit').disabled = true; $('owner-message').textContent = 'Signing in…';
    try {
      await api('POST', { password: $('owner-password').value }, '?action=login');
      $('owner-password').value = ''; $('owner-dialog').close();
      await refresh();
    } catch (error) { showError('owner-message', error); }
    finally { $('owner-password').value = ''; $('owner-submit').disabled = false; }
  });
  $('btn-owner-logout').addEventListener('click', async () => {
    try { await api('POST', {}, '?action=logout'); state.admin = false; render(); }
    catch (error) { showError('library-status', error); }
  });
  $('btn-save-program').addEventListener('click', () => editProgram());
  $('program-form').addEventListener('submit', async event => {
    event.preventDefault(); $('program-submit').disabled = true; $('program-message').textContent = 'Saving…';
    try {
      const program = { title: $('program-title').value, filename: $('program-filename').value.toUpperCase(), code: $('program-code').value };
      if (state.editing) Object.assign(program, { id: state.editing.id, revision: state.editing.revision });
      await api('PUT', program);
      $('program-dialog').close(); await refresh();
    } catch (error) { showError('program-message', error); }
    finally { $('program-submit').disabled = false; }
  });
  $('btn-read-dos-file').addEventListener('click', async () => {
    const read = $('btn-read-dos-file'); read.disabled = true;
    try {
      $('program-code').value = await window.TurboWorkspace.readFile(read.dataset.filename);
      $('program-message').textContent = `Read ${read.dataset.filename}. Review the code before publishing.`;
    } catch (error) { showError('program-message', error); }
    finally { read.disabled = false; }
  });
  $('program-upload').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 60 * 1024) throw new Error('Choose a source file up to 60 KB.');
      if (!/^[A-Z0-9_]{1,8}\.(CPP|C|H|HPP)$/i.test(file.name)) throw new Error('Use a DOS filename with up to 8 letters, numbers, or underscores.');
      $('program-code').value = await file.text();
      $('program-filename').value = file.name.toUpperCase();
      if (!$('program-title').value) $('program-title').value = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      $('program-message').textContent = 'File loaded. Review it before publishing.';
    } catch (error) { showError('program-message', error); }
    finally { event.target.value = ''; }
  });
  $('delete-program-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try {
      await api('DELETE', { id: state.deleting.id, revision: state.deleting.revision });
      $('delete-program-dialog').close(); state.deleting = null; await refresh();
    } catch (error) { showError('delete-program-message', error); }
    finally { submit.disabled = false; }
  });
  $('btn-new-program').addEventListener('click', () => {
    let number = 1;
    while (allPrograms().some(program => program.filename === `NEW${number}.CPP`)) number++;
    $('new-program-filename').value = `NEW${number}.CPP`;
    $('new-program-message').textContent = ''; $('new-program-dialog').showModal();
  });
  $('new-program-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try {
      const filename = $('new-program-filename').value.toUpperCase();
      if (allPrograms().some(program => program.filename === filename)) throw new Error('This filename already exists. Choose another name.');
      const code = filename.endsWith('.C') ? '#include <stdio.h>\n#include <conio.h>\n\nint main()\n{\n    clrscr();\n\n    getch();\n    return 0;\n}\n' : '#include <iostream.h>\n#include <conio.h>\n\nint main()\n{\n    clrscr();\n\n    getch();\n    return 0;\n}\n';
      const program = { id: 'working-' + filename, title: filename, filename, code };
      await window.TurboWorkspace.openFile(program, true);
      state.working.push(program); $('new-program-dialog').close(); render();
    } catch (error) { showError('new-program-message', error); }
    finally { submit.disabled = false; }
  });
  fetch('programs/examples.json').then(response => { if (!response.ok) throw new Error('Could not load examples. Reload to try again.'); return response.json(); }).then(examples => {
    state.examples = examples; render();
  }).catch(error => showError('library-status', error));
  refresh();
})();
