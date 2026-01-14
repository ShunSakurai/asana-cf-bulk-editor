const COLORS = {
  'none': '#e8ecf1',
  'red': '#f06a6a',
  'orange': '#fc8d61',
  'yellow-orange': '#fdac5d',
  'yellow': '#fce96c',
  'yellow-green': '#bce968',
  'blue-green': '#73d3b7',
  'green': '#67cf8b',
  'aqua': '#7ddacc',
  'blue': '#55b2fa',
  'indigo': '#6774e6',
  'purple': '#9a6ee7',
  'magenta': '#e873c0',
  'hot-pink': '#fa709a',
  'pink': '#fb8f9d',
  'cool-gray': '#8894a4'
};

const App = {
  state: {
    workspaces: [],
    projects: [],
    customFields: [],
    currentWorkspaceGid: null,
    currentProjectGid: null,
    currentFieldGid: null,
    enumOptions: [],
    allProjects: []
  },

  elements: {
    workspaceSelect: null,
    projectSelect: null,
    fieldSelect: null,
    views: {
      empty: null,
      loading: null,
      current: null
    },
    enumList: null
  },

  init: function () {
    this.elements.workspaceSelect = document.getElementById('workspace-select');
    // Project input is handled in initTypeahead
    this.elements.fieldSelect = document.getElementById('field-select');
    this.elements.views.empty = document.getElementById('state-empty');
    this.elements.views.loading = document.getElementById('state-loading');
    this.elements.views.current = document.getElementById('state-current');
    this.elements.enumList = document.getElementById('enum-list');

    this.attachEventListeners();
    this.initTypeahead();
    this.fetchWorkspaces();
  },

  attachEventListeners: function () {
    this.elements.workspaceSelect.addEventListener('change', (e) => this.onWorkspaceChange(e.target.value));
    // Project listener handled in initTypeahead
    this.elements.fieldSelect.addEventListener('change', (e) => this.onFieldChange(e.target.value));

    document.getElementById('action-select-all').addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleAllSelection(true);
    });

    document.getElementById('action-deselect-all').addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleAllSelection(false);
    });
  },

  switchView: function (viewName) {
    Object.values(this.elements.views).forEach(el => el.classList.add('hidden'));
    if (this.elements.views[viewName]) {
      this.elements.views[viewName].classList.remove('hidden');
    }
  },

  // API Calls
  callApi: function (name, parameters) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'api', name: name, parameters: parameters },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Runtime Error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          if (response && response.errors) {
            console.error('API Error', response.errors);
            reject(response.errors);
          } else if (response) {
            resolve(response.data);
          } else {
            // Fallback for null response without lastError (rare but possible)
            reject(new Error('Empty response from background script'));
          }
        }
      );
    });
  },

  // Workspaces
  fetchWorkspaces: function () {
    this.callApi('workspaces', {})
      .then(data => {
        this.state.workspaces = data;
        this.renderSelect('workspaceSelect', data, 'Select Workspace');
        this.elements.workspaceSelect.disabled = false;

        // Load stored preference if available, or default to first workspace
        chrome.storage.sync.get(['defaultWorkspaceGid'], (result) => {
          let targetGid = result.defaultWorkspaceGid;

          // helper to check if gid exists in options
          const optionExists = (gid) => {
            return Array.from(this.elements.workspaceSelect.options).some(o => o.value === gid);
          };

          if (!targetGid || !optionExists(targetGid)) {
            // Default to first workspace if available
            if (data.length > 0) {
              targetGid = data[0].gid;
            }
          }

          if (targetGid) {
            this.elements.workspaceSelect.value = targetGid;
            this.onWorkspaceChange(targetGid);
          }
        });
      })
      .catch(err => console.error(err));
  },

  onWorkspaceChange: function (workspaceGid) {
    this.state.currentWorkspaceGid = workspaceGid;
    this.state.currentProjectGid = null;
    this.state.allProjects = []; // Clear previous workspace projects immediately
    try {
      chrome.storage.sync.set({ defaultWorkspaceGid: workspaceGid });
    } catch (e) { }

    // Reset downstream
    const projectInput = document.getElementById('project-input');
    projectInput.value = '';
    projectInput.disabled = !workspaceGid;
    projectInput.placeholder = "Loading projects...";
    document.getElementById('project-list').classList.add('hidden'); // Hide list on workspace change
    document.getElementById('project-list').innerHTML = ''; // Clear rendered list

    this.elements.fieldSelect.innerHTML = '<option value="">Select a project first</option>';
    this.elements.fieldSelect.disabled = true;
    this.switchView('empty');

    if (workspaceGid) {
      this.fetchProjects(workspaceGid);
    } else {
      projectInput.placeholder = "Select a workspace first";
    }
  },

  // Projects (Hybrid: Local + Typeahead)
  initTypeahead: function () {
    const input = document.getElementById('project-input');
    const list = document.getElementById('project-list');
    let debounceTimer;

    const handleSearch = (query) => {
      if (this.state.allProjects.length > 0) {
        // Local Filter
        const filtered = this.state.allProjects.filter(p =>
          p.name.toLowerCase().includes(query.toLowerCase())
        );
        this.renderProjectOptions(filtered);
      } else {
        // API Typeahead
        if (!query) {
          // If no query and no local data, show empty/prompt
          this.renderProjectOptions([], 'Type to search projects...');
          return;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.fetchProjectsTypeahead(this.state.currentWorkspaceGid, query);
        }, 300);
      }
    };

    // Handle Input
    input.addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });

    // Handle Focus/Click - Show list
    input.addEventListener('focus', () => {
      // Should show full list if local, or prompt if typeahead
      handleSearch(input.value);
    });
    input.addEventListener('click', () => {
      handleSearch(input.value);
    });

    // Handle outside click to close
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !list.contains(e.target)) {
        list.classList.add('hidden');
      }
    });
  },

  fetchProjectsTypeahead: function (workspaceGid, query) {
    if (!workspaceGid) return;

    this.callApi('projectTypeahead', { workspace_gid: workspaceGid, query: query })
      .then(data => {
        this.renderProjectOptions(data);
      })
      .catch(err => {
        console.error(err);
        this.renderProjectOptions([], 'Error searching projects');
      });
  },

  renderProjectOptions: function (projects, emptyMessage) {
    const list = document.getElementById('project-list');
    list.innerHTML = '';

    if (projects.length === 0) {
      const div = document.createElement('div');
      div.className = 'combobox-option no-hover';
      div.textContent = emptyMessage || 'No projects found';
      list.appendChild(div);
    } else {
      projects.forEach(project => {
        const div = document.createElement('div');
        div.className = 'combobox-option';
        div.textContent = project.name;
        div.addEventListener('click', () => {
          this.selectProject(project);
        });
        list.appendChild(div);
      });
    }

    list.classList.remove('hidden');
  },

  selectProject: function (project) {
    const input = document.getElementById('project-input');
    input.value = project.name;
    document.getElementById('project-list').classList.add('hidden');

    this.onProjectChange(project.gid);
  },

  // Projects - Fetch All (Try first)
  fetchProjects: function (workspaceGid) {
    this.callApi('projects', { workspace_gid: workspaceGid, archived: false })
      .then(data => {
        this.state.allProjects = data || [];
        // Optional: Update placeholder to indicate loaded
        document.getElementById('project-input').placeholder = "Select or type to search...";
      })
      .catch(err => {
        console.error('Fetch all projects failed, falling back to typeahead', err);
        this.state.allProjects = []; // Clear to force typeahead
        document.getElementById('project-input').placeholder = "Type to search projects...";
      });
  },

  onProjectChange: function (projectGid) {
    this.state.currentProjectGid = projectGid;
    this.state.currentFieldGid = null;

    // Reset downstream
    this.elements.fieldSelect.innerHTML = '<option value="">Loading...</option>';
    this.elements.fieldSelect.disabled = true;
    this.switchView('empty');

    if (projectGid) {
      this.fetchCustomFields(projectGid);
    }
  },

  // Custom Fields
  fetchCustomFields: function (projectGid) {
    // We need to fetch settings to get the fields for this project
    // https://developers.asana.com/reference/getcustomfieldsettingsforproject
    this.callApi('customFieldSettings', { project_gid: projectGid })
      .then(data => {
        // Filter for ENUM fields only
        const enumFields = data
          .map(setting => setting.custom_field)
          .filter(field => field.resource_subtype === 'enum');

        this.state.customFields = enumFields;

        if (enumFields.length === 0) {
          this.elements.fieldSelect.innerHTML = '<option value="">No enum fields found</option>';
          this.elements.fieldSelect.disabled = true;
        } else {
          this.renderSelect('fieldSelect', enumFields, 'Select Custom Field');
          this.elements.fieldSelect.disabled = false;
        }
      })
      .catch(err => console.error(err));
  },

  onFieldChange: function (fieldGid) {
    this.state.currentFieldGid = fieldGid;

    if (fieldGid) {
      this.switchView('loading');
      this.fetchFullFieldDetails(fieldGid);
    } else {
      this.switchView('empty');
    }
  },

  // Options
  fetchFullFieldDetails: function (fieldGid) {
    // Need to fetch individual field to get current options
    // https://developers.asana.com/reference/getcustomfield
    this.callApi('customField', { custom_field_gid: fieldGid })
      .then(data => {
        this.state.enumOptions = data.enum_options || [];
        this.renderEnumList(this.state.enumOptions);
        this.switchView('current');
      })
      .catch(err => console.error(err));
  },

  // UI Rendering
  renderSelect: function (elementKey, data, placeholder) {
    const select = this.elements[elementKey];
    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholder;
    select.appendChild(defaultOption);

    data.forEach(item => {
      const option = document.createElement('option');
      option.value = item.gid;
      option.textContent = item.name;
      select.appendChild(option);
    });
  },

  renderEnumList: function (options) {
    const listContainer = this.elements.enumList;
    listContainer.innerHTML = '';

    // Reset last checked index on re-render
    this.lastCheckedIndex = null;

    options.forEach((opt, index) => {
      const row = document.createElement('div');
      row.className = 'enum-row';
      row.dataset.index = index; // Store index for reference

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'option-checkbox';
      checkbox.dataset.index = index;

      // Color
      const colorDot = document.createElement('div');
      colorDot.className = 'color-dot';
      colorDot.style.backgroundColor = COLORS[opt.color] || COLORS['none'];
      colorDot.title = opt.color;

      // Name Input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'option-input';
      input.value = opt.name;

      // Handle Click on Input
      input.addEventListener('click', (e) => {
        // If Modifier key pressed, treat as Row Selection (allow bubble)
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          // Prevent default to avoid text selection interfering with row selection visual
          e.preventDefault();
          // Allow bubble to trigger handleRowClick
        } else {
          // Normal click: Edit mode, do not toggle row selection
          e.stopPropagation();
          // Update anchor for range selection
          this.lastCheckedIndex = index;
        }
      });

      row.appendChild(checkbox);
      row.appendChild(colorDot);
      row.appendChild(input);

      // Row Click Handler
      row.addEventListener('click', (e) => {
        this.handleRowClick(e, index, checkbox);
      });

      // Also handle checkbox click specifically to avoid double-toggling if bubbling
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop row click
        this.handleRowClick(e, index, checkbox, true);
      });
      listContainer.appendChild(row);
    });
  },

  handleRowClick: function (e, currentIndex, checkbox, isCheckboxClick = false) {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');

    const isModifier = e.shiftKey || e.metaKey || e.ctrlKey;

    // Ignore row click if not modifier and not checkbox click
    if (!isModifier && !isCheckboxClick) {
      return;
    }

    // Shift Key: Range Selection
    if (e.shiftKey && this.lastCheckedIndex !== null) {
      const start = Math.min(this.lastCheckedIndex, currentIndex);
      const end = Math.max(this.lastCheckedIndex, currentIndex);

      // Determine target state based on the current one (or always Check?)
      // Usually Shift+Click matches the state of the *anchor* or *current*? 
      // Let's assume we want to CHECK everything in range.
      const targetState = isCheckboxClick ? checkbox.checked : !checkbox.checked;
      // If it was a row click (not checkbox), checking logic is inverted relative to "current" state before click
      // But wait, if row click:
      //   If current is unchecked, we want to check it.
      //   So targetState = true.
      // Actually, simpler: Shift+Select usually *Selects* (Checks).
      const shouldCheck = true;

      for (let i = start; i <= end; i++) {
        checkboxes[i].checked = shouldCheck;
        this.updateRowSelection(rows[i], shouldCheck);
      }
    }
    // Cmd/Ctrl/Standard Click: Toggle
    else {
      if (!isCheckboxClick) {
        checkbox.checked = !checkbox.checked;
      }
      this.updateRowSelection(rows[currentIndex], checkbox.checked);
      this.lastCheckedIndex = currentIndex;
    }

    // Update global last checked if shift was used? 
    // Actually standard behavior updates anchor on single click, keeps anchor on shift click.
    // But for simple "Check Range" list:
    if (!e.shiftKey) {
      this.lastCheckedIndex = currentIndex;
    }
  },

  updateRowSelection: function (row, isChecked) {
    if (isChecked) {
      row.classList.add('selected');
    } else {
      row.classList.remove('selected');
    }
  },

  toggleAllSelection: function (shouldSelect) {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');

    rows.forEach((row, index) => {
      checkboxes[index].checked = shouldSelect;
      this.updateRowSelection(row, shouldSelect);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
