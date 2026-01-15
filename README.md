# Asana Custom Field Bulk Editor (asana-cf-bulk-editor)

Sort and recolor multiple **dropdown custom field options** in bulk.

This extension is meant to solve two common pains when managing dropdown custom fields in Asana:

1. **Custom field options can only be edited one at a time** in the standard UI.
2. **Default option coloring can be too colorful** and visually noisy.

## What it does

- **Alphabetical Sort**: sort all/selected options A → Z.
- **Recolor**: assign colors or a pattern of colors across options in one go.
- **Find & Replace**: select options which contain a keyword and rename options across the list. Regular expressions are supported.
- **Bulk add options**: add many new dropdown options at once with a set color.
- **Preview first, then apply changes**: you can review before committing.

---

## Installation

> **Store installation:** *Coming soon* (Chrome Web Store / other stores).  
> (I’m intentionally keeping store steps out until it’s published.)

---

## How to use

### 1) Open the editor
- Click the extension icon to open the **Custom Field Editor** page (options/editor UI).

### 2) Select scope
At the top of the editor:

1. **Workspace**: pick the Asana workspace/organization you want.
2. **Project**: pick a project that contains the target custom field.
3. **Custom field**: pick the dropdown (single-select or multi-select) custom field you want to edit.

The left pane will list the field’s **Options** (each with a checkbox, a color swatch, and the option name).

### 3) Select options (optional)
- Use checkboxes to select specific options
- Hold Shift key and click the first and last items to select the range
- Or use **Select all / Deselect all** for quick bulk selection

### 4) Use Actions
In the **Actions** pane on the right:

- **Alphabetical Sort**  
  Sort all/selected options alphabetically.

- **Recolor…**  
  Assign colors to options in bulk (useful for reducing the default “rainbow” coloring).

- **Find & Replace…**  
  Search, select, and replace text across all option names. Regular expressions are supported.

- **Add options…**  
  Bulk add multiple new options (e.g., paste a list).

### 5) Apply changes
When you’re happy with the preview/state, click **Apply changes** to write updates back to Asana.

> Tip: Make sure you have permission to edit the custom field/options in that workspace.

---

## Privacy policy and terms of use

We don't collect your data. We don't have our server to store, use, and share such information. We only use your Asana data (URLs, resource IDs, names, etc.) to make API calls to Asana through HTTPS. All communications are between you and Asana API. All options are saved to your browser, not in other places.

The extension requires the following permissions:

- `https://app.asana.com/*` host permission is needed to communicate with Asana API
- `activeTab` permission is needed to pre-select the project
- `cookies` permission is needed to get login information to communicate with Asana API
- `storage` permission is needed to save your default options to the browser

I try my best to maintain the quality and safety of this extension, but please use it at your own risk. The author doesn't take any responsibility for any damage caused by use of this extension.

## Feedback and contribution

I'd love to hear from users and developers.
Please feel free to post feature requests, bug reports, and questions through the [Chrome Web Store](), [addons.mozilla.org](), [GitHub Issues](https://github.com/ShunSakurai/asana-cf-bulk-editor/issues). Issues and pull requests are welcome.

---

## License

[MIT License](https://github.com/ShunSakurai/asana-cf-bulk-editor/blob/main/LICENSE)