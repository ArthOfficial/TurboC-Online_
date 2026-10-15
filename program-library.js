(() => {
  const $ = id => document.getElementById(id);
  const state = { examples: [], published: [], working: [{ id: 'working-MAIN.CPP', title: 'MAIN.CPP', filename: 'MAIN.CPP', code: '' }], filename: 'MAIN.CPP' };
  const api = async (query = '') => {
    const response = await fetch('/api/library' + query, { cache: 'no-store', credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Saved programs are unavailable.'), { configured: result.configured });
    return result;
  };
  const allPrograms = () => [...state.examples, ...state.published, ...state.working];
  const showError = (id, error) => { $(id).textContent = error.message; };
  const openProgram = async (program, button) => {
    button.disabled = true;
    try {
      if (program.filename === 'MAIN.CPP' && state.published.some(item => item.id === program.id)) throw new Error('This program uses the blank startup filename. The publisher needs to rename MAIN.CPP before it can be opened.');
      const source = program.code !== undefined ? program : (await api('?id=' + encodeURIComponent(program.id))).program;
      await window.TurboWorkspace.openFile(source);
      $('library-status').textContent = `Opened ${program.filename}. Press F2 to save your working copy.`;
    } catch (error) { showError('library-status', error); }
    finally { button.disabled = false; }
  };
  function renderList(container, programs) {
    const search = $('program-search').value.toLowerCase().trim();
    const rows = programs.filter(program => (program.title + ' ' + program.filename).toLowerCase().includes(search)).map(program => {
      const row = document.createElement('div'); row.className = 'program-row' + (program.filename === state.filename ? ' active' : '');
      const open = document.createElement('button'); open.type = 'button'; open.className = 'program-open';
      open.addEventListener('click', () => openProgram(program, open)); open.dataset.programId = program.id;
      if (program.filename === state.filename) open.setAttribute('aria-current', 'true');
      const filename = document.createElement('span'); filename.className = 'program-filename'; filename.textContent = program.filename;
      const title = document.createElement('span'); title.textContent = program.title;
      open.append(filename, title); row.append(open); return row;
    });
    $(container).replaceChildren(...rows);
  }
  function render() {
    renderList('example-programs', state.examples); renderList('saved-programs', state.published); renderList('working-programs', state.working);
    $('example-count').textContent = state.examples.length; $('working-programs-section').hidden = !state.working.length;
  }
  async function refresh() {
    try {
      const result = await api(); state.published = result.programs;
      $('library-status').textContent = result.programs.length ? `${result.programs.length} published program${result.programs.length === 1 ? '' : 's'}.` : 'No published programs yet.';
    } catch (error) { $('library-status').textContent = error.configured === false ? 'Built-in examples are ready to open.' : 'Saved programs are unavailable. Built-in examples still work.'; }
    render();
  }
  document.querySelectorAll('[data-close-dialog]').forEach(element => element.addEventListener('click', () => element.closest('dialog').close()));
  $('program-search').addEventListener('input', render);
  window.addEventListener('turbo-file-opened', event => {
    state.filename = event.detail.filename;
    if (!allPrograms().some(program => program.filename === state.filename)) state.working.push({ id: 'working-' + state.filename, title: state.filename, filename: state.filename, code: '' });
    render();
  });
  $('btn-new-program').addEventListener('click', () => {
    let number = 1;
    while (allPrograms().some(program => program.filename === `NEW${number}.CPP`)) number++;
    $('new-program-filename').value = `NEW${number}.CPP`; $('new-program-message').textContent = ''; $('new-program-dialog').showModal();
  });
  $('new-program-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try {
      const filename = $('new-program-filename').value.toUpperCase();
      if (allPrograms().some(program => program.filename === filename)) throw new Error('This filename already exists. Choose another name.');
      const code = filename.endsWith('.C') ? '#include <stdio.h>\n#include <conio.h>\n\nint main()\n{\n    clrscr();\n\n    getch();\n    return 0;\n}\n' : '#include <iostream.h>\n#include <conio.h>\n\nint main()\n{\n    clrscr();\n\n    getch();\n    return 0;\n}\n';
      const program = { id: 'working-' + filename, title: filename, filename, code };
      await window.TurboWorkspace.openFile(program, true);
      const working = state.working.findIndex(item => item.filename === filename);
      if (working === -1) state.working.push(program); else state.working[working] = program;
      $('new-program-dialog').close(); render(); $('dos').focus({ preventScroll: true });
    } catch (error) { showError('new-program-message', error); }
    finally { submit.disabled = false; }
  });
  fetch('programs/examples.json').then(response => { if (!response.ok) throw new Error('Could not load examples. Reload to try again.'); return response.json(); }).then(examples => {
    state.examples = examples; render();
  }).catch(error => showError('library-status', error));
  refresh();
})();
