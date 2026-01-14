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
    currentFieldGid: null,
    enumOptions: [],
    allProjects: [],
    originalOptions: [],
    hasUnsavedChanges: false
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
    this.attachEventListeners();
    this.initTypeahead();
    this.initColorPicker();
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

    // Save Button
    document.getElementById('btn-apply').addEventListener('click', () => {
      this.saveChanges();
    });

    // Sort Button
    document.getElementById('btn-sort').addEventListener('click', () => {
      this.sortOptions();
    });

    window.addEventListener('beforeunload', (event) => {
      if (this.state.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  },

  // ... (switchView, callApi, fetchWorkspaces...)

  saveChanges: function () {
    if (!this.state.hasUnsavedChanges) return;

    const btn = document.getElementById('btn-apply');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Updating Asana...';

    // Phase 1: Update Properties (Name/Color)
    const updates = [];
    this.state.enumOptions.forEach((currentOpt) => {
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
    });

    // Run Updates Parallel
    const updatePromises = updates.map(u => this.callApi('updateEnumOption', {
      enum_option_gid: u.gid,
      name: u.name,
      color: u.color
    }));

    // Phase 2: Reordering (Sequential)
    Promise.all(updatePromises)
      .then(() => {
        // Calculate Moves
        const moves = [];
        // We simulate the server state to determine minimal moves
        // Only extract GIDs for simulation
        const currentServerState = this.state.originalOptions.map(o => o.gid);
        const targetState = this.state.enumOptions.map(o => o.gid);

        // We need to verify that we are permuting the SAME set of items. 
        // Logic assumes no additions/deletions in this UI yet.

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
              // Determine who is currently first to insert before
              // If currentIndex is 0, we wouldn't be here (desiredPrev===currentPrev===null)
              // We want to move this item to the very top.
              // Insert before the item that is currently at index 0
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

        // Execute Moves Sequentially
        return moves.reduce((promise, move) => {
          return promise.then(() => {
            // Add a small delay to ensure stability and respect rate limits
            return new Promise(resolve => setTimeout(resolve, 10))
              .then(() => {
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
        // All Done
        console.log('All updates and moves successful');
        this.state.originalOptions = JSON.parse(JSON.stringify(this.state.enumOptions));
        this.state.hasUnsavedChanges = false;
        this.updateApplyButton();

        // Show Status
        const status = document.getElementById('action-status');
        status.textContent = 'Changes saved successfully.';
        status.className = 'action-status success';
        status.classList.remove('hidden');

        setTimeout(() => {
          status.classList.add('hidden');
        }, 3000);

        btn.textContent = 'Apply changes';
      })
      .catch(err => {
        console.error('Save failed', err);
        const status = document.getElementById('action-status');
        status.textContent = 'Failed to save: ' + (err.message || 'Unknown error');
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
              console.error('API Error', response.errors);
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
    this.callApi('projects', { workspace_gid: workspaceGid, archived: false }, { suppressErrorLog: true })
      .then(data => {
        this.state.allProjects = data || [];
        // Optional: Update placeholder to indicate loaded
        document.getElementById('project-input').placeholder = "Select or type to search...";
      })
      .catch(err => {
        const isTooLarge = err && err.some && err.some(e => e.message && e.message.includes('too large'));
        if (isTooLarge) {
          console.log('Fetch all projects: Result too large, falling back to typeahead');
        } else {
          console.error('Fetch all projects failed, falling back to typeahead', err);
        }
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
        // Filter for ENUM and MULTI_ENUM fields
        const enumFields = data
          .map(setting => setting.custom_field)
          .filter(field => field.resource_subtype === 'enum' || field.resource_subtype === 'multi_enum');

        this.state.customFields = enumFields;

        if (enumFields.length === 0) {
          this.elements.fieldSelect.innerHTML = '<option value="">No dropdown fields found</option>';
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
        this.state.enumOptions = data.enum_options || [];
        this.state.originalOptions = JSON.parse(JSON.stringify(this.state.enumOptions));
        this.state.hasUnsavedChanges = false;
        this.updateApplyButton();
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
      colorDot.style.backgroundColor = COLORS[opt.color] || COLORS['none'];
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

      row.appendChild(handle);
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
      const input = row.querySelector('.option-input');
      // const checkbox = row.querySelector('.option-checkbox'); // Is checkbox part of "changes"? 
      // Assuming Checkbox is purely for SELECTION for bulk actions, NOT enabled/disabled state of the enum itself.
      // IF checkbox meant 'enabled', we'd track it. 
      // As per "Bulk Editor", selections are for applying actions.
      // BUT, user might simply edit names one by one.

      currentOptions.push({
        gid: opt.gid,
        name: input.value,
        color: opt.color, // Color is now updated in state by selectColor
        enabled: opt.enabled
      });
    });

    // Compare with Original
    // Simple stringify comparison for deep equality of relevant fields
    // We map only fields that *can* change in this UI (currently just Name)
    const extractRelevant = (opts) => opts.map(o => ({
      gid: o.gid,
      name: o.name,
      color: o.color
    }));

    const originalJson = JSON.stringify(extractRelevant(this.state.originalOptions));
    const currentJson = JSON.stringify(extractRelevant(currentOptions));

    const hasChanges = originalJson !== currentJson;
    this.state.hasUnsavedChanges = hasChanges;
    this.updateApplyButton();
  },

  updateApplyButton: function () {
    const btn = document.getElementById('btn-apply');
    if (btn) {
      btn.disabled = !this.state.hasUnsavedChanges;
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
      if (!isCheckboxClick) {
        checkbox.checked = !checkbox.checked;
      }
      this.updateRowSelection(rows[currentIndex], checkbox.checked);
      this.lastCheckedIndex = currentIndex;
    }

    // Update global last checked
    if (!e.shiftKey) {
      this.lastCheckedIndex = currentIndex;
    }

    this.updateSortButton();
  },

  updateSortButton: function () {
    const btn = document.getElementById('btn-sort');
    if (!btn) return;

    const desc = btn.querySelector('.card-desc');

    // Check how many selected
    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox:checked');
    const total = this.state.enumOptions.length;
    const selectedCount = checkboxes.length;

    if (selectedCount > 1 && selectedCount < total) {
      if (desc) desc.textContent = 'Sort selected options alphabetically';
    } else {
      if (desc) desc.textContent = 'Sort all options alphabetically';
    }
  },

  sortOptions: function () {
    // 1. Capture current values from DOM (in case user edited names but didn't save)
    // We need to ensure state.enumOptions is up to date with DOM text inputs
    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    rows.forEach((row, i) => {
      this.state.enumOptions[i].name = row.querySelector('.option-input').value;
    });

    const checkboxes = this.elements.enumList.querySelectorAll('.option-checkbox');
    const selectedIndices = [];
    checkboxes.forEach((cb, i) => {
      if (cb.checked) selectedIndices.push(i);
    });

    const total = this.state.enumOptions.length;
    const isPartialSelection = selectedIndices.length > 1 && selectedIndices.length < total;

    if (isPartialSelection) {
      // Sort ONLY selected items, keeping ordering relative to their slots
      const selectedItems = selectedIndices.map(i => this.state.enumOptions[i]);

      // Sort the extracted items
      selectedItems.sort((a, b) => a.name.localeCompare(b.name));

      // Put them back into the slots
      selectedIndices.forEach((originalIndex, i) => {
        this.state.enumOptions[originalIndex] = selectedItems[i];
      });

    } else {
      // Sort ALL
      this.state.enumOptions.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Re-render
    this.renderEnumList(this.state.enumOptions);
    this.updateSortButton(); // Reset button text if selection clears (renderEnumList clears selection?)
    // Actually renderEnumList clears selection because it rebuilds DOM.
    // We might want to preserve selection, but for now clearing is safe.
    this.checkForChanges();
  },

  // Color Picker Logic
  initColorPicker: function () {
    const picker = document.getElementById('color-picker');
    const grid = document.getElementById('color-grid');

    // Render colors
    Object.entries(COLORS).forEach(([name, hex]) => {
      const dot = document.createElement('div');
      dot.className = 'color-option';
      dot.style.backgroundColor = hex;
      dot.title = name;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectColor(name);
      });
      grid.appendChild(dot);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!picker.classList.contains('hidden') && !picker.contains(e.target)) {
        this.closeColorPicker();
      }
    });
  },

  openColorPicker: function (e, rowIndex) {
    this.activeColorRowIndex = rowIndex;
    const picker = document.getElementById('color-picker');
    const target = e.target;
    const rect = target.getBoundingClientRect();

    // Position popover
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';

    picker.classList.remove('hidden');
  },

  closeColorPicker: function () {
    document.getElementById('color-picker').classList.add('hidden');
    this.activeColorRowIndex = null;
  },

  selectColor: function (colorName) {
    if (this.activeColorRowIndex === null) return;

    const rows = this.elements.enumList.querySelectorAll('.enum-row');
    const targetRow = rows[this.activeColorRowIndex];
    const targetCheckbox = targetRow.querySelector('.option-checkbox');

    // Bulk Update Logic
    const indicesToUpdate = [];

    if (targetCheckbox.checked) {
      // If target is selected, update ALL selected rows
      rows.forEach((row, index) => {
        if (row.querySelector('.option-checkbox').checked) {
          indicesToUpdate.push(index);
        }
      });
    } else {
      // Update only this row
      indicesToUpdate.push(this.activeColorRowIndex);
    }

    // Apply Updates
    indicesToUpdate.forEach(index => {
      // Update State
      this.state.enumOptions[index].color = colorName;

      // Update DOM
      const row = rows[index];
      const dot = row.querySelector('.color-dot');
      dot.style.backgroundColor = COLORS[colorName];
      dot.title = `Recolor (current: ${colorName})`;
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
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
