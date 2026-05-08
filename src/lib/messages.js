// Shared message constants between content / popup / service-worker / settings.
// Loaded as a classic script in content scripts; service-worker and popup
// import via a tiny re-export at the bottom.
(function () {
  const MSG = {
    // popup ↔ content
    INSPECTOR_TOGGLE:   'qa/inspector/toggle',
    INSPECTOR_STATE:    'qa/inspector/state',
    MANUAL_CAPTURE_START: 'qa/manual-capture/start',

    // popup ↔ background
    PROFILE_LIST:       'qa/profile/list',
    PROFILE_SET_ACTIVE: 'qa/profile/set-active',
    PROFILE_GET_ACTIVE: 'qa/profile/get-active',
    PROFILE_IMPORT:     'qa/profile/import',
    PROFILE_DELETE:     'qa/profile/delete',

    // content ↔ background
    CAPTURE_VISIBLE:    'qa/capture/visible',
    EXPORT_REPORT:      'qa/export/report',
    DOWNLOAD_FILE:      'qa/download/file',

    // content ↔ background storage proxy
    ISSUE_LIST:         'qa/issue/list',
    ISSUE_SAVE:         'qa/issue/save',
    ISSUE_DELETE:       'qa/issue/delete',
    ISSUE_CLEAR:        'qa/issue/clear',

    // settings (inspector color, etc.) — popup/settings ↔ background; broadcasted to content
    SETTING_GET:        'qa/setting/get',
    SETTING_SET:        'qa/setting/set',
    SETTING_CHANGED:    'qa/setting/changed',

    // figma tree (per-profile cache for nearest-frame matching)
    FIGMA_TREE_GET:     'qa/figma-tree/get',
    FIGMA_TREE_LIST:    'qa/figma-tree/list',
    FIGMA_TREE_IMPORT:  'qa/figma-tree/import',
    FIGMA_TREE_DELETE:  'qa/figma-tree/delete'
  };

  const SEVERITIES = ['critical', 'major', 'minor', 'info'];
  const ISSUE_TYPES = ['visual', 'content', 'i18n', 'a11y', 'interactive', 'broken'];

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.MSG = MSG;
  target.QA.SEVERITIES = SEVERITIES;
  target.QA.ISSUE_TYPES = ISSUE_TYPES;

  if (typeof module !== 'undefined') module.exports = { MSG, SEVERITIES, ISSUE_TYPES };
})();
