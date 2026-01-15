/**
 * Define the top-level Asana namespace.
 */
const Asana = {};


/**
 * Functionality to communicate with the Asana API. This should get loaded
 * in the background "server" portion of the chrome extension because it will
 * make HTTP requests and needs cross-domain privileges.
 *
 * The bridge does not need to use an auth token to connect to the API.
 * Since it is a browser extension it can access the user's cookies
 * and can use them to authenticate to the API. This capability is specific
 * to browser extensions, and other types of applications would have to obtain
 * an auth token to communicate with the API.
 *
 * We need two snippets to communicate with Asana API:
 *   "host_permissions": ["https://app.asana.com/*"] in manifest.json
 *   'X-Allow-Asana-Client': '1' in request header
 *
 */
Asana.ApiBridge = {

  /**
   * @type {String} Version of the Asana API to use.
   */
  API_VERSION: '1.0',

  /**
   * @type {Integer} How long an entry stays in the cache.
   */
  CACHE_TTL_MS: 15 * 60 * 1000,

  /**
   * @type {dict} Map from API path to cache entry for recent GET requests.
   *     date {Date} When cache entry was last refreshed
   *     response {*} Cached request.
   */
  _cache: {},

  /**
   * @return {String} The base URL to use for API requests.
   */
  baseApiUrl: function () {
    return 'https://app.asana.com/api/' + this.API_VERSION;
  },

  /**
   * Make a request to the Asana API.
   *
   * @param http_method {String} HTTP request method to use (e.g. 'POST')
   * @param path {String} Path to call.
   * @param params {dict} Parameters for API method; depends on method.
   * @param callback {Function(response: dict)} Callback on completion.
   *     status {Integer} HTTP status code of response.
   *     data {dict} Object representing response of API call, depends on
   *         method. Only available if response was a 200.
   *     errors {dict} Object containing a message, if there was a problem.
   * @param options {dict?}
   *     miss_cache {Boolean} Do not check cache before requesting
   */
  request: function (http_method, path, params, callback, options) {
    const me = this;
    http_method = http_method.toUpperCase();

    console.info('Server API Request', http_method, path, params);

    // Serve from cache first.
    if (options && !options.miss_cache && http_method === 'GET') {
      const data = me._readCache(path, new Date());
      if (data) {
        console.log('Serving request from cache', path);
        callback(data);
        return;
      }
    }

    // Be polite to Asana API and tell them who we are.
    const manifest = chrome.runtime.getManifest();
    const client_name = [
      'chrome-extension',
      chrome.i18n.getMessage('@@extension_id'),
      manifest.version,
      manifest.name
    ].join(':');

    let url = me.baseApiUrl() + path;
    let body_data;
    if (http_method === 'PUT' || http_method === 'POST') {
      // POST/PUT request, put params in body
      body_data = {
        data: params,
        options: { client_name: client_name }
      };
    } else {
      // GET/DELETE request, add params as URL parameters.
      Object.assign(params, { opt_client_name: client_name });
      url += '?' + Object.keys(params).map(key => {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      }).join('&');
    }

    console.log('Making request to API', http_method, url);

    chrome.cookies.get({
      url: url,
      name: 'ticket'
    }, function (cookie) {
      if (!cookie) {
        callback({
          status: 401,
          errors: [{ message: 'Not Authorized' }]
        });
        return;
      }

      // Note that any URL fetched here must be matched by a permission in
      // the manifest.json file!
      const attrs = {
        method: http_method,
        timeout: 30000,   // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'X-Allow-Asana-Client': '1'
        }
      };
      if (http_method === 'POST' || http_method === 'PUT') {
        attrs.body = JSON.stringify(body_data);
        attrs.dataType = 'json';
        attrs.processData = false;
      }

      fetch(url, attrs)
        .then(response => {
          return response.json().then(json => {
            if (!response.ok) {
              console.log('Response not ok', json);
            }
            return json;
          });
        })
        .then(responseJson => {
          if (http_method === 'GET') {
            me._writeCache(responseJson.path, responseJson, new Date());
          }
          if (responseJson.errors) {
            // Explicitly reject if the body has errors, even if status was 200 (rare but possible in some APIs)
            // or more commonly, non-200 status with error body.
            console.log('API returned errors', responseJson.errors);
            callback(responseJson); // ApiBridge standard is callback, but here we might want to ensure 'errors' prop is propagated.
          } else {
            console.log('Successful response', responseJson);
            callback(responseJson);
          }
        })
        .catch(response => {
          console.log('Failed response/Request Error', response);
          // Try to read json if possible, otherwise generic error
          if (response.json) {
            response.json().then(errJson => {
              callback(errJson); // Pass the full error object from Asana
            }).catch(() => {
              callback({ errors: [{ message: 'Could not parse error response status: ' + response.status }] });
            });
          } else {
            callback({ errors: [{ message: 'Network or Fetch Error: ' + response.message }] });
          }
        });
    });
  },

  _readCache: function (path, date) {
    const entry = this._cache[path];
    if (entry && entry.date >= date - this.CACHE_TTL_MS) {
      return entry.response;
    }
    return null;
  },

  _writeCache: function (path, response, date) {
    this._cache[path] = {
      response: response,
      date: date
    };
  }
};


/**
 * Library of functions for the "server" portion of an extension, which receives
 * requests from options.js and popup.js and pass them to ApiBridge.
 *
 * Some of these functions are asynchronous, because they may have to talk
 * to the Asana API to get results.
 */
Asana.ServerModel = {

  // Make requests to API to refresh cache at this interval.
  CACHE_REFRESH_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes


  /**
   * Request to the Cookie.
   * /

  /**
   * Determine if the user is logged in.
   *
   * @param callback {Function(is_logged_in)} Called when request complete.
   *     is_logged_in {Boolean} True if the user is logged in to Asana.
   */
  isLoggedIn: function (callback) {
    chrome.cookies.get({
      url: Asana.ApiBridge.baseApiUrl(),
      name: 'ticket'
    }, function (cookie) {
      callback(!!(cookie && cookie.value));
    });
  },

  /**
   * Requests to the API.
   * /

  /**
   *
   * Requests the set of workspaces the logged-in user is in.
   *
   * @param callback {Function(workspaces)} Callback on success.
   *     workspaces {dict[]}
   */
  workspaces: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/workspaces',
      {}, callback, {}
    );
  },

  /**
   * Requests the user record for the logged-in user.
   *
   * @param callback {Function(user)} Callback on success.
   *     user {dict[]}
   */
  me: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/users/me',
      {}, callback, {}
    );
  },

  /**
   * Requests the set of projects in the workspace.
   *
   * @param callback {Function(projects)} Callback on success.
   *     projects {dict[]}
   */
  projects: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/workspaces/' + parameters.workspace_gid + '/projects',
      {
        archived: parameters.archived || false,
        opt_fields: 'name,gid'
      }, callback, {}
    );
  },

  /**
   * Requests a specific project.
   *
   * @param callback {Function(project)} Callback on success.
   *     project {dict}
   */
  project: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/projects/' + parameters.project_gid,
      {}, callback, {}
    );
  },

  /**
   * Requests the custom field settings for a project.
   *
   * @param callback {Function(settings)} Callback on success.
   *     settings {dict[]}
   */
  customFieldSettings: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/projects/' + parameters.project_gid + '/custom_field_settings',
      {
        opt_fields: 'custom_field.name,custom_field.resource_subtype'
      }, callback, {}
    );
  },

  /**
   * Requests the full custom field definition (including enum options).
   *
   * @param callback {Function(field)} Callback on success.
   *     field {dict}
   */
  customField: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/custom_fields/' + parameters.custom_field_gid,
      {}, callback, {}
    );
  },

  /**
   * Updates an existing enum option.
   *
   * @param callback {Function(response)} Callback on success.
   * @param parameters {dict}
   *     enum_option_gid {String} ID of the enum option to update.
   *     name {String?} New name.
   *     color {String?} New color.
   *     enabled {Boolean?} Whether the option is enabled.
   */
  updateEnumOption: function (callback, parameters) {
    const data = {};
    if (parameters.name) data.name = parameters.name;
    if (parameters.color) data.color = parameters.color;
    if (parameters.enabled !== undefined) data.enabled = parameters.enabled;
    // Asana API: PUT /enum_options/{gid}
    // https://developers.asana.com/reference/updateenumoption
    Asana.ApiBridge.request(
      'PUT', '/enum_options/' + parameters.enum_option_gid,
      data, callback, {}
    );
  },
  /**
   * Creates a new enum option.
   */
  createEnumOption: function (callback, parameters) {
    const data = {
      name: parameters.name,
      color: parameters.color || 'none'
    };
    // Asana API: POST /custom_fields/{custom_field_gid}/enum_options
    // https://developers.asana.com/reference/createenumoptionforcustomfield
    Asana.ApiBridge.request(
      'POST', '/custom_fields/' + parameters.custom_field_gid + '/enum_options',
      data, callback, {}
    );
  },

  /**
   * Reorders an enum option.
   *
   * @param callback {Function(response)} Callback on success.
   * @param parameters {dict}
   *     enum_option_gid {String} ID of the enum option to move.
   *     before_enum_option {String?} ID of the option to insert before.
   *     after_enum_option {String?} ID of the option to insert after.
   *     custom_field_gid {String} ID of the custom field.
   */
  insertEnumOption: function (callback, parameters) {
    const data = {
      enum_option: parameters.enum_option_gid
    };
    if (parameters.before_enum_option) data.before_enum_option = parameters.before_enum_option;
    if (parameters.after_enum_option) data.after_enum_option = parameters.after_enum_option;

    // Asana API: POST /custom_fields/{custom_field_gid}/enum_options/insert
    // https://developers.asana.com/reference/insertenumoptionforcustomfield
    Asana.ApiBridge.request(
      'POST', '/custom_fields/' + parameters.custom_field_gid + '/enum_options/insert',
      data, callback, {}
    );
  },

  /**
   * Requests project type-ahead completions for a query.
   */
  projectTypeahead: function (callback, parameters) {
    Asana.ApiBridge.request(
      'GET', '/workspaces/' + parameters.workspace_gid + '/typeahead',
      {
        type: 'project',
        query: parameters.query,
        count: 10,
        opt_fields: 'name,gid'
      },
      callback,
      {
        miss_cache: true
      }
    );
  },

  /**
   * Start fetching all the data needed by the extension so it is available
   * whenever a popup is opened.
   */
  startPrimingCache: function () {
    const me = this;
    me._cache_refresh_interval = setInterval(function () {
      me.refreshCache();
    }, me.CACHE_REFRESH_INTERVAL_MS);
    me.refreshCache();
  },

  refreshCache: function () {
    const me = this;
    // Fetch logged-in user.
    me.me(function (user) {
      if (!user.errors) {
        // Fetch list of workspaces.
        me.workspaces(function (workspaces) { }, null, { miss_cache: true });
      }
    }, null, { miss_cache: true });
  }
};

/**
 * Listen to events from other clients such as the popup or per-page content windows.
 */
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'cookie') {
    // Request to the Cookie.
    Asana.ServerModel[message.name](sendResponse);
    return true; // will call callback asynchronously
  } else if (message.type === 'api') {
    // Request to the API.
    Asana.ServerModel[message.name](sendResponse, message.parameters);
    return true;
  }
});


// Open options page on click since we disabled default_popup
chrome.action.onClicked.addListener(function (tab) {
  let url = 'options.html';
  if (tab.url && tab.url.includes('app.asana.com')) {
    const projectRegex = /\/(?:0|project)\/(\d+)/;
    const match = tab.url.match(projectRegex);
    if (match && match[1]) {
      url += '?sourceProject=' + match[1];
    } else {
      url += '?sourceUrl=' + encodeURIComponent(tab.url);
    }
  }
  chrome.tabs.create({ url: url });
});

Asana.ServerModel.startPrimingCache();