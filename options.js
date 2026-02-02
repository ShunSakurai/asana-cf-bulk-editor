const COLORS = [
  { name: 'none', hex: '#bdbdbd' },
  { name: 'red', hex: '#fe8285' },
  { name: 'orange', hex: '#fd9864' },
  { name: 'yellow-orange', hex: '#f5b650' },
  { name: 'yellow', hex: '#f4d35f' },
  { name: 'yellow-green', hex: '#bbe27d' },
  { name: 'green', hex: '#7fd29c' },
  { name: 'blue-green', hex: '#6dcce4' },
  { name: 'aqua', hex: '#98e3d8' },
  { name: 'blue', hex: '#6fa0fc' },
  { name: 'indigo', hex: '#b0a2fc' },
  { name: 'purple', hex: '#df94ee' },
  { name: 'magenta', hex: '#f9a5e5' },
  { name: 'hot-pink', hex: '#fe8cc2' },
  { name: 'pink', hex: '#fea7ba' },
  { name: 'cool-gray', hex: '#a0a0a0' }
];

const COLOR_MAP = COLORS.reduce((acc, { name, hex }) => {
  acc[name] = hex;
  return acc;
}, {});

// Helper to determine if a GID refers to a new object
const isNewGid = (gid) => typeof gid === 'string' && gid.startsWith('new-');

const PATTERNS = {
  'Color palette': COLORS.map(c => c.name),
  'Asana default': [
    'green', 'red', 'orange', 'yellow-orange', 'yellow', 'yellow-green',
    'blue-green', 'aqua', 'blue', 'indigo', 'purple', 'magenta',
    'hot-pink', 'pink', 'cool-gray', 'none'
  ]
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
    allProjects: [],
    originalOptions: [],
    hasUnsavedChanges: false,
    hasValidationErrors: false,
    isGuest: false
  },

  elements: {
    workspaceSelect: null,
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
    this.initColorPicker();
    this.initFindReplace();
    this.initAddOptions();
    this.initShortcutsPopover();

    // Attempt to detect context from open tabs
    this.detectContext().then(context => {
      this.fetchWorkspaces(context);
    });
  },

  detectContext: function () {
    return new Promise((resolve) => {
      const urlParams = new URLSearchParams(window.location.search);
      const sourceProject = urlParams.get('sourceProject');
      const sourceUrl = urlParams.get('sourceUrl');

      let projectGid = sourceProject;

      if (!projectGid && sourceUrl && sourceUrl.startsWith('https://app.asana.com/')) {
        // Supporting both standard /0/{id} and /project/{id} patterns anywhere in the path
        const regex = /\/(?:0|project)\/(\d+)/;
        const match = sourceUrl.match(regex);
        if (match && match[1]) {
          projectGid = match[1];
        }
      }

      if (projectGid) {
        // Fetch project details to get Workspace and verify it exists
        this.callApi('project', { project_gid: projectGid })
          .then(project => {
            resolve({
              workspaceGid: project.workspace.gid,
              project: project
            });
          })
          .catch(err => {
            console.warn('Failed to resolve project from URL param', err);
            resolve(null);
          });
        return;
      }
      resolve(null);
    });
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

    // Save Button
    document.getElementById('btn-apply').addEventListener('click', () => {
      this.saveChanges();
    });

    // Sort Button
    document.getElementById('btn-sort').addEventListener('click', () => {
      this.sortOptions();
    });

    // Recolor Button
    document.getElementById('btn-bulk-recolor').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openColorPicker(e);
    });

    // Find & Replace Button
    document.getElementById('btn-bulk-find-replace').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openFindReplacePicker(e);
    });

    window.addEventListener('beforeunload', (event) => {
      if (this.state.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    // Copy ID Button
    document.getElementById('field-copy-id-btn').addEventListener('click', (e) => {
      e.preventDefault();
      if (this.state.currentFieldGid) {
        navigator.clipboard.writeText(this.state.currentFieldGid).then(() => {
          const btn = document.getElementById('field-copy-id-btn');
          btn.classList.add('copied');

          setTimeout(() => {
            btn.classList.remove('copied');
          }, 2000);
        });
      }
    });

    // Keyboard shortcuts for moving selected options (Cmd/Ctrl + Arrow keys)
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  },

  // ... (switchView, callApi, fetchWorkspaces...)

  saveChanges: function () {
    if (!this.state.hasUnsavedChanges || this.state.hasValidationErrors) return;

    const btn = document.getElementById('btn-apply');
    btn.disabled = true;
    btn.textContent = 'Updating Asana...';

    // Phase 1: Separate creations and updates
    const updates = [];
    const creations = [];

    this.state.enumOptions.forEach((currentOpt) => {
      if (isNewGid(currentOpt.gid)) {
        creations.push(currentOpt);
      } else {
        const originalOpt = this.state.originalOptions.find(o => o.gid === currentOpt.gid);
        if (originalOpt) {
          const hasNameChange = currentOpt.name !== originalOpt.name;
          const hasColorChange = currentOpt.color !== originalOpt.color;

          if (hasNameChange || hasColorChange) {
            updates.push({
              gid: currentOpt.gid,
              name: hasNameChange ? currentOpt.name : undefined,
              color: hasColorChange ? currentOpt.color : undefined
            });
          }
        }
      }
    });

    // Phase 2: Create new options FIRST (sequentially with delays to respect rate limit)
    // Rate limit: 1500 req/min = minimum 40ms between requests
    const createSequentially = creations.reduce((promise, creation, index) => {
      return promise.then((results) => {
        // Wait 40ms before each request (except the first)
        const delay = index > 0 ? new Promise(resolve => setTimeout(resolve, 40)) : Promise.resolve();
        return delay.then(() => {
          return this.callApi('createEnumOption', {
            custom_field_gid: this.state.currentFieldGid,
            name: creation.name,
            color: creation.color
          }).then(result => {
            creation.gid = result.gid; // callApi already unwraps response.data
            return [...results, result];
          });
        });
      });
    }, Promise.resolve([]));

    createSequentially
      .then(() => {
        // Phase 3: Update existing options (sequentially with delays)
        return updates.reduce((promise, update, index) => {
          return promise.then(() => {
            // Wait 40ms before each request (except the first)
            const delay = index > 0 || creations.length > 0
              ? new Promise(resolve => setTimeout(resolve, 40))
              : Promise.resolve();
            return delay.then(() => {
              return this.callApi('updateEnumOption', {
                enum_option_gid: update.gid,
                name: update.name,
                color: update.color
              });
            });
          });
        }, Promise.resolve());
      })
      .then(() => {
        // Phase 4: Reordering (now that all options exist with real GIDs)
        const moves = [];
        // We simulate the server state to determine minimal moves
        // Start with original options, then add newly created ones at the end
        const currentServerState = [
          ...this.state.originalOptions.map(o => o.gid),
          ...creations.map(c => c.gid)
        ];
        const targetState = this.state.enumOptions.map(o => o.gid);

        targetState.forEach((gid, index) => {
          // Identify who should be before this item
          const desiredPrev = index === 0 ? null : targetState[index - 1];

          // Where is this item currently in our simulation?
          const currentIndex = currentServerState.indexOf(gid);
          const currentPrev = currentIndex === 0 ? null : currentServerState[currentIndex - 1];

          if (desiredPrev !== currentPrev) {
            // Move Required
            const moveParams = {
              gid: gid
            };

            if (desiredPrev === null) {
              // Move to the very top - insert before the item currently at index 0
              moveParams.before = currentServerState[0];
            } else {
              moveParams.after = desiredPrev;
            }

            moves.push(moveParams);

            // Update Simulation
            currentServerState.splice(currentIndex, 1); // remove from old spot
            if (desiredPrev === null) {
              currentServerState.unshift(gid);
            } else {
              const newPrevIndex = currentServerState.indexOf(desiredPrev);
              currentServerState.splice(newPrevIndex + 1, 0, gid);
            }
          }
        });

        // Execute Moves Sequentially with 40ms delays
        return moves.reduce((promise, move, index) => {
          return promise.then(() => {
            // Wait 40ms before each request (except potentially the first)
            const delay = index > 0 || updates.length > 0 || creations.length > 0
              ? new Promise(resolve => setTimeout(resolve, 40))
              : Promise.resolve();
            return delay.then(() => {
              return this.callApi('insertEnumOption', {
                custom_field_gid: this.state.currentFieldGid,
                enum_option_gid: move.gid,
                before_enum_option: move.before,
                after_enum_option: move.after
              });
            });
          });
        }, Promise.resolve());
      })
      .then(() => {
        // Phase 5: Deletions (disable options) - done LAST to avoid affecting reordering
        const deletions = [];
        this.state.enumOptions.forEach((currentOpt) => {
          if (!isNewGid(currentOpt.gid)) {
            const originalOpt = this.state.originalOptions.find(o => o.gid === currentOpt.gid);
            if (originalOpt && originalOpt.enabled !== false && currentOpt.enabled === false) {
              deletions.push(currentOpt);
            }
          }
        });

        // Execute deletions sequentially with 40ms delays
        return deletions.reduce((promise, deletion, index) => {
          return promise.then(() => {
            const delay = index > 0 || updates.length > 0 || creations.length > 0
              ? new Promise(resolve => setTimeout(resolve, 40))
              : Promise.resolve();
            return delay.then(() => {
              return this.callApi('updateEnumOption', {
                enum_option_gid: deletion.gid,
                enabled: false
              });
            });
          });
        }, Promise.resolve());
      })
      .then(() => {
        // All Done
        this.state.originalOptions = JSON.parse(JSON.stringify(this.state.enumOptions));
        this.state.hasUnsavedChanges = false;
        this.updateApplyButton();

        // Show Status
        const status = document.getElementById('action-status');
        status.textContent = 'Updated Asana successfully.';
        status.className = 'action-status success';
        status.classList.remove('hidden');

        setTimeout(() => {
          status.classList.add('hidden');
          const disabledRows = this.elements.enumList.querySelectorAll('.enum-row.disabled');
          disabledRows.forEach(row => row.remove());
        }, 3000);

        btn.textContent = 'Apply changes';
      })
      .catch(err => {
        const status = document.getElementById('action-status');
        const errorMessage = (Array.isArray(err) && err.length > 0 && err[0].message)
          ? err[0].message
          : (err.message || 'Unknown error');
        status.textContent = 'Failed to update Asana: ' + errorMessage;
        status.className = 'action-status error';
        status.classList.remove('hidden');

        btn.disabled = false;
        btn.textContent = 'Apply changes';
      });
  },

  switchView: function (viewName) {
    Object.values(this.elements.views).forEach(el => el.classList.add('hidden'));
    if (this.elements.views[viewName]) {
      this.elements.views[viewName].classList.remove('hidden');
    }

    // Toggle Right Panel visibility
    const rightPanel = document.getElementById('right-panel');
    const leftPanel = document.getElementById('left-panel');

    if (viewName === 'empty') {
      rightPanel.classList.add('hidden');
      leftPanel.style.borderRight = 'none'; // distinct style for full width

      // Apply guest restrictions if user is a guest
      if (this.state.isGuest) {
        this.applyGuestRestrictions();
      }
    } else {
      rightPanel.classList.remove('hidden');
      leftPanel.style.borderRight = ''; // restore border
    }
  },

  // API Calls
  callApi: function (name, parameters, options = {}) {
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
            if (!options.suppressErrorLog) {
              console.log('API Error', response.errors);
            }
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
  fetchWorkspaces: function (context = null) {
    this.callApi('workspaces', {})
      .then(data => {
        this.state.workspaces = data;
        this.renderSelect('workspaceSelect', data, '-- Select Workspace --');
        this.elements.workspaceSelect.disabled = false;

        let targetGid = null;

        // 1. Context Priority
        if (context && context.workspaceGid) {
          targetGid = context.workspaceGid;
        }

        // 2. Storage Priority (if no context)
        if (!targetGid) {
          chrome.storage.sync.get(['defaultWorkspaceGid'], (result) => {
            // ... logic moved inside
            this._finalizeWorkspaceInit(data, result.defaultWorkspaceGid, context);
          });
          return;
        }

        this._finalizeWorkspaceInit(data, targetGid, context);
      })
      .catch(err => console.log(err));
  },

  _finalizeWorkspaceInit: function (workspaces, contentOrStorageGid, context) {
    let targetGid = contentOrStorageGid;

    // helper to check if gid exists in options
    const optionExists = (gid) => {
      return Array.from(this.elements.workspaceSelect.options).some(o => o.value === gid);
    };

    if (!targetGid || !optionExists(targetGid)) {
      // Default to first workspace if available
      if (workspaces.length > 0) {
        targetGid = workspaces[0].gid;
      }
    }

    if (targetGid) {
      this.elements.workspaceSelect.value = targetGid;
      this.onWorkspaceChange(targetGid);

      // If we have a detected project AND it belongs to this workspace
      if (context && context.project && context.workspaceGid === targetGid) {
        // Auto-select the project
        // We need to simulate the "Typeahead Selection"

        // 1. Set Input
        const input = document.getElementById('project-input');
        input.value = context.project.name;
        input.disabled = false;

        // 2. Trigger Change
        this.onProjectChange(context.project.gid);
      }
    }
  },

  onWorkspaceChange: function (workspaceGid) {
    this.state.currentWorkspaceGid = workspaceGid;
    this.state.currentProjectGid = null;
    this.state.currentFieldGid = null;
    this.state.currentFieldSubtype = null;
    this.state.allProjects = []; // Clear previous workspace projects immediately
    this.state.isGuest = false;
    this.clearGuestRestrictions();

    try {
      chrome.storage.sync.set({ defaultWorkspaceGid: workspaceGid });
    } catch (e) { }

    // Reset downstream
    const projectInput = document.getElementById('project-input');
    projectInput.value = '';
    projectInput.disabled = true;
    projectInput.placeholder = "Loading projects...";
    document.getElementById('project-list').classList.add('hidden');
    document.getElementById('project-ext-link').classList.add('hidden');
    document.getElementById('project-list').innerHTML = ''; // Clear rendered list

    this.elements.fieldSelect.innerHTML = '<option value="">Select a project first</option>';
    this.elements.fieldSelect.disabled = true;
    this.switchView('empty');

    if (workspaceGid) {
      this.fetchProjects(workspaceGid);
      // Check guest status in background
      this.checkGuestStatus(workspaceGid);
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
      if (!query) {
        this.onProjectChange(null);
      }

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
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
        this.renderProjectOptions(data);
      })
      .catch(err => {
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
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
    this.callApi('projects', { workspace_gid: workspaceGid, archived: false }, { suppressErrorLog: true })
      .then(data => {
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
        this.state.allProjects = data || [];
        // Enable input and update placeholder to indicate loaded
        const input = document.getElementById('project-input');
        input.disabled = false;
        input.placeholder = "Select or type to search...";
      })
      .catch(err => {
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
        const isTooLarge = err && err.some && err.some(e => e.message && e.message.includes('too large'));
        if (isTooLarge) {
          console.log('Fetch all projects: Result too large, falling back to typeahead');
        } else {
          console.log('Fetch all projects failed, falling back to typeahead', err);
        }
        this.state.allProjects = []; // Clear to force typeahead
        // Still enable input for typeahead mode
        const input = document.getElementById('project-input');
        input.disabled = false;
        input.placeholder = "Type to search projects...";
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
      const link = document.getElementById('project-ext-link');
      if (link) {
        link.href = `https://app.asana.com/project/${projectGid}`;
        link.classList.remove('hidden');
      }
      this.fetchCustomFields(projectGid);
    } else {
      const link = document.getElementById('project-ext-link');
      if (link) link.classList.add('hidden');
    }
  },

  // Custom Fields
  fetchCustomFields: function (projectGid) {
    // We need to fetch settings to get the fields for this project
    // https://developers.asana.com/reference/getcustomfieldsettingsforproject
    this.callApi('customFieldSettings', { project_gid: projectGid })
      .then(data => {
        if (this.state.currentProjectGid !== projectGid) return;
        // Filter for ENUM and MULTI_ENUM fields
        const enumFields = data
          .map(setting => setting.custom_field)
          .filter(field => field.resource_subtype === 'enum' || field.resource_subtype === 'multi_enum');

        this.state.customFields = enumFields;

        if (enumFields.length === 0) {
          this.elements.fieldSelect.innerHTML = '<option value="">No dropdown fields found</option>';
          this.elements.fieldSelect.disabled = true;
        } else {
          this.renderSelect('fieldSelect', enumFields, '-- Select Custom Field --');
          this.elements.fieldSelect.disabled = false;
        }
      })
      .catch(err => {
        if (this.state.currentProjectGid !== projectGid) return;
        console.log(err);
      });
  },

  onFieldChange: function (fieldGid) {
    this.state.currentFieldGid = fieldGid;

    if (fieldGid) {
      // Determine subtype
      const field = this.state.customFields.find(f => f.gid === fieldGid);
      this.state.currentFieldSubtype = field ? field.resource_subtype : 'enum';

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
        if (this.state.currentFieldGid !== fieldGid) return;
        const allOptions = data.enum_options || [];
        this.state.enumOptions = allOptions.filter(opt => opt.enabled !== false);
        this.state.originalOptions = JSON.parse(JSON.stringify(this.state.enumOptions));
        this.state.hasUnsavedChanges = false;
        this.updateApplyButton();
        this.updateSortButton();
        this.updateRecolorButton();
        this.updateFindReplaceButton();

        // Update Header Info
        const typeLabel = document.getElementById('field-type-label');
        if (typeLabel) {
          const typeText = this.state.currentFieldSubtype === 'multi_enum' ? 'Multi-select options' : 'Single-select options';
          typeLabel.textContent = typeText;
        }
        const copyBtn = document.getElementById('field-copy-id-btn');
        if (copyBtn) {
          copyBtn.title = `Copy custom field ID: ${fieldGid}`;
        }

        this.renderEnumList(this.state.enumOptions);
        this.switchView('current');

        if (this.state.isGuest) {
          this.applyGuestRestrictions();
        }
      })
      .catch(err => {
        if (this.state.currentFieldGid !== fieldGid) return;
        console.log(err);
      });
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

    // Reset selection anchors on re-render
    this.lastCheckedIndex = null;
    this.keyboardSelectionAnchorIndex = null;
    this.keyboardSelectionCursorIndex = null;
    this.keyboardSelectionBaseSelectedSet = null;

    options.forEach((opt, index) => {
      const row = document.createElement('div');
      row.className = 'enum-row';
      row.dataset.index = index;

      // Draggable attributes
      row.draggable = true;

      // Drag Events
      row.addEventListener('dragstart', (e) => this.handleDragStart(e, index));
      row.addEventListener('dragover', (e) => this.handleDragOver(e, index));
      row.addEventListener('dragenter', (e) => this.handleDragEnter(e, index));
      row.addEventListener('dragleave', (e) => this.handleDragLeave(e, index));
      row.addEventListener('drop', (e) => this.handleDrop(e, index));
      row.addEventListener('dragend', (e) => this.handleDragEnd(e, index));

      // Drag Handle
      const handle = document.createElement('div');
      handle.className = 'drag-handle';
      handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>`;

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'option-checkbox';
      checkbox.dataset.index = index;

      // Color
      const colorDot = document.createElement('div');
      colorDot.className = 'color-dot';
      if (this.state.currentFieldSubtype === 'multi_enum') {
        colorDot.classList.add('multi-enum');
      }
      colorDot.style.backgroundColor = COLOR_MAP[opt.color] || COLOR_MAP['none'];
      colorDot.title = `Recolor (current: ${opt.color})`;

      colorDot.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent row selection
        this.openColorPicker(e, index);
      });

      // Name Input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'option-input';
      input.value = opt.name;

      // Track changes
      input.addEventListener('input', () => {
        this.checkForChanges();
      });

      // Prevent drag when interacting with input
      input.addEventListener('mousedown', (e) => {
        row.draggable = false;
      });
      input.addEventListener('mouseup', () => {
        row.draggable = true;
      });
      input.addEventListener('blur', () => {
        row.draggable = true;
      });

      // Update lastCheckedIndex on focus to support starting a range from an edited row
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

      // Delete Button
      const btnDelete = document.createElement('button');
      btnDelete.className = 'delete-btn';
      btnDelete.title = 'Delete option';
      btnDelete.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDeleteOption(index);
      });

      row.appendChild(handle);
      row.appendChild(checkbox);
      row.appendChild(colorDot);
      row.appendChild(input);
      row.appendChild(btnDelete);

      // Apply disabled state if option is disabled
      if (opt.enabled === false) {
        row.classList.add('disabled');
      }

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

  // Selection Helpers
  getSelectedIndices: function () {
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    const selectedIndices = [];
    checkboxes.forEach((cb, i) => {
      if (cb.checked) {
        selectedIndices.push(i);
      }
    });
    return selectedIndices;
  },

  getFocusedRowIndex: function () {
    const active = document.activeElement;
    if (!active || !this.elements.enumList) return null;

    const row = active.closest ? active.closest('.enum-row') : null;
    if (!row || row.dataset.index == null) return null;

    const idx = parseInt(row.dataset.index, 10);
    return Number.isNaN(idx) ? null : idx;
  },

  resetKeyboardSelectionRange: function () {
    this.keyboardSelectionAnchorIndex = null;
    this.keyboardSelectionCursorIndex = null;
    this.keyboardSelectionBaseSelectedSet = null;
  },

  handleKeydown: function (e) {
    const isMetaOrCtrl = e.metaKey || e.ctrlKey;
    const isArrowUp = e.key === 'ArrowUp';
    const isArrowDown = e.key === 'ArrowDown';

    // Only act when the current options view is visible
    if (this.elements.views.current.classList.contains('hidden')) {
      return;
    }

    let selectedIndices = this.getSelectedIndices();

    // Shift + Up/Down: expand selection by one without reordering
    if (e.shiftKey && !isMetaOrCtrl && (isArrowUp || isArrowDown)) {
      // If nothing is selected yet, but a row is focused, start from that row.
      if (selectedIndices.length === 0) {
        const focusIndex = this.getFocusedRowIndex();
        if (focusIndex == null) {
          return;
        }
        const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
        const rows = this.elements.enumList.querySelectorAll('.enum-row');
        if (!checkboxes[focusIndex] || !rows[focusIndex]) {
          return;
        }
        checkboxes[focusIndex].checked = true;
        this.updateRowSelection(rows[focusIndex], true);
        this.lastCheckedIndex = focusIndex;
        selectedIndices = [focusIndex];
      }

      this.expandSelectionByOne(isArrowUp ? 'up' : 'down', selectedIndices);
      e.preventDefault();
      return;
    }

    // From here on, require Cmd/Ctrl + Arrow for moving options
    if (!isMetaOrCtrl || (!isArrowUp && !isArrowDown)) {
      return;
    }

    // Sync current names from DOM before reordering
    this.syncStateFromDom();

    const selectedGids = new Set(selectedIndices.map(i => this.state.enumOptions[i].gid));

    if (isArrowUp && e.shiftKey) {
      // Cmd/Ctrl + Shift + Up → move selection to top
      this.moveSelectionToBoundary('top', selectedGids);
    } else if (isArrowDown && e.shiftKey) {
      // Cmd/Ctrl + Shift + Down → move selection to bottom
      this.moveSelectionToBoundary('bottom', selectedGids);
    } else if (isArrowUp) {
      // Cmd/Ctrl + Up → move selection one up
      this.moveSelectionStep('up', selectedGids);
    } else if (isArrowDown) {
      // Cmd/Ctrl + Down → move selection one down
      this.moveSelectionStep('down', selectedGids);
    } else {
      return;
    }

    // Prevent page scrolling
    e.preventDefault();
  },

  expandSelectionByOne: function (direction, selectedIndices) {
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    if (checkboxes.length === 0 || selectedIndices.length === 0) return;

    // Initialize anchor and cursor for keyboard-driven range selection
    let anchor = this.keyboardSelectionAnchorIndex;
    let cursor = this.keyboardSelectionCursorIndex;

    if (anchor == null || cursor == null) {
      // When multiple items are already selected, start from the edge
      // closest to the movement direction, matching the requested behavior.
      if (selectedIndices.length > 1) {
        anchor = direction === 'up'
          ? Math.min(...selectedIndices)   // top-most selected for Shift+Up
          : Math.max(...selectedIndices);  // bottom-most selected for Shift+Down
      } else if (
        this.lastCheckedIndex != null &&
        checkboxes[this.lastCheckedIndex] &&
        checkboxes[this.lastCheckedIndex].checked
      ) {
        // Prefer lastCheckedIndex if it is part of the current (single) selection
        anchor = this.lastCheckedIndex;
      } else {
        // Fallback: single selection, use its index
        anchor = selectedIndices[0];
      }
      cursor = anchor;

      // Capture the base selection before keyboard-range changes so we keep
      // those items selected even when extending/shrinking with Shift+Arrows.
      this.keyboardSelectionBaseSelectedSet = new Set(selectedIndices);
    }

    const nextCursor = direction === 'up' ? cursor - 1 : cursor + 1;
    if (nextCursor < 0 || nextCursor >= checkboxes.length) {
      return; // Reached top/bottom
    }

    const start = Math.min(anchor, nextCursor);
    const end = Math.max(anchor, nextCursor);

    const baseSet = this.keyboardSelectionBaseSelectedSet || new Set();

    // Apply contiguous selection between anchor and cursor, but preserve any
    // items that were already selected before keyboard-range adjustments.
    for (let i = 0; i < checkboxes.length; i++) {
      const inKeyboardRange = i >= start && i <= end;
      const shouldBeSelected = baseSet.has(i) || inKeyboardRange;
      if (checkboxes[i].checked !== shouldBeSelected) {
        checkboxes[i].checked = shouldBeSelected;
        this.updateRowSelection(rows[i], shouldBeSelected);
      }
    }

    // If we've returned to the base selection (cursor back to anchor),
    // clear keyboard range tracking so the next Shift+Arrow starts fresh.
    if (nextCursor === anchor && this.keyboardSelectionBaseSelectedSet) {
      this.resetKeyboardSelectionRange();
    } else {
      this.keyboardSelectionAnchorIndex = anchor;
      this.keyboardSelectionCursorIndex = nextCursor;
    }

    this.lastCheckedIndex = nextCursor;

    this.updateSortButton();
    this.updateRecolorButton();
    this.updateFindReplaceButton();
  },

  moveSelectionStep: function (direction, selectedGids) {
    const options = this.state.enumOptions;
    const length = options.length;

    // Build selection set by index for easier swapping
    const selectedIndices = [];
    options.forEach((opt, index) => {
      if (selectedGids.has(opt.gid)) {
        selectedIndices.push(index);
      }
    });

    if (selectedIndices.length === 0) return;

    const selectedIndexSet = new Set(selectedIndices);

    if (direction === 'up') {
      // Move each selected item up by swapping with the previous unselected item
      for (let i = 0; i < length; i++) {
        if (selectedIndexSet.has(i) && i > 0 && !selectedIndexSet.has(i - 1)) {
          const tmp = options[i - 1];
          options[i - 1] = options[i];
          options[i] = tmp;
          selectedIndexSet.delete(i);
          selectedIndexSet.add(i - 1);
        }
      }
    } else if (direction === 'down') {
      // Move each selected item down by swapping with the next unselected item
      for (let i = length - 1; i >= 0; i--) {
        if (selectedIndexSet.has(i) && i < length - 1 && !selectedIndexSet.has(i + 1)) {
          const tmp = options[i + 1];
          options[i + 1] = options[i];
          options[i] = tmp;
          selectedIndexSet.delete(i);
          selectedIndexSet.add(i + 1);
        }
      }
    }

    // Re-render and restore selection
    this.renderEnumList(options);
    this.restoreSelectionByGids(selectedGids);
    this.checkForChanges();
  },

  moveSelectionToBoundary: function (boundary, selectedGids) {
    const options = this.state.enumOptions;
    const selected = [];
    const remaining = [];

    options.forEach((opt) => {
      if (selectedGids.has(opt.gid)) {
        selected.push(opt);
      } else {
        remaining.push(opt);
      }
    });

    if (selected.length === 0) return;

    if (boundary === 'top') {
      this.state.enumOptions = [...selected, ...remaining];
    } else if (boundary === 'bottom') {
      this.state.enumOptions = [...remaining, ...selected];
    } else {
      return;
    }

    // Re-render and restore selection
    this.renderEnumList(this.state.enumOptions);
    this.restoreSelectionByGids(selectedGids);
    this.checkForChanges();
  },

  restoreSelectionByGids: function (selectedGids) {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    let lastIndex = null;

    this.state.enumOptions.forEach((opt, index) => {
      const isSelected = selectedGids.has(opt.gid);
      if (checkboxes[index]) {
        checkboxes[index].checked = isSelected;
      }
      if (rows[index]) {
        this.updateRowSelection(rows[index], isSelected);
      }
      if (isSelected) {
        lastIndex = index;
      }
    });

    // Update anchor for subsequent shift selections
    if (lastIndex !== null) {
      this.lastCheckedIndex = lastIndex;
    }

    this.updateSortButton();
    this.updateRecolorButton();
    this.updateFindReplaceButton();
  },

  // Change Tracking
  checkForChanges: function () {
    // Collect current state from DOM
    const currentOptions = [];
    const rows = this.elements.enumList.querySelectorAll('.enum-row');

    // We iterate over the *state* to preserve IDs, but get values from DOM
    // Note: If we had drag-and-drop reordering, we'd need to trust DOM order.
    // For now, assuming index mapping is stable.
    this.state.enumOptions.forEach((opt, index) => {
      const row = rows[index];
      if (row) {
        const input = row.querySelector('.option-input');
        // Update state name with current DOM value
        opt.name = input.value;
      }

      currentOptions.push({
        gid: opt.gid,
        name: opt.name,
        color: opt.color,
        enabled: opt.enabled
      });
    });

    // Compare with Original
    const extractRelevant = (opts) => opts.map(o => ({
      gid: o.gid,
      name: o.name,
      color: o.color,
      enabled: o.enabled
    }));

    const originalJson = JSON.stringify(extractRelevant(this.state.originalOptions));
    const currentJson = JSON.stringify(extractRelevant(currentOptions));

    const hasChanges = originalJson !== currentJson;
    this.state.hasUnsavedChanges = hasChanges;

    // Duplicate Check
    const nameSet = new Set();
    let hasDuplicates = false;
    for (const opt of currentOptions) {
      if (nameSet.has(opt.name)) {
        hasDuplicates = true;
        break;
      }
      nameSet.add(opt.name);
    }

    this.state.hasValidationErrors = hasDuplicates;
    const status = document.getElementById('action-status');

    if (hasDuplicates) {
      status.textContent = 'Options cannot have duplicate names';
      status.className = 'action-status error';
      status.classList.remove('hidden');
    } else if (status.textContent === 'Options cannot have duplicate names') {
      status.classList.add('hidden');
    }

    this.updateApplyButton();
  },

  updateApplyButton: function () {
    const btn = document.getElementById('btn-apply');
    if (btn) {
      btn.disabled = !this.state.hasUnsavedChanges || this.state.hasValidationErrors;
    }
  },

  // Drag and Drop Handlers
  handleDragStart: function (e, index) {
    this.draggedIndex = index;
    e.dataTransfer.effectAllowed = 'move';

    // Determine what is being dragged
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    const isSelected = checkboxes[index].checked;

    if (isSelected) {
      // Dragging a selection
      const selectedIndices = [];
      this.elements.enumList.querySelectorAll('.option-checkbox:checked').forEach(cb => {
        selectedIndices.push(parseInt(cb.dataset.index));
      });
      this.draggedIndices = selectedIndices;
    } else {
      // Dragging single unselected item
      this.draggedIndices = [index];
    }

    e.dataTransfer.setData('text/plain', JSON.stringify(this.draggedIndices));

    // Visual feedback
    setTimeout(() => {
      this.elements.enumList.querySelectorAll('.enum-row').forEach((row, i) => {
        if (this.draggedIndices.includes(i)) {
          row.classList.add('dragging');
        }
      });
    }, 0);
  },

  handleDragOver: function (e, index) {
    e.preventDefault(); // Allow drop
    e.dataTransfer.dropEffect = 'move';

    if (this.draggedIndices.includes(index)) return; // Don't highlight self

    const row = this.elements.enumList.children[index];
    const rect = row.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    // Determine invalid drop targets (inside the moving block)
    // Actually, standard HTML5 DnD logic handles this mostly, but visual feedback needs care.

    // Remove existing highlights
    this.clearDragHighlights();

    if (e.clientY < midpoint) {
      row.classList.add('drag-over-top');
    } else {
      row.classList.add('drag-over-bottom');
    }
  },

  handleDragEnter: function (e, index) {
    e.preventDefault();
  },

  handleDragLeave: function (e, index) {
    // Clean up if leaving the valid drop zone (optional, handleDragOver mostly controls this)
  },

  clearDragHighlights: function () {
    this.elements.enumList.querySelectorAll('.enum-row').forEach(row => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  },

  handleDragEnd: function (e, index) {
    this.elements.enumList.querySelectorAll('.enum-row').forEach(row => {
      row.classList.remove('dragging');
    });
    this.clearDragHighlights();
    this.draggedIndices = null;
    this.draggedIndex = null;
  },

  handleDrop: function (e, index) {
    e.preventDefault();
    this.clearDragHighlights();

    if (!this.draggedIndices) return;

    const targetIndex = index;
    const row = this.elements.enumList.children[targetIndex];
    const rect = row.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const insertAfter = e.clientY > midpoint;

    // Capture current values (in case of edits)
    const currentValues = [];
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    rows.forEach((r, i) => {
      const opt = this.state.enumOptions[i];
      opt.name = r.querySelector('.option-input').value; // Sync name
      // Color is already synced
      currentValues.push(opt);
    });

    // Identify items to move
    const itemsToMove = this.draggedIndices.map(i => currentValues[i]);

    // Remove items from array (descending index order to avoid shifting issues)
    const indicesToRemove = [...this.draggedIndices].sort((a, b) => b - a);

    // Calculate insertion index
    // When we remove items, indices shift. logic:
    // 1. Identify Target Item (the one we dropped ON).
    // 2. Determine if we insert Before or After it.
    // 3. Perform removal. Check if Target index shifted.

    // Simpler approach:
    // Construct new array.
    const newArray = currentValues.filter((_, i) => !this.draggedIndices.includes(i));

    // Find where the "Target" ended up in the new array
    // The target might have been ONE OF the moved items (unlikely if dragging Self, but possible if dropping into self selection? handled by early return usually)

    // If target was one of the moved items, we treat it as no-op?
    if (this.draggedIndices.includes(targetIndex)) return;

    // Find the target object in the new array to locate position
    const targetItem = currentValues[targetIndex];
    let newTargetIndex = newArray.indexOf(targetItem);

    if (insertAfter) {
      newTargetIndex += 1;
    }

    // Insert
    newArray.splice(newTargetIndex, 0, ...itemsToMove);

    this.state.enumOptions = newArray;
    this.renderEnumList(this.state.enumOptions);

    // Restore Selection (Optional, beneficial)
    // We can re-check the moved items
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    // We need to know where they ended up. They are now at [newTargetIndex, newTargetIndex + count]
    for (let i = 0; i < itemsToMove.length; i++) {
      const newIdx = newTargetIndex + i;
      if (checkboxes[newIdx]) {
        checkboxes[newIdx].checked = true;
        this.updateRowSelection(this.elements.enumList.children[newIdx], true);
      }
    }

    this.checkForChanges();
  },

  handleRowClick: function (e, currentIndex, checkbox, isCheckboxClick = false) {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');

    const isModifier = e.shiftKey || e.metaKey || e.ctrlKey;

    // Any manual click-based change should reset keyboard Shift+Arrow range tracking
    this.resetKeyboardSelectionRange();

    // Ignore row click if not modifier and not checkbox click
    if (!isModifier && !isCheckboxClick) {
      return;
    }

    // Shift Key: Range Selection
    if (e.shiftKey && this.lastCheckedIndex !== null) {
      const start = Math.min(this.lastCheckedIndex, currentIndex);
      const end = Math.max(this.lastCheckedIndex, currentIndex);

      const targetState = isCheckboxClick ? checkbox.checked : !checkbox.checked;
      const shouldCheck = true; // Simpler to always select on shift click

      for (let i = start; i <= end; i++) {
        checkboxes[i].checked = shouldCheck;
        this.updateRowSelection(rows[i], shouldCheck);
      }
    }
    // Cmd/Ctrl/Standard Click: Toggle
    else {
      const selectedIndices = this.getSelectedIndices();

      // Special case: when using Cmd/Ctrl+click with no prior selection,
      // and a different row is focused, select both the focused row and
      // the clicked row (Asana-like behavior).
      if (!e.shiftKey && (e.metaKey || e.ctrlKey) && selectedIndices.length === 0) {
        const focusIndex = this.getFocusedRowIndex();
        if (focusIndex != null && focusIndex !== currentIndex) {
          // Select focused row
          if (checkboxes[focusIndex]) {
            checkboxes[focusIndex].checked = true;
            this.updateRowSelection(rows[focusIndex], true);
          }
          // Select clicked row
          if (!isCheckboxClick) {
            checkbox.checked = true;
          }
          this.updateRowSelection(rows[currentIndex], true);
          this.lastCheckedIndex = currentIndex;
        } else {
          // Fallback to standard toggle behavior
          if (!isCheckboxClick) {
            checkbox.checked = !checkbox.checked;
          }
          this.updateRowSelection(rows[currentIndex], checkbox.checked);
        }
      } else {
        // Standard multi-select toggle
        if (!isCheckboxClick) {
          checkbox.checked = !checkbox.checked;
        }
        this.updateRowSelection(rows[currentIndex], checkbox.checked);
      }

      // Update global last checked (for non-shift clicks)
      if (!e.shiftKey) {
        this.lastCheckedIndex = currentIndex;
      }
    }

    this.updateSortButton();
    this.updateRecolorButton();
    this.updateFindReplaceButton();
  },

  updateSortButton: function () {
    const btn = document.getElementById('btn-sort');
    if (!btn) return;

    const desc = btn.querySelector('.card-desc');

    // Check how many selected
    const selectedIndices = this.getSelectedIndices();
    const total = this.state.enumOptions.length;
    const selectedCount = selectedIndices.length;

    if (selectedCount > 1 && selectedCount < total) {
      if (desc) desc.textContent = 'Sort selected options alphabetically';
    } else {
      if (desc) desc.textContent = 'Sort all options alphabetically';
    }
  },

  updateRecolorButton: function () {
    const btn = document.getElementById('btn-bulk-recolor');
    if (!btn) return;

    const desc = btn.querySelector('.card-desc');

    // Check how many selected
    const selectedIndices = this.getSelectedIndices();
    const total = this.state.enumOptions.length;
    const selectedCount = selectedIndices.length;

    if (selectedCount > 0 && selectedCount < total) {
      if (desc) desc.textContent = 'Assign color to selected options';
    } else {
      if (desc) desc.textContent = 'Assign color to all options';
    }
  },

  handleDeleteOption: function (index) {
    const row = this.elements.enumList.children[index];
    const checkbox = row?.querySelector('.option-checkbox');

    // Check if the clicked row is selected
    const isSelected = checkbox?.checked;

    if (isSelected) {
      // Delete all selected rows
      const selectedIndices = this.getSelectedIndices();
      selectedIndices.forEach(idx => {
        this.state.enumOptions[idx].enabled = false;
        const targetRow = this.elements.enumList.children[idx];
        if (targetRow) {
          targetRow.classList.add('disabled');
        }
      });
    } else {
      // Delete only this row
      this.state.enumOptions[index].enabled = false;
      if (row) {
        row.classList.add('disabled');
      }
    }

    this.checkForChanges();
  },

  updateFindReplaceButton: function () {
    const btn = document.getElementById('btn-bulk-find-replace');
    if (!btn) return;

    const desc = btn.querySelector('.card-desc');

    const selectedIndices = this.getSelectedIndices();
    const total = this.state.enumOptions.length;
    const selectedCount = selectedIndices.length;

    if (selectedCount > 0 && selectedCount < total) {
      if (desc) desc.textContent = 'Find and replace text in selected options';
    } else {
      if (desc) desc.textContent = 'Find and replace text in all options';
    }
  },

  sortOptions: function () {
    // 1. Capture current values from DOM (in case user edited names but didn't save)
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    rows.forEach((row, i) => {
      this.state.enumOptions[i].name = row.querySelector('.option-input').value;
    });

    const selectedIndices = this.getSelectedIndices();
    const selectedGids = new Set(selectedIndices.map(i => this.state.enumOptions[i].gid));

    const total = this.state.enumOptions.length;
    const isPartialSelection = selectedIndices.length > 0 && selectedIndices.length < total;

    if (isPartialSelection) {
      // Sort ONLY selected items, keeping ordering relative to their slots
      const selectedItems = selectedIndices.map(i => this.state.enumOptions[i]);
      selectedItems.sort((a, b) => a.name.localeCompare(b.name));

      selectedIndices.forEach((originalIndex, i) => {
        this.state.enumOptions[originalIndex] = selectedItems[i];
      });
    } else {
      // Sort ALL (either nothing selected or everything selected)
      this.state.enumOptions.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Trigger visual feedback on the left panel
    const panel = document.getElementById('left-panel');
    if (panel) {
      panel.classList.remove('flash-success');
      void panel.offsetWidth; // trigger reflow
      panel.classList.add('flash-success');
    }

    // Re-render
    this.renderEnumList(this.state.enumOptions);

    // Restore Selection
    if (selectedGids.size > 0) {
      const newRows = this.elements.enumList.querySelectorAll('.enum-row');
      const newCheckboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
      this.state.enumOptions.forEach((opt, i) => {
        if (selectedGids.has(opt.gid)) {
          newCheckboxes[i].checked = true;
          this.updateRowSelection(newRows[i], true);
        }
      });
    }

    this.updateSortButton();
    this.updateRecolorButton();
    this.updateFindReplaceButton();
    this.checkForChanges();
  },

  // Color Picker Logic
  initColorPicker: function () {
    const picker = document.getElementById('color-picker');
    const grid = document.getElementById('color-grid');

    // Render Section: Colors
    const singleColorTitle = document.createElement('div');
    singleColorTitle.className = 'picker-section-title';
    singleColorTitle.textContent = 'colors';
    grid.appendChild(singleColorTitle);

    const colorGrid = document.createElement('div');
    colorGrid.className = 'color-grid-inner';

    COLORS.forEach(({ name, hex }) => {
      const dot = document.createElement('div');
      dot.className = 'color-option';
      dot.style.backgroundColor = hex;
      dot.title = name;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectColor(name);
      });
      colorGrid.appendChild(dot);
    });
    grid.appendChild(colorGrid);

    // Render Section: Patterns
    const patternsTitle = document.createElement('div');
    patternsTitle.className = 'picker-section-title';
    patternsTitle.textContent = 'patterns';
    grid.appendChild(patternsTitle);

    const patternsList = document.createElement('div');
    patternsList.className = 'patterns-list';

    Object.keys(PATTERNS).forEach(patternName => {
      const option = document.createElement('div');
      option.className = 'pattern-option';

      const label = document.createElement('span');
      label.textContent = patternName;

      const preview = document.createElement('div');
      preview.className = 'pattern-preview';
      // Create a small gradient preview using the first few colors
      const previewColors = PATTERNS[patternName].slice(0, 5).map(name => COLOR_MAP[name]);
      preview.style.background = `linear-gradient(90deg, ${previewColors.join(', ')})`;

      option.appendChild(label);
      option.appendChild(preview);

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyPattern(patternName);
      });
      patternsList.appendChild(option);
    });
    grid.appendChild(patternsList);

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!picker.classList.contains('hidden') && !picker.contains(e.target)) {
        this.closeColorPicker();
      }
    });
  },

  openColorPicker: function (e, rowIndex = null) {
    this.activeColorRowIndex = rowIndex;
    const picker = document.getElementById('color-picker');
    const target = e.currentTarget;

    // Close others
    this.closeFindReplacePicker();
    this.closeAddOptionsPopover();

    // Unhide first so dimensions are available if needed
    picker.classList.remove('hidden');

    const rect = target.getBoundingClientRect();

    // Position popover
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';
  },

  closeColorPicker: function () {
    document.getElementById('color-picker').classList.add('hidden');
    this.activeColorRowIndex = null;
  },

  selectColor: function (colorName) {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    let indicesToUpdate = [];

    if (this.activeColorRowIndex !== null) {
      // TRIGGERED FROM A ROW
      const targetCheckbox = rows[this.activeColorRowIndex].querySelector('.option-checkbox');

      if (targetCheckbox.checked) {
        // If target is selected, update ALL selected rows
        indicesToUpdate = this.getSelectedIndices();
      } else {
        // Update only this row
        indicesToUpdate = [this.activeColorRowIndex];
      }
    } else {
      // TRIGGERED FROM BULK RECOLOR CARD
      const selectedIndices = this.getSelectedIndices();
      if (selectedIndices.length > 0) {
        // Update only selected
        indicesToUpdate = selectedIndices;
      } else {
        // Update ALL
        indicesToUpdate = this.state.enumOptions.map((_, i) => i);
      }
    }

    // Apply Updates
    indicesToUpdate.forEach(index => {
      // Update State
      this.state.enumOptions[index].color = colorName;

      // Update DOM (if visible)
      const row = rows[index];
      if (row) {
        const dot = row.querySelector('.color-dot');
        dot.style.backgroundColor = COLOR_MAP[colorName];
        dot.title = `Recolor (current: ${colorName})`;
      }
    });

    this.closeColorPicker();
    this.checkForChanges();
  },

  applyPattern: function (patternName) {
    const pattern = PATTERNS[patternName];
    if (!pattern) return;

    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    let indicesToUpdate = [];

    if (this.activeColorRowIndex !== null) {
      // TRIGGERED FROM A ROW
      const targetCheckbox = rows[this.activeColorRowIndex].querySelector('.option-checkbox');
      if (targetCheckbox.checked) {
        indicesToUpdate = this.getSelectedIndices();
      } else {
        indicesToUpdate = [this.activeColorRowIndex];
      }
    } else {
      // TRIGGERED FROM BULK RECOLOR CARD
      const selectedIndices = this.getSelectedIndices();
      if (selectedIndices.length > 0) {
        indicesToUpdate = selectedIndices;
      } else {
        indicesToUpdate = this.state.enumOptions.map((_, i) => i);
      }
    }

    // Apply Pattern Sequentially
    indicesToUpdate.forEach((stateIndex, patternIndex) => {
      const colorName = pattern[patternIndex % pattern.length];

      // Update State
      this.state.enumOptions[stateIndex].color = colorName;

      // Update DOM
      const row = rows[stateIndex];
      if (row) {
        const dot = row.querySelector('.color-dot');
        dot.style.backgroundColor = COLOR_MAP[colorName];
        dot.title = `Recolor (current: ${colorName})`;
      }
    });

    this.closeColorPicker();
    this.checkForChanges();
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

    // Select-all / Deselect-all resets keyboard Shift+Arrow range tracking
    this.resetKeyboardSelectionRange();

    this.updateSortButton();
    this.updateRecolorButton();
    this.updateFindReplaceButton();
  },

  // Find & Replace Logic
  initFindReplace: function () {
    const btnFind = document.getElementById('btn-do-find');
    const btnReplace = document.getElementById('btn-do-replace');
    const regexCheckbox = document.getElementById('find-regex');

    if (btnFind) {
      btnFind.addEventListener('click', () => this.handleFind());
    }
    if (btnReplace) {
      btnReplace.addEventListener('click', () => this.handleReplace());
    }

    if (regexCheckbox) {
      regexCheckbox.addEventListener('change', () => {
        const helper = document.getElementById('regex-helper');
        if (helper) {
          if (regexCheckbox.checked) {
            helper.classList.remove('hidden');
          } else {
            helper.classList.add('hidden');
          }
        }
      });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
      const picker = document.getElementById('find-replace-picker');
      const btn = document.getElementById('btn-bulk-find-replace');
      if (picker && !picker.classList.contains('hidden') && !picker.contains(e.target) && !btn.contains(e.target)) {
        this.closeFindReplacePicker();
      }
    });

    // Prevent closing when clicking inside picker
    document.getElementById('find-replace-picker')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  },

  openFindReplacePicker: function (e) {
    const picker = document.getElementById('find-replace-picker');
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();

    // Close others
    this.closeColorPicker();
    this.closeAddOptionsPopover();

    // Clear status
    this.updateFindReplaceStatus('');

    picker.classList.remove('hidden');

    // Position popover
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';

    // Sync helper text
    const regexCheckbox = document.getElementById('find-regex');
    const helper = document.getElementById('regex-helper');
    if (regexCheckbox && helper) {
      if (regexCheckbox.checked) {
        helper.classList.remove('hidden');
      } else {
        helper.classList.add('hidden');
      }
    }
  },

  // Add Options Logic
  initAddOptions: function () {
    const btnOpen = document.getElementById('btn-add-options');
    const btnDoAdd = document.getElementById('btn-do-add');
    const colorGrid = document.getElementById('add-options-color-grid');

    if (btnOpen) {
      btnOpen.addEventListener('click', (e) => this.openAddOptionsPopover(e));
    }
    if (btnDoAdd) {
      btnDoAdd.addEventListener('click', () => this.handleAddOptions());
    }

    // Render Colors for Add Options
    COLORS.forEach(({ name, hex }) => {
      const dot = document.createElement('div');
      dot.className = 'color-option';
      if (name === 'none') dot.classList.add('selected'); // default
      dot.style.backgroundColor = hex;
      dot.title = name;
      dot.dataset.color = name;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        colorGrid.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        this.state.selectedAddColor = name;
      });
      colorGrid.appendChild(dot);
    });

    this.state.selectedAddColor = 'none';

    // Close on outside click
    document.addEventListener('click', (e) => {
      const picker = document.getElementById('add-options-popover');
      const btn = document.getElementById('btn-add-options');
      if (picker && !picker.classList.contains('hidden') && !picker.contains(e.target) && !btn.contains(e.target)) {
        this.closeAddOptionsPopover();
      }
    });

    // Prevent closing when clicking inside picker
    document.getElementById('add-options-popover')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  },

  initShortcutsPopover: function () {
    const btn = document.getElementById('shortcuts-info-btn');
    const popover = document.getElementById('shortcuts-popover');
    if (!btn || !popover) return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Close other popovers
      this.closeColorPicker();
      this.closeFindReplacePicker();
      this.closeAddOptionsPopover();

      const isHidden = popover.classList.contains('hidden');
      if (isHidden) {
        const rect = btn.getBoundingClientRect();
        popover.classList.remove('hidden');
        popover.style.top = (rect.bottom + window.scrollY + 4) + 'px';
        popover.style.left = (rect.left + window.scrollX) + 'px';
      } else {
        popover.classList.add('hidden');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!popover.classList.contains('hidden') && !popover.contains(e.target) && !btn.contains(e.target)) {
        popover.classList.add('hidden');
      }
    });

    // Prevent closing when clicking inside popover
    popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  },

  openAddOptionsPopover: function (e) {
    const picker = document.getElementById('add-options-popover');
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();

    // Close others
    this.closeColorPicker();
    this.closeFindReplacePicker();

    // Reset to default color: none
    this.state.selectedAddColor = 'none';
    const colorGrid = document.getElementById('add-options-color-grid');
    if (colorGrid) {
      colorGrid.querySelectorAll('.color-option').forEach(dot => {
        if (dot.dataset.color === 'none') {
          dot.classList.add('selected');
        } else {
          dot.classList.remove('selected');
        }
      });
    }

    // Clear status
    this.updateAddOptionsStatus('');

    picker.classList.remove('hidden');

    // Position popover
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';

    // Focus textarea
    document.getElementById('add-options-input')?.focus();
  },

  closeAddOptionsPopover: function () {
    document.getElementById('add-options-popover')?.classList.add('hidden');
  },

  handleAddOptions: function () {
    const textarea = document.getElementById('add-options-input');
    const text = textarea.value;
    const selectedColor = this.state.selectedAddColor || 'none';

    if (!text.trim()) {
      this.updateAddOptionsStatus('Please enter at least one option name');
      return;
    }

    const newNames = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Current names from state (which are synced from DOM in checkForChanges)
    // We should sync before checking duplicates
    this.syncStateFromDom();

    const existingNames = this.state.enumOptions.map(o => o.name);
    const duplicates = newNames.filter(name => existingNames.includes(name));

    // Internal duplicates in the new batch
    const nameSet = new Set();
    const batchDuplicates = [];
    newNames.forEach(name => {
      if (nameSet.has(name)) batchDuplicates.push(name);
      nameSet.add(name);
    });

    if (duplicates.length > 0 || batchDuplicates.length > 0) {
      this.updateAddOptionsStatus('Duplicate names found. Please fix them.');
      // Update global validation status to show the error in the main area too
      this.state.hasValidationErrors = true;
      this.checkForChanges();
      return;
    }

    // Add new items
    newNames.forEach(name => {
      this.state.enumOptions.push({
        gid: 'new-' + Date.now() + '-' + Math.random(),
        name: name,
        color: selectedColor,
        enabled: true
      });
    });

    // Success
    this.renderEnumList(this.state.enumOptions);
    this.checkForChanges();
    this.closeAddOptionsPopover();

    // Clear textarea for next time
    textarea.value = '';
  },

  updateAddOptionsStatus: function (message) {
    const status = document.getElementById('add-options-status');
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.classList.remove('hidden');
    } else {
      status.classList.add('hidden');
    }
  },

  syncStateFromDom: function () {
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    this.state.enumOptions.forEach((opt, index) => {
      const row = rows[index];
      if (row) {
        const input = row.querySelector('.option-input');
        opt.name = input.value;
      }
    });
  },

  closeFindReplacePicker: function () {
    const picker = document.getElementById('find-replace-picker');
    if (picker) picker.classList.add('hidden');
  },

  updateFindReplaceStatus: function (message) {
    const status = document.getElementById('find-replace-status');
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.classList.remove('hidden');
    } else {
      status.classList.add('hidden');
    }
  },

  handleFind: function () {
    const findText = document.getElementById('find-input').value;
    const useRegex = document.getElementById('find-regex').checked;

    if (!findText) {
      this.updateFindReplaceStatus('Please enter text to find');
      return 0;
    }

    const options = this.state.enumOptions;
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    const selectedIndicesBefore = this.getSelectedIndices();

    let regex;
    if (useRegex) {
      try {
        regex = new RegExp(findText, 'i');
      } catch (e) {
        console.error('Invalid Regex', e);
        this.updateFindReplaceStatus('Invalid Regex pattern');
        return 0;
      }
    }

    let matchCount = 0;
    options.forEach((opt, index) => {
      // If we have a selection, only search within that selection
      if (selectedIndicesBefore.length > 0 && !selectedIndicesBefore.includes(index)) {
        return;
      }

      let isMatch = false;
      if (useRegex) {
        isMatch = regex.test(opt.name);
      } else {
        isMatch = opt.name.toLowerCase().includes(findText.toLowerCase());
      }

      if (isMatch) {
        matchCount++;
      }

      if (selectedIndicesBefore.length > 0) {
        // If we are searching within a selection, UNSELECT non-matching items
        // Only process items that were originally selected
        if (selectedIndicesBefore.includes(index)) {
          if (!isMatch) {
            checkboxes[index].checked = false;
            this.updateRowSelection(rows[index], false);
          }
          // If it matches, it remains selected (no change needed here)
        }
        // If it was not originally selected, its state should not change
      } else {
        // If we were searching ALL, SELECT matching items and UNSELECT non-matching
        checkboxes[index].checked = isMatch;
        this.updateRowSelection(rows[index], isMatch);
      }
    });

    if (matchCount === 0) {
      const rangeText = selectedIndicesBefore.length > 0 ? ' (in the selected range)' : '';
      this.updateFindReplaceStatus(`No result found${rangeText}`);
    } else {
      this.updateFindReplaceStatus(`${matchCount} options found and selected`);
    }

    if (selectedIndicesBefore.length === 0) {
      this.updateSortButton();
      this.updateRecolorButton();
      this.updateFindReplaceButton();
    }

    return matchCount;
  },

  handleReplace: function () {
    const findText = document.getElementById('find-input').value;
    const replaceText = document.getElementById('replace-input').value;
    const useRegex = document.getElementById('find-regex').checked;

    if (!findText) {
      this.updateFindReplaceStatus('Please enter text to find');
      return;
    }

    const selectedIndicesBefore = this.getSelectedIndices();

    // handleFind returns matchCount within the current scope (selection or all)
    const matchCount = this.handleFind();
    if (matchCount === 0) return;

    // After handleFind, we use the (potentially new) selection
    const selectedIndices = this.getSelectedIndices();
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    let replacedCount = 0;

    selectedIndices.forEach(index => {
      // If we HAD an original selection, only replace within that original selection
      if (selectedIndicesBefore.length > 0 && !selectedIndicesBefore.includes(index)) {
        return;
      }

      const opt = this.state.enumOptions[index];
      let newName;

      if (useRegex) {
        try {
          const regex = new RegExp(findText, 'gi');
          newName = opt.name.replace(regex, replaceText);
        } catch (e) {
          return;
        }
      } else {
        // Simple case-insensitive replacement (all occurrences)
        const escapedFind = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedFind, 'gi');
        newName = opt.name.replace(regex, replaceText);
      }

      if (newName !== opt.name) {
        replacedCount++;
        this.state.enumOptions[index].name = newName;
        // Update DOM
        const input = rows[index].querySelector('.option-input');
        if (input) input.value = newName;
      }
    });

    this.updateFindReplaceStatus(`${replacedCount} options found and replaced`);
    this.checkForChanges();
  },

  // Guest Status Check
  checkGuestStatus: function (workspaceGid) {
    this.callApi('workspaceMemberships', {})
      .then(memberships => {
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
        // Find the membership for the current workspace
        const membership = memberships.find(m => m.workspace && m.workspace.gid === workspaceGid);
        if (membership && membership.is_guest) {
          this.state.isGuest = true;
          this.applyGuestRestrictions();
        } else {
          this.state.isGuest = false;
          this.clearGuestRestrictions();
        }
      })
      .catch(err => {
        if (this.state.currentWorkspaceGid !== workspaceGid) return;
        console.warn('Failed to check guest status', err);
        // Default to non-guest on error
        this.state.isGuest = false;
      });
  },

  applyGuestRestrictions: function () {
    const hasFieldSelected = !!this.state.currentFieldGid;

    if (hasFieldSelected) {
      // After CF selection: show options (they're already rendered), gray out panels, and show status message
      document.getElementById('left-panel').classList.add('read-only');
      document.getElementById('right-panel').classList.add('read-only');

      const status = document.getElementById('action-status');
      if (status) {
        status.textContent = "Guests can't edit custom fields";
        status.className = 'action-status guest-status';
        status.classList.remove('hidden');
      }
    } else {
      // Before CF selection: update empty state message with guest styling (keep single column)
      // Make sure to remove read-only class so the warning is not grayed out
      document.getElementById('left-panel').classList.remove('read-only');
      document.getElementById('right-panel').classList.remove('read-only');

      const emptyMessage = document.querySelector('#state-empty .empty-message');
      if (emptyMessage) {
        emptyMessage.classList.add('guest-message');
        emptyMessage.innerHTML = `
          <svg class="guest-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <h2>Select Another Workspace</h2>
          <p>Guests can't edit custom fields. You can view options and copy the field ID, but changes cannot be saved.</p>
        `;
      }
    }
  },

  clearGuestRestrictions: function () {
    // Remove read-only from panels
    document.getElementById('left-panel').classList.remove('read-only');
    document.getElementById('right-panel').classList.remove('read-only');

    // Clear guest status message
    const status = document.getElementById('action-status');
    if (status && status.classList.contains('guest-status')) {
      status.classList.add('hidden');
      status.classList.remove('guest-status');
    }

    // Restore empty state message
    const emptyMessage = document.querySelector('#state-empty .empty-message');
    if (emptyMessage) {
      emptyMessage.classList.remove('guest-message');
      emptyMessage.innerHTML = `
        <h2>Select a Custom Field</h2>
        <p>To start editing, choose a workspace, project, and enum custom field in the header.</p>
      `;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
