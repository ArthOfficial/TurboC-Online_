(() => {
  const $ = id => document.getElementById(id);
  let signedIn = false;
  let editing = null;
  let deleting = null;
  let interruptedDialog = null;
  const setSignedIn = value => {
    signedIn = value; $('owner-login-section').hidden = value; $('admin-workspace').hidden = !value;
    if (!value) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  };
  const api = async (method = 'GET', body, query = '') => {
    const response = await fetch('/api/library' + query, {
      method, cache: 'no-store', credentials: 'same-origin',
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The server did not respond. Please try again.'); }
    if (!response.ok) {
      if (response.status === 401 && signedIn) {
        interruptedDialog = document.querySelector('dialog[open]')?.id || null;
        setSignedIn(false); $('owner-message').textContent = 'Your session expired. Sign in again; your draft is kept.';
      }
      const message = result.error || 'The request failed.';
      throw Object.assign(new Error(message), { status: response.status });
    }
    return result;
  };
  const showError = (id, error) => { $(id).textContent = error.message; };
  const button = (label, action) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'library-small-btn'; element.textContent = label;
    element.addEventListener('click', action); return element;
  };
  async function refresh() {
    const result = await api(); setSignedIn(result.admin); $('owner-message').textContent = '';
    if (!result.admin) return;
    $('admin-status').textContent = result.programs.length ? `${result.programs.length} published program${result.programs.length === 1 ? '' : 's'}` : 'No published programs yet. Add your first program.';
    $('admin-programs').replaceChildren(...result.programs.map(program => {
      const row = document.createElement('div'); row.className = 'program-row';
      const summary = document.createElement('div'); summary.className = 'admin-program-summary';
      const title = document.createElement('strong'); title.textContent = program.title;
      const filename = document.createElement('span'); filename.className = 'program-filename'; filename.textContent = program.filename;
      summary.append(title, filename);
      const actions = document.createElement('div'); actions.className = 'program-row-actions';
      const edit = button('Edit', () => editProgram(program)); edit.setAttribute('aria-label', 'Edit ' + program.title);
      const remove = button('Delete', () => {
        deleting = program; $('delete-program-description').textContent = `Delete “${program.title}” (${program.filename}) from the public library?`;
        $('delete-program-message').textContent = ''; $('delete-program-dialog').showModal();
      });
      remove.setAttribute('aria-label', 'Delete ' + program.title);
      actions.append(edit, remove); row.append(summary, actions); return row;
    }));
  }
  async function editProgram(program = null) {
    try {
      editing = program ? (await api('GET', undefined, '?id=' + encodeURIComponent(program.id))).program : null;
      $('program-dialog-title').textContent = editing ? 'Edit published program' : 'Publish program'; $('program-submit').textContent = editing ? 'Save changes' : 'Publish program';
      $('program-title').value = editing?.title || ''; $('program-filename').value = editing?.filename || 'PROGRAM.CPP'; $('program-code').value = editing?.code || '';
      $('program-message').textContent = ''; $('program-dialog').showModal();
    } catch (error) { showError('admin-status', error); }
  }
  document.querySelectorAll('[data-close-dialog]').forEach(element => element.addEventListener('click', () => element.closest('dialog').close()));
  $('owner-password').addEventListener('input', () => { $('owner-password').removeAttribute('aria-invalid'); $('owner-message').textContent = ''; });
  $('owner-form').addEventListener('submit', async event => {
    event.preventDefault(); $('owner-submit').disabled = true; $('owner-message').textContent = 'Signing in…';
    try {
      await api('POST', { password: $('owner-password').value }, '?action=login'); $('owner-password').removeAttribute('aria-invalid'); await refresh();
      if (signedIn && interruptedDialog) {
        $(interruptedDialog).showModal();
        $(interruptedDialog === 'program-dialog' ? 'program-message' : 'delete-program-message').textContent = 'Signed in again. Review your changes and try again.';
        interruptedDialog = null;
      }
    } catch (error) {
      if (error.status === 401) { $('owner-message').textContent = 'Wrong password. Please try again.'; $('owner-password').setAttribute('aria-invalid', 'true'); $('owner-password').focus(); }
      else showError('owner-message', error);
    } finally { $('owner-password').value = ''; $('owner-submit').disabled = false; }
  });
  $('btn-owner-logout').addEventListener('click', async () => {
    try { await api('POST', {}, '?action=logout'); setSignedIn(false); $('owner-message').textContent = ''; $('owner-password').focus(); }
    catch (error) { showError('admin-status', error); }
  });
  $('btn-save-program').addEventListener('click', () => editProgram());
  $('program-form').addEventListener('submit', async event => {
    event.preventDefault(); $('program-submit').disabled = true; $('program-message').textContent = 'Saving…';
    try {
      const program = { title: $('program-title').value, filename: $('program-filename').value.toUpperCase(), code: $('program-code').value };
      if (editing) Object.assign(program, { id: editing.id, revision: editing.revision });
      await api('PUT', program); $('program-dialog').close(); await refresh();
    } catch (error) { showError('program-message', error); }
    finally { $('program-submit').disabled = false; }
  });
  $('btn-upload-program').addEventListener('click', () => $('program-upload').click());
  $('program-upload').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 60 * 1024) throw new Error('Choose a source file up to 60 KB.');
      if (!/^[A-Z0-9_]{1,8}\.(CPP|C|H|HPP)$/i.test(file.name)) throw new Error('Use a DOS filename with up to 8 letters, numbers, or underscores.');
      $('program-code').value = await file.text(); $('program-filename').value = file.name.toUpperCase();
      if (!$('program-title').value) $('program-title').value = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      $('program-message').textContent = 'File loaded. Review it before publishing.';
    } catch (error) { showError('program-message', error); }
    finally { event.target.value = ''; }
  });
  $('delete-program-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try { await api('DELETE', { id: deleting.id, revision: deleting.revision }); $('delete-program-dialog').close(); deleting = null; await refresh(); }
    catch (error) { showError('delete-program-message', error); }
    finally { submit.disabled = false; }
  });
  refresh().catch(error => { setSignedIn(false); showError('owner-message', error); });
})();
